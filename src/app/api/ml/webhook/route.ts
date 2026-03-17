/**
 * POST /api/ml/webhook — SageMaker Training Job Completion Webhook
 * ================================================================
 *
 * Receives callbacks from SageMaker CloudWatch Events (via SNS or EventBridge)
 * when a training job completes. Evaluates the new model and deploys it
 * if metrics exceed the current deployed model.
 *
 * Security: Validates webhook secret header to prevent unauthorized calls.
 *
 * Architecture:
 *   SageMaker Training → CloudWatch Event → EventBridge → SNS → Lambda → POST /api/ml/webhook
 *   OR: Direct call from SageMaker notebook / pipeline step
 */

import { NextRequest, NextResponse } from 'next/server'
import { deployModel } from '@/lib/continuousLearning'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── Config ──────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.ML_WEBHOOK_SECRET || process.env.SAGEMAKER_WEBHOOK_SECRET || ''

function verifyWebhookSecret(provided: string | null): boolean {
  if (!WEBHOOK_SECRET) {
    console.error('[ml/webhook] ML_WEBHOOK_SECRET / SAGEMAKER_WEBHOOK_SECRET not set — rejecting')
    return false
  }
  if (!provided) return false

  // Strip "Bearer " prefix if present
  const secret = provided.startsWith('Bearer ') ? provided.slice(7) : provided

  const expectedBuf = Buffer.from(WEBHOOK_SECRET, 'utf8')
  const providedBuf = Buffer.from(secret, 'utf8')
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface SageMakerEvent {
  /** Training job name */
  jobName: string
  /** Training job status */
  status: 'Completed' | 'Failed' | 'Stopped'
  /** Model metrics from training */
  metrics?: {
    auc: number
    accuracy: number
    f1: number
    training_samples: number
  }
  /** Organization that triggered this training */
  orgId?: string
  /** S3 path to the trained model */
  modelArtifact?: string
  /** Optional error message */
  failureReason?: string
}

// ── Route Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Verify webhook secret (constant-time comparison, rejects when secret unset)
  const authHeader = req.headers.get('x-webhook-secret') || req.headers.get('authorization')
  if (!verifyWebhookSecret(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let event: SageMakerEvent
  try {
    const body = await req.json()

    // Handle SNS wrapper (if coming via AWS SNS)
    if (body.Type === 'Notification' && body.Message) {
      event = JSON.parse(body.Message) as SageMakerEvent
    } else if (body.detail?.TrainingJobName) {
      // Handle CloudWatch Events / EventBridge format
      event = {
        jobName: body.detail.TrainingJobName,
        status: body.detail.TrainingJobStatus,
        failureReason: body.detail.FailureReason,
      }
    } else {
      // Direct format
      event = body as SageMakerEvent
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!event.jobName) {
    return NextResponse.json({ error: 'Missing jobName' }, { status: 400 })
  }

  const supabase = getSupabase()

  // ── Handle Failed/Stopped jobs ──────────────────────────────────────────────

  if (event.status === 'Failed' || event.status === 'Stopped') {
    if (supabase) {
      await supabase
        .from('dc_ml_training_jobs')
        .update({
          status: 'failed',
          error_message: event.failureReason || `Job ${event.status.toLowerCase()}`,
          completed_at: new Date().toISOString(),
        })
        .eq('job_name', event.jobName)
    }

    return NextResponse.json({
      success: true,
      action: 'job_failed',
      jobName: event.jobName,
      reason: event.failureReason,
    })
  }

  // ── Handle Completed jobs ───────────────────────────────────────────────────

  if (event.status !== 'Completed') {
    return NextResponse.json({
      success: true,
      action: 'ignored',
      reason: `Status ${event.status} not actionable`,
    })
  }

  // Look up the org from the training job record
  let orgId = event.orgId || ''
  if (!orgId && supabase) {
    const { data: job } = await supabase
      .from('dc_ml_training_jobs')
      .select('org_id')
      .eq('job_name', event.jobName)
      .single()

    orgId = job?.org_id || ''
  }

  if (!orgId) {
    return NextResponse.json({ error: 'Cannot determine orgId for job' }, { status: 400 })
  }

  // Update job status to completed
  if (supabase) {
    await supabase
      .from('dc_ml_training_jobs')
      .update({
        status: 'completed',
        metrics_auc: event.metrics?.auc ?? null,
        metrics_f1: event.metrics?.f1 ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('job_name', event.jobName)
  }

  // ── Deploy if metrics are good ──────────────────────────────────────────────

  if (!event.metrics) {
    return NextResponse.json({
      success: true,
      action: 'completed_no_metrics',
      jobName: event.jobName,
      message: 'Job completed but no metrics provided. Manual deployment required.',
    })
  }

  const deployResult = await deployModel(orgId, event.jobName, {
    auc: event.metrics.auc,
    accuracy: event.metrics.accuracy,
    f1: event.metrics.f1,
    training_samples: event.metrics.training_samples,
  })

  return NextResponse.json({
    success: deployResult.success,
    action: deployResult.deployed ? 'deployed' : 'not_deployed',
    jobName: event.jobName,
    reason: deployResult.reason,
    metrics: event.metrics,
  })
}
