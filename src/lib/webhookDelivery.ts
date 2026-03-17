/**
 * Webhook Delivery Service — Reliable Delivery with Retry
 * ========================================================
 *
 * Sends webhook events to customer endpoints with:
 *   - HMAC-SHA256 signature for verification
 *   - Exponential backoff retry (up to 5 attempts)
 *   - Full delivery tracking in dc_webhook_deliveries
 *   - Idempotency keys for deduplication
 */

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'verification.completed'
  | 'verification.failed'
  | 'session.completed'
  | 'session.flagged'
  | 'document.analyzed'
  | 'certificate.generated'
  | 'ml.model_deployed'
  | 'member.invited'
  | 'plan.changed'

export interface WebhookPayload {
  event: WebhookEventType
  timestamp: string
  data: Record<string, unknown>
  idempotencyKey: string
}

// ─── Signature ────────────────────────────────────────────────────────────────

function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
}

// ─── Deliver webhook ──────────────────────────────────────────────────────────

export async function deliverWebhook(options: {
  orgId: string
  apiKeyId?: string
  webhookUrl: string
  eventType: WebhookEventType
  data: Record<string, unknown>
}): Promise<{ deliveryId: string; status: 'delivered' | 'retrying' | 'failed' }> {
  const idempotencyKey = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  const payload: WebhookPayload = {
    event: options.eventType,
    timestamp,
    data: options.data,
    idempotencyKey,
  }

  const payloadStr = JSON.stringify(payload)

  // Create delivery record
  const { data: delivery, error: insertErr } = await supabase
    .from('dc_webhook_deliveries')
    .insert({
      org_id: options.orgId,
      api_key_id: options.apiKeyId ?? null,
      webhook_url: options.webhookUrl,
      event_type: options.eventType,
      payload,
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
    })
    .select('id')
    .single()

  if (insertErr || !delivery) {
    console.error('[webhook] Failed to create delivery record:', insertErr?.message)
    return { deliveryId: '', status: 'failed' }
  }

  const deliveryId = delivery.id

  // Attempt delivery
  const result = await attemptDelivery(deliveryId, options.webhookUrl, payloadStr, 1)

  return { deliveryId, status: result }
}

// ─── Attempt a single delivery ────────────────────────────────────────────────

async function attemptDelivery(
  deliveryId: string,
  webhookUrl: string,
  payloadStr: string,
  attempt: number
): Promise<'delivered' | 'retrying' | 'failed'> {
  const webhookSecret = process.env.WEBHOOK_SIGNING_SECRET ?? process.env.CERTIFICATE_SECRET ?? 'dc-webhook-secret'
  const signature = signPayload(payloadStr, webhookSecret)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': new Date().toISOString(),
        'X-Delivery-ID': deliveryId,
        'X-Attempt': String(attempt),
        'User-Agent': 'Deep-Check-Webhook/2.7',
      },
      body: payloadStr,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const responseBody = await response.text().catch(() => '')

    if (response.ok) {
      // Success
      await supabase
        .from('dc_webhook_deliveries')
        .update({
          status: 'delivered',
          attempts: attempt,
          last_attempt_at: new Date().toISOString(),
          response_status: response.status,
          response_body: responseBody.slice(0, 500),
          delivered_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)

      return 'delivered'
    }

    // Non-success response — schedule retry
    return await handleFailure(deliveryId, attempt, response.status, responseBody.slice(0, 500))

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return await handleFailure(deliveryId, attempt, null, null, errorMsg)
  }
}

// ─── Handle failure and schedule retry ────────────────────────────────────────

async function handleFailure(
  deliveryId: string,
  attempt: number,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage?: string
): Promise<'retrying' | 'failed'> {
  const maxAttempts = 5

  if (attempt >= maxAttempts) {
    // All retries exhausted
    await supabase
      .from('dc_webhook_deliveries')
      .update({
        status: 'failed',
        attempts: attempt,
        last_attempt_at: new Date().toISOString(),
        response_status: responseStatus,
        response_body: responseBody,
        error_message: errorMessage ?? `HTTP ${responseStatus}`,
      })
      .eq('id', deliveryId)

    return 'failed'
  }

  // Exponential backoff: 30s, 120s, 480s, 1920s (32min)
  const backoffMs = 30000 * Math.pow(4, attempt - 1)
  const nextRetry = new Date(Date.now() + backoffMs).toISOString()

  await supabase
    .from('dc_webhook_deliveries')
    .update({
      status: 'retrying',
      attempts: attempt,
      last_attempt_at: new Date().toISOString(),
      next_retry_at: nextRetry,
      response_status: responseStatus,
      response_body: responseBody,
      error_message: errorMessage ?? `HTTP ${responseStatus}`,
    })
    .eq('id', deliveryId)

  return 'retrying'
}

// ─── Process retry queue ──────────────────────────────────────────────────────

export async function processRetryQueue(): Promise<{
  processed: number
  delivered: number
  failed: number
}> {
  const { data: pending } = await supabase
    .from('dc_webhook_deliveries')
    .select('id, webhook_url, payload, attempts')
    .in('status', ['pending', 'retrying'])
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(50)

  if (!pending?.length) {
    return { processed: 0, delivered: 0, failed: 0 }
  }

  let delivered = 0
  let failed = 0

  for (const item of pending) {
    const result = await attemptDelivery(
      item.id,
      item.webhook_url,
      JSON.stringify(item.payload),
      item.attempts + 1
    )

    if (result === 'delivered') delivered++
    if (result === 'failed') failed++
  }

  return { processed: pending.length, delivered, failed }
}

// ─── Query delivery history ──────────────────────────────────────────────────

export async function getDeliveryHistory(
  orgId: string,
  options: { limit?: number; status?: string } = {}
): Promise<Array<{
  id: string
  eventType: string
  webhookUrl: string
  status: string
  attempts: number
  responseStatus: number | null
  createdAt: string
  deliveredAt: string | null
}>> {
  let query = supabase
    .from('dc_webhook_deliveries')
    .select('id, event_type, webhook_url, status, attempts, response_status, created_at, delivered_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.status) query = query.eq('status', options.status)

  const { data } = await query

  return (data || []).map(d => ({
    id: d.id,
    eventType: d.event_type,
    webhookUrl: d.webhook_url,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.response_status,
    createdAt: d.created_at,
    deliveredAt: d.delivered_at,
  }))
}
