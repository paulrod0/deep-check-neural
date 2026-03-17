/**
 * GET /api/org/billing — Billing & Subscription Info
 * ===================================================
 *
 * Returns the current organization's billing info including:
 *   - Current plan and status
 *   - LemonSqueezy customer portal URL
 *   - Usage stats
 *   - Subscription ID for management
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOrgFromSession } from '@/lib/auth'
import { getPlanUsage, PLAN_LIMITS, PLAN_LABELS } from '@/lib/planLimits'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const usage = await getPlanUsage(org.id)

  // Build LemonSqueezy customer portal URL
  let billingPortalUrl: string | null = null
  if (org.ls_customer_id) {
    // LemonSqueezy hosted customer portal
    const storeId = process.env.LEMONSQUEEZY_STORE_ID
    if (storeId) {
      billingPortalUrl = `https://app.lemonsqueezy.com/my-orders`
    }
  }

  // Subscription management URL
  let manageSubscriptionUrl: string | null = null
  if (org.ls_subscription_id) {
    manageSubscriptionUrl = `https://app.lemonsqueezy.com/my-orders`
  }

  return NextResponse.json({
    success: true,
    data: {
      org: {
        id: org.id,
        name: org.name,
        email: org.owner_email,
        plan: org.plan,
        planLabel: PLAN_LABELS[org.plan] ?? 'Free',
        planStatus: org.plan_status || 'active',
        hasApi: PLAN_LIMITS[org.plan]?.api ?? false,
        createdAt: org.created_at,
      },
      usage: usage ? {
        sessionsUsed: usage.sessionsUsed,
        sessionsLimit: usage.sessionsLimit,
        docsUsed: usage.docsUsed,
        docsLimit: usage.docsLimit,
        periodReset: usage.periodReset,
      } : null,
      billing: {
        hasSubscription: Boolean(org.ls_subscription_id),
        customerId: org.ls_customer_id,
        subscriptionId: org.ls_subscription_id,
        billingPortalUrl,
        manageSubscriptionUrl,
      },
      upgradeUrl: '/pricing',
    },
  })
}
