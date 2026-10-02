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

  // Build billing portal URL — Paddle takes priority over LemonSqueezy
  const isPaddle = Boolean(org.paddle_customer_id)
  let billingPortalUrl: string | null = null
  let manageSubscriptionUrl: string | null = null

  if (isPaddle && org.paddle_subscription_id) {
    // Paddle customer portal
    const env = process.env.PADDLE_ENVIRONMENT === 'production' ? '' : 'sandbox-'
    billingPortalUrl = `https://${env}customer-portal.paddle.com`
    manageSubscriptionUrl = billingPortalUrl
  } else if (org.ls_customer_id) {
    billingPortalUrl = `https://app.lemonsqueezy.com/my-orders`
    manageSubscriptionUrl = billingPortalUrl
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
        hasSubscription: Boolean(org.paddle_subscription_id || org.ls_subscription_id),
        provider: isPaddle ? 'paddle' : org.ls_customer_id ? 'lemonsqueezy' : null,
        customerId: org.paddle_customer_id ?? org.ls_customer_id,
        subscriptionId: org.paddle_subscription_id ?? org.ls_subscription_id,
        billingPortalUrl,
        manageSubscriptionUrl,
      },
      upgradeUrl: '/pricing',
    },
  })
}
