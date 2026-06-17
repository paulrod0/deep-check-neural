/**
 * POST /api/ml/retrain — Trigger ML Model Retraining
 * ====================================================
 *
 * Manually triggers a SageMaker retraining job if enough feedback
 * has accumulated. Can be called by:
 *   - Admin from ML dashboard
 *   - CRON job (Vercel Cron / GitHub Actions / CloudWatch)
 *   - Continuous learning system (automatic)
 *
 * Security: Requires either valid session or retrain secret header.
 *
 * GET: Check if retraining is available (returns status)
 * POST: Trigger retraining (requires auth)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRetrainStatus, triggerRetraining, getModelHistory } from '@/lib/continuousLearning'
import { createClient } from '@insforge/sdk'
import { validateAdminSession } from '@/lib/adminAuth'

const RETRAIN_SECRET = process.env.ML_RETRAIN_SECRET || process.env.ML_WEBHOOK_SECRET || ''

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  const key = process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !key) return null
  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  })
}

// ── GET: Check retrain status ───────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth: retrain status exposes feedback volume and model metrics — admin only.
  const isAdmin = await validateAdminSession(req)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = req.nextUrl.searchParams.get('org') || 'global'

  try {
    const [status, models] = await Promise.all([
      getRetrainStatus(orgId),
      getModelHistory(orgId),
    ])

    const currentModel = models.find(m => m.deployed)

    return NextResponse.json({
      retrainAvailable: status.canRetrain,
      pendingSamples: status.pendingSamples,
      threshold: status.threshold,
      totalFeedback: status.feedbackCount,
      currentModel: currentModel ? {
        version: currentModel.version,
        auc: currentModel.auc,
        accuracy: currentModel.accuracy,
        f1: currentModel.f1,
        deployedAt: currentModel.created_at,
      } : null,
      deployMode: process.env.DEPLOY_MODE || 'cloud',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// ── POST: Trigger retraining ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: check retrain secret or valid admin session
  const authHeader = req.headers.get('x-retrain-secret') || req.headers.get('authorization')
  const isAuthed = RETRAIN_SECRET && (
    authHeader === RETRAIN_SECRET ||
    authHeader === `Bearer ${RETRAIN_SECRET}`
  )

  // Also accept a validated admin session (for dashboard-triggered retraining)
  if (!isAuthed) {
    const isAdmin = await validateAdminSession(req)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: { orgId?: string; force?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is OK
  }

  const orgId = body.orgId || 'global'
  const force = body.force || false

  // Check if retraining is available
  const status = await getRetrainStatus(orgId)

  if (!status.canRetrain && !force) {
    return NextResponse.json({
      success: false,
      error: `Not enough feedback for retraining. Have ${status.pendingSamples}, need ${status.threshold}.`,
      status: status,
    }, { status: 409 })
  }

  // Trigger retraining
  const result = await triggerRetraining(orgId)

  if (!result.success) {
    return NextResponse.json({
      success: false,
      error: result.error,
    }, { status: 500 })
  }

  // Log the retrain trigger
  const supabase = getSupabase()
  if (supabase && result.jobName) {
    await supabase.database.from('dc_ml_training_jobs').update({
      status: 'running',
      started_at: new Date().toISOString(),
    }).eq('job_name', result.jobName)
  }

  return NextResponse.json({
    success: true,
    jobName: result.jobName,
    message: `Retraining triggered with ${status.pendingSamples} new samples`,
    estimatedDurationMinutes: Math.ceil(status.pendingSamples / 50) * 10, // rough estimate
  })
}
