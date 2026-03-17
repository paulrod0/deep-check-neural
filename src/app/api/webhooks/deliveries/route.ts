/**
 * GET /api/webhooks/deliveries — Webhook Delivery History
 * ========================================================
 *
 * Returns delivery history for the current organization's webhooks.
 *
 * Query Parameters:
 *   ?status=delivered|failed|retrying  — Filter by status
 *   ?limit=50                          — Page size
 *
 * POST /api/webhooks/deliveries — Process Retry Queue
 * ====================================================
 *
 * Processes pending webhook retries. Can be called by cron or manually.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOrgFromSession } from '@/lib/auth'
import { getDeliveryHistory, processRetryQueue } from '@/lib/webhookDelivery'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await getOrgFromSession(req)
  if (!org) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const history = await getDeliveryHistory(org.id, {
    status: params.get('status') ?? undefined,
    limit: params.has('limit') ? parseInt(params.get('limit')!) : 50,
  })

  return NextResponse.json({ success: true, data: history })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Process retry queue — can be triggered by cron or admin
  const secret = req.headers.get('x-cron-secret')
  const cronSecret = process.env.CRON_SECRET
  if ((!cronSecret || secret !== cronSecret) && secret !== process.env.RETRAIN_SECRET) {
    // Also check admin auth
    const org = await getOrgFromSession(req)
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const result = await processRetryQueue()

  return NextResponse.json({
    success: true,
    ...result,
  })
}
