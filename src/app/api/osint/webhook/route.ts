/**
 * Deep-Check OSINT · Webhook Push System
 *
 * POST   /api/osint/webhook/register      — register a webhook
 * DELETE /api/osint/webhook/:id           — unregister (via ?action=delete&id=xxx)
 * POST   /api/osint/webhook/test/:id      — send test payload (via ?action=test&id=xxx)
 * GET    /api/osint/webhook               — list registered webhooks (redacted)
 *
 * Note: webhooks are stored in-memory (Map). For persistence, they are also
 * written to dc_osint_webhooks Supabase table when available.
 *
 * The pushWebhook() function is exported for use by other OSINT routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createClient } from '@insforge/sdk'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { isUrlSafe, SAFE_FETCH_OPTIONS } from '@/lib/ssrfGuard'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'analysis.high_risk'
  | 'analysis.complete'
  | 'video.deepfake_detected'
  | 'batch.complete'

export interface WebhookRegistration {
  id: string
  url: string
  secret: string
  events: WebhookEvent[]
  createdAt: string
  orgId?: string
  failCount: number
  lastDeliveryAt?: string
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const webhookStore = new Map<string, WebhookRegistration>()

// ─── Supabase persistence (best-effort) ──────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  })
}

async function persistWebhook(wh: WebhookRegistration): Promise<void> {
  try {
    const sb = getSupabase()
    if (!sb) return
    await sb.database.from('dc_osint_webhooks').upsert({
      id:         wh.id,
      url:        wh.url,
      secret:     wh.secret,
      events:     wh.events,
      org_id:     wh.orgId ?? null,
      created_at: wh.createdAt,
      fail_count: wh.failCount,
    })
  } catch {
    // Supabase table may not exist yet — fail silently
  }
}

async function deleteWebhookFromDb(id: string): Promise<void> {
  try {
    const sb = getSupabase()
    if (!sb) return
    await sb.database.from('dc_osint_webhooks').delete().eq('id', id)
  } catch {
    // Ignore
  }
}

async function loadWebhooksFromDb(): Promise<void> {
  try {
    const sb = getSupabase()
    if (!sb) return
    const { data } = await sb.database.from('dc_osint_webhooks').select('*').limit(500)
    if (!data) return
    for (const row of data) {
      if (!webhookStore.has(row.id)) {
        webhookStore.set(row.id, {
          id:             row.id,
          url:            row.url,
          secret:         row.secret,
          events:         row.events ?? [],
          createdAt:      row.created_at,
          orgId:          row.org_id ?? undefined,
          failCount:      row.fail_count ?? 0,
          lastDeliveryAt: row.last_delivery_at ?? undefined,
        })
      }
    }
  } catch {
    // Supabase table may not exist — skip
  }
}

// ─── HMAC signing & delivery ──────────────────────────────────────────────────

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
}

export async function pushWebhook(event: WebhookEvent, data: unknown): Promise<void> {
  // Load from DB on first call to hydrate the in-memory store
  if (webhookStore.size === 0) {
    await loadWebhooksFromDb()
  }

  const payload = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
    source: 'deep-check',
  })

  const deliveries = Array.from(webhookStore.values())
    .filter(wh => wh.events.includes(event) || wh.events.includes('analysis.complete' as WebhookEvent))

  await Promise.allSettled(
    deliveries.map(async (wh) => {
      try {
        // SSRF protection: skip webhooks pointing at private/internal targets
        if (!(await isUrlSafe(wh.url))) {
          console.warn(`[osint/webhook] Skipping unsafe webhook URL for ${wh.id}`)
          return
        }
        const sig = signPayload(payload, wh.secret)
        const resp = await fetch(wh.url, {
          ...SAFE_FETCH_OPTIONS,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DeepCheck-Signature': sig,
            'X-DeepCheck-Event': event,
            'X-DeepCheck-WebhookId': wh.id,
            'User-Agent': 'Deep-Check-Webhooks/2.0',
          },
          body: payload,
          signal: AbortSignal.timeout(10_000),
        })

        const updatedWh: WebhookRegistration = {
          ...wh,
          failCount:      resp.ok ? 0 : wh.failCount + 1,
          lastDeliveryAt: new Date().toISOString(),
        }
        webhookStore.set(wh.id, updatedWh)

        if (!resp.ok) {
          console.warn(`[osint/webhook] Delivery failed for ${wh.id}: HTTP ${resp.status}`)
        }
      } catch (err) {
        const updatedWh: WebhookRegistration = {
          ...wh,
          failCount: wh.failCount + 1,
        }
        webhookStore.set(wh.id, updatedWh)
        console.error(`[osint/webhook] Delivery error for ${wh.id}:`, err)
      }
    })
  )
}

// ─── VALID EVENTS ─────────────────────────────────────────────────────────────

const VALID_EVENTS: WebhookEvent[] = [
  'analysis.high_risk',
  'analysis.complete',
  'video.deepfake_detected',
  'batch.complete',
]

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ip = extractIP(req.headers)

  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await loadWebhooksFromDb()

  // Scope to the caller's organization only — never expose other tenants' webhooks
  const webhooks = Array.from(webhookStore.values())
    .filter(wh => wh.orgId === org.id)
    .map(wh => ({
      id:             wh.id,
      url:            wh.url.replace(/^(https?:\/\/[^/]+).*$/, '$1/***'),
      events:         wh.events,
      createdAt:      wh.createdAt,
      failCount:      wh.failCount,
      lastDeliveryAt: wh.lastDeliveryAt ?? null,
    }))

  void writeAuditLog({
    eventType: 'data_access',
    endpoint: '/api/osint/webhook',
    method: 'GET',
    ip,
    statusCode: 200,
    details: { count: webhooks.length },
  })

  return NextResponse.json({ webhooks, total: webhooks.length })
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  try {
    const { pathname } = new URL(req.url)
    const org = await getOrgFromSession(req)
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Route: POST /api/osint/webhook/test/:id
    const testMatch = pathname.match(/\/api\/osint\/webhook\/test\/([^/]+)/)
    if (testMatch) {
      return handleTest(testMatch[1], org.id, ip, t0)
    }

    // Route: POST /api/osint/webhook/register
    if (pathname.endsWith('/register') || pathname.endsWith('/webhook')) {
      return handleRegister(req, org.id, ip, t0)
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (err) {
    console.error('[api/osint/webhook POST] unexpected:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams, pathname } = new URL(req.url)

  // Support both path param (/webhook/:id) and query param (?id=xxx)
  const idFromPath  = pathname.split('/').pop()
  const idFromQuery = searchParams.get('id')
  const id = (idFromPath && idFromPath !== 'webhook') ? idFromPath : (idFromQuery ?? '')

  if (!id) {
    return NextResponse.json({ error: 'Webhook ID required' }, { status: 400 })
  }

  // Hydrate store so cross-tenant ownership can be verified against persisted rows
  if (!webhookStore.has(id)) {
    await loadWebhooksFromDb()
  }

  const wh = webhookStore.get(id)
  // Scope to caller's org — never delete another tenant's webhook
  if (!wh || wh.orgId !== org.id) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  webhookStore.delete(id)
  void deleteWebhookFromDb(id)

  void writeAuditLog({
    eventType: 'data_delete',
    endpoint: '/api/osint/webhook',
    method: 'DELETE',
    ip,
    statusCode: 200,
    durationMs: Date.now() - t0,
    details: { webhookId: id },
  })

  return NextResponse.json({ deleted: true, id })
}

// ─── Sub-handlers ─────────────────────────────────────────────────────────────

async function handleRegister(
  req: NextRequest,
  orgId: string,
  ip: string,
  t0: number
): Promise<NextResponse> {
  const body = await req.json()
  const { url, secret, events } = body as {
    url?: string
    secret?: string
    events?: WebhookEvent[]
  }

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'Valid https URL required' }, { status: 400 })
  }

  // SSRF protection: reject private/internal/metadata webhook targets at registration
  if (!(await isUrlSafe(url))) {
    return NextResponse.json({ error: 'Unsafe URL' }, { status: 400 })
  }

  const resolvedEvents: WebhookEvent[] = Array.isArray(events)
    ? events.filter(e => VALID_EVENTS.includes(e))
    : ['analysis.complete']

  if (resolvedEvents.length === 0) {
    return NextResponse.json({ error: `Invalid events. Valid: ${VALID_EVENTS.join(', ')}` }, { status: 400 })
  }

  const id        = crypto.randomUUID()
  const webhookSecret = secret ?? crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const createdAt = new Date().toISOString()

  const registration: WebhookRegistration = {
    id,
    url,
    secret: webhookSecret,
    events: resolvedEvents,
    createdAt,
    orgId,
    failCount: 0,
  }

  webhookStore.set(id, registration)
  void persistWebhook(registration)

  void writeAuditLog({
    eventType: 'data_write',
    endpoint: '/api/osint/webhook',
    method: 'POST',
    ip,
    statusCode: 201,
    durationMs: Date.now() - t0,
    details: { webhookId: id, events: resolvedEvents, orgId: orgId ?? 'anonymous' },
  })

  return NextResponse.json({ webhookId: id, secret: webhookSecret, events: resolvedEvents }, { status: 201 })
}

async function handleTest(id: string, orgId: string, ip: string, t0: number): Promise<NextResponse> {
  if (!webhookStore.has(id)) {
    // Try loading from DB first
    await loadWebhooksFromDb()
  }

  const wh = webhookStore.get(id)
  // Scope to caller's org — do not reveal or test other tenants' webhooks
  if (!wh || wh.orgId !== orgId) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  // SSRF protection: never fire a test against a private/internal target
  if (!(await isUrlSafe(wh.url))) {
    return NextResponse.json({ error: 'Unsafe URL' }, { status: 400 })
  }

  const testPayload = JSON.stringify({
    event: 'analysis.complete',
    data: {
      id:         'test-' + crypto.randomUUID().slice(0, 8),
      filename:   'test_image.jpg',
      riskScore:  0.42,
      riskLevel:  'MEDIUM',
      elaScore:   0.35,
      aiScore:    0.29,
      alerts:     ['TEST_DELIVERY'],
      isTestEvent: true,
    },
    timestamp: new Date().toISOString(),
    source: 'deep-check',
  })

  try {
    const sig = signPayload(testPayload, wh.secret)
    const resp = await fetch(wh.url, {
      ...SAFE_FETCH_OPTIONS,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DeepCheck-Signature': sig,
        'X-DeepCheck-Event': 'analysis.complete',
        'X-DeepCheck-Test': 'true',
        'User-Agent': 'Deep-Check-Webhooks/2.0',
      },
      body: testPayload,
      signal: AbortSignal.timeout(10_000),
    })

    void writeAuditLog({
      eventType: 'api_call',
      endpoint: '/api/osint/webhook/test',
      method: 'POST',
      ip,
      statusCode: resp.status,
      durationMs: Date.now() - t0,
      details: { webhookId: id, delivered: resp.ok, remoteStatus: resp.status },
    })

    return NextResponse.json({
      delivered:    resp.ok,
      remoteStatus: resp.status,
      webhookId:    id,
    })
  } catch (err) {
    return NextResponse.json({
      delivered:    false,
      error:        err instanceof Error ? err.message : 'Delivery failed',
      webhookId:    id,
    })
  }
}
