import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[ls-webhook] LEMONSQUEEZY_WEBHOOK_SECRET not set — rejecting request')
    return false
  }
  if (!signature) return false
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  // Ensure both buffers are same length before timingSafeEqual
  const hmacBuf = Buffer.from(hmac, 'utf8')
  const sigBuf  = Buffer.from(signature, 'utf8')
  if (hmacBuf.length !== sigBuf.length) return false
  return crypto.timingSafeEqual(hmacBuf, sigBuf)
}

// ─── Plan mapping (variant IDs → plan name) ───────────────────────────────────

function variantToPlan(variantId: string | number): 'starter' | 'pro' | 'enterprise' {
  const vid = String(variantId)
  if (vid === String(process.env.LEMONSQUEEZY_ENTERPRISE_VARIANT_ID)) return 'enterprise'
  if (vid === String(process.env.LEMONSQUEEZY_STARTER_VARIANT_ID))    return 'starter'
  return 'pro' // default all other paid variants to pro
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get('x-signature') ?? ''

  if (!verifySignature(body, signature)) {
    console.error('[ls-webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { meta: { event_name: string }; data: Record<string, unknown> }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventName = event.meta?.event_name
  const attrs     = (event.data?.attributes ?? {}) as Record<string, unknown>
  const lsSubId   = String(event.data?.id ?? '')
  const email     = String(attrs.user_email ?? '')
  const custId    = String(attrs.customer_id ?? '')
  const variantId = String(attrs.variant_id ?? '')
  const status    = String(attrs.status ?? 'active')

  console.log(`[ls-webhook] ${eventName} | sub=${lsSubId} email=${email}`)

  switch (eventName) {
    // ── New subscription created ───────────────────────────────────────────
    case 'subscription_created': {
      const plan = variantToPlan(variantId)

      // Upsert organization
      const { data: existingOrg } = await supabase
        .from('dc_organizations')
        .select('id')
        .eq('owner_email', email)
        .single()

      if (existingOrg) {
        await supabase
          .from('dc_organizations')
          .update({
            plan,
            plan_status:        'active',
            ls_customer_id:     custId,
            ls_subscription_id: lsSubId,
            ls_variant_id:      variantId,
          })
          .eq('id', existingOrg.id)
      } else {
        await supabase.from('dc_organizations').insert({
          owner_email:        email,
          name:               email.split('@')[0],
          plan,
          plan_status:        'active',
          ls_customer_id:     custId,
          ls_subscription_id: lsSubId,
          ls_variant_id:      variantId,
        })
      }
      break
    }

    // ── Subscription updated (plan change, renewal, etc.) ─────────────────
    case 'subscription_updated': {
      const plan     = variantToPlan(variantId)
      const newStatus: string = status === 'active' || status === 'past_due'
        ? 'active'
        : status === 'paused' ? 'paused' : 'cancelled'

      await supabase
        .from('dc_organizations')
        .update({
          plan,
          plan_status:    newStatus,
          ls_customer_id: custId,
          ls_variant_id:  variantId,
        })
        .eq('ls_subscription_id', lsSubId)
      break
    }

    // ── Subscription cancelled (access until period end) ──────────────────
    case 'subscription_cancelled': {
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'cancelled' })
        .eq('ls_subscription_id', lsSubId)
      break
    }

    // ── Subscription expired (downgrade to free) ──────────────────────────
    case 'subscription_expired': {
      await supabase
        .from('dc_organizations')
        .update({ plan: 'free', plan_status: 'expired', ls_subscription_id: null })
        .eq('ls_subscription_id', lsSubId)
      break
    }

    // ── Payment failed (warn but keep access temporarily) ─────────────────
    case 'subscription_payment_failed': {
      await supabase
        .from('dc_organizations')
        .update({ plan_status: 'paused' })
        .eq('ls_subscription_id', lsSubId)
      break
    }

    default:
      console.log(`[ls-webhook] Unhandled event: ${eventName}`)
  }

  return NextResponse.json({ received: true })
}
