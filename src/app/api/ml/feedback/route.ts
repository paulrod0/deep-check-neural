/**
 * POST /api/ml/feedback — Submit ML feedback for continuous learning
 * GET  /api/ml/feedback — Get retraining status
 *
 * This endpoint connects to the continuous learning system.
 * When enough labeled feedback accumulates, it triggers model retraining.
 */

import { NextRequest, NextResponse } from 'next/server'
import { submitFeedback, getRetrainStatus, getModelHistory } from '@/lib/continuousLearning'
import { getOrgFromSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const org = await getOrgFromSession(req)
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json() as {
      analysis_id: string
      predicted_label: 'genuine' | 'suspicious' | 'tampered'
      predicted_score: number
      actual_label: 'genuine' | 'tampered'
      document_type?: string
      notes?: string
    }

    if (!body.analysis_id || !body.predicted_label || !body.actual_label) {
      return NextResponse.json(
        { error: 'Missing required fields: analysis_id, predicted_label, actual_label' },
        { status: 400 },
      )
    }

    const result = await submitFeedback({
      org_id: org.id,
      analysis_id: body.analysis_id,
      predicted_label: body.predicted_label,
      predicted_score: body.predicted_score || 0,
      actual_label: body.actual_label,
      document_type: body.document_type,
      notes: body.notes,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Feedback recorded. The model will improve over time.',
    })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const org = await getOrgFromSession(req)
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [status, history] = await Promise.all([
      getRetrainStatus(org.id),
      getModelHistory(org.id),
    ])

    return NextResponse.json({
      retraining: status,
      models: history,
      deployMode: process.env.DEPLOY_MODE || 'cloud',
    })
  } catch {
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 })
  }
}
