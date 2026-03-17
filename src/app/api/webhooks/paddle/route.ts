/**
 * Deep-Check · Paddle Billing Webhook Handler
 * POST /api/webhooks/paddle
 *
 * Paddle sends events for subscription lifecycle management.
 * Paddle acts as Merchant of Record — handles EU VAT automatically.
 *
 * Signature format: Paddle-Signature: ts=TIMESTAMP;h1=HMAC_SHA256
 * Verification: HMAC-SHA256("TIMESTAMP:BODY", PADDLE_WEBHOOK_SECRET)
 *
 * Docs: https://developer.paddle.com/webhooks/overview
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(body: string, signatureHeader: string): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[paddle-webhook] PADDLE_WEBHOOK_SECRET not set — rejecting request')
    return false
  }

  // Header format: "ts=1671552000;h1=abcdef..."
  const parts = Object.fromEntries(
    signatureHeader.split(';').map(p => p.split('=') as [string, string])
  )
  const ts = parts['ts']
  const h1 = parts['h1']
  if (!ts || !h1) return false

  const signed   = `${ts}:${body}`
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'))
  } catch {
    return false
  }
}

// ─── Price → Plan mapping ────────────────────────────────────────────────────

function priceToPlan(priceId: string): 'starter' | 'pro' | 'enterprise' {
  if (priceId === process.env.PADDLE_ENTERPRISE_PRICE_ID) return 'enterprise'
  if (priceId === process.env.PADDLE_STARTER_PRICE_ID)    return 'starter'
  return 'pro' // default for all other paid prices
}

// ─── Extract first price ID from subscription items ──────────────────────────

function getFirstPriceId(items: unknown[]): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  const item = items[0] as Record<string, unknown>
  const price = item?.price as Record<string, unknown> | undefined
  return String(price?.id ?? '')
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const sigHeader = req.headers.get('paddle-signature') ?? ''

  if (!verifySignature(body, sigHeader)) {
    console.error('[paddle-webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: {
    event_type: string
    data: Record<string, unknown>
  }

  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType  = event.event_type  // e.g. "subscription.created"
  const data       = event.data ?? {}
  const subId      = String(data.id ?? '')
  const customerId = String(data.customer_id ?? '')
  const status     = String(data.status ?? 'active')
  const items      = (data.items ?? []) as unknown[]
  const priceId    = getFirstPriceId(items)

  // Custom data passed through checkout (set org_id / email at checkout time)
  const customData = (data.custom_data ?? {}) as Record<string, string>
  const orgId      = customData.org_id   ?? ''
  const email      = customData.email    ?? ''

  console.log(`[paddle-webhook] ${eventType} | sub=${subId} customer=${customerId}`)

  switch (eventType) {

    // ── New subscription created ─────────────────────────────────────────────
    case 'subscription.created': {
      const plan = priceToPlan(priceId)

      // Try to find org by org_id from custom_data first, then by email
      const { data: existingOrg } = orgId
        ? await supabase.from('dc_organizations').select('id').eq('id', orgId).single()
        : email
          ? await supabase.from('dc_organizations').select('id').eq('owner_email', email).single()
          : { data: null }

      if (existingOrg) {
        await supabase
          .from('dc_organizations')
          .update({
            plan,
            plan_status:           'active',
            paddle_customer_id:    customerId,
            paddle_subscription_id: subId,
            paddle_price_id:       priceId,
          })
          .eq('id', existingOrg.id)
      } else if (email) {
        await supabase.from('dc_organizations').insert({
          owner_email:            email,
          name:                   email.split('@')[0],
          plan,
          plan_status:            'active',
          paddle_customer_id:     customerId,
          paddle_subscription_id: subId,
          paddle_price_id:        priceId,
        })
      } else {
        console.warn('[paddle-webhook] subscription.created: no org_id or email in custom_data')
      }
      break
    }

    // ── Subscription updated (plan change, renewal, etc.) ───────────────────
    case 'subscription.updated': {
      const plan = priceToPlan(priceId)
      const newStatus =
        status === 'active'   ? 'active'    :
        status === 'past_due' ? 'active'    :  // keep access while past_due
        status === 'paused'   ? 'paused'    : 'cancelled'

      await supabase
        .from('dc_organizations')
        .update({
          plan,
          plan_status:      newStatus,
          paddle_price_id:  priceId,
        })
        .eq('paddle_subscription_id', subId)
      break
    }

    // ── Subscription cancelled (keeps access until period end) ───────────────
    case 'subscription.canceled': {
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'cancelled' })
        .eq('paddle_subscription_id', subId)
      break
    }

    // ── Subscription paused (payment failed + grace period expired) ──────────
    case 'subscription.paused': {
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'paused' })
        .eq('paddle_subscription_id', subId)
      break
    }

    // ── Subscription resumed after pause ────────────────────────────────────
    case 'subscription.resumed': {
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'active' })
        .eq('paddle_subscription_id', subId)
      break
    }

    // ── Payment failed (warn but maintain status during retry window) ────────
    case 'transaction.payment_failed': {
      const txSubId = String(
        (data.subscription_id ?? subId) || ''
      )
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'paused' })
        .eq('paddle_subscription_id', txSubId)
      break
    }

    default:
      console.log(`[paddle-webhook] Unhandled event: ${eventType}`)
  }

  return NextResponse.json({ received: true })
}
