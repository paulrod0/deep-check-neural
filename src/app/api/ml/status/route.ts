/**
 * GET /api/ml/status — ML System Status & Metrics
 * =================================================
 *
 * Returns comprehensive ML system status including:
 *   - Current deployed model metrics
 *   - Feedback statistics
 *   - Training job history
 *   - Retraining readiness
 *
 * Used by the /dashboard/ml page to display real-time model health.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRetrainStatus, getModelHistory } from '@/lib/continuousLearning'
import { createClient } from '@insforge/sdk'
import { getOrgFromSession } from '@/lib/auth'
import { validateAdminSession } from '@/lib/adminAuth'

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth gate ───────────────────────────────────────────────────────────────
  // Status exposes per-org training jobs, feedback stats and operational config.
  // A session caller may only view their own org; the cross-org 'global'
  // aggregate is admin-only.
  const org = await getOrgFromSession(req)
  let orgId: string
  if (org) {
    orgId = org.id
  } else {
    const isAdmin = await validateAdminSession(req)
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    orgId = req.nextUrl.searchParams.get('org') || 'global'
  }

  try {
    const [retrainStatus, modelHistory] = await Promise.all([
      getRetrainStatus(orgId),
      getModelHistory(orgId),
    ])

    // Get training jobs
    const supabase = getSupabase()
    let trainingJobs: unknown[] = []
    let feedbackStats = { total: 0, used: 0, corrections: 0 }

    if (supabase) {
      // Training jobs
      const { data: jobs } = await supabase.database
        .from('dc_ml_training_jobs')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10)

      trainingJobs = jobs || []

      // Feedback stats
      const { count: totalFeedback } = await supabase.database
        .from('dc_ml_feedback')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)

      const { count: usedFeedback } = await supabase.database
        .from('dc_ml_feedback')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('used_in_training', true)

      // Count corrections (where predicted != actual)
      const { data: corrections } = await supabase.database
        .from('dc_ml_feedback')
        .select('predicted_label, actual_label')
        .eq('org_id', orgId)

      const correctionCount = (corrections || []).filter(
        f => f.predicted_label !== f.actual_label
      ).length

      feedbackStats = {
        total: totalFeedback || 0,
        used: usedFeedback || 0,
        corrections: correctionCount,
      }
    }

    // Current deployed model
    const deployedModel = modelHistory.find(m => m.deployed)

    return NextResponse.json({
      deployedModel: deployedModel || null,
      retrainStatus,
      modelHistory,
      trainingJobs,
      feedbackStats,
      deployMode: process.env.DEPLOY_MODE || 'cloud',
      sagemakerConfigured: Boolean(process.env.SAGEMAKER_ROLE_ARN),
    })
  } catch (err) {
    console.error('[ml/status] Error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch ML status' },
      { status: 500 }
    )
  }
}
