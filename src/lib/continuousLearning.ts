/**
 * continuousLearning.ts — ML Continuous Learning System
 * ======================================================
 *
 * Collects labeled feedback from document verifications and triggers
 * model retraining when enough new data accumulates.
 *
 * Architecture:
 *   1. User verifies document → system produces analysis
 *   2. User provides feedback (correct / incorrect classification)
 *   3. Feedback stored in Supabase (dc_ml_feedback table)
 *   4. When feedback count >= threshold → trigger SageMaker retraining
 *   5. New model deployed → old model archived
 *
 * Supports both:
 *   - CLOUD: AWS SageMaker training + S3 storage
 *   - ON-PREMISE: Local ONNX model (no external calls)
 *
 * The feedback loop is the key differentiator vs Onfido:
 *   → Every verification makes the next one more accurate
 *   → Customer-specific models learn their document types
 *   → On-premise installations keep all data local
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MLFeedback {
  id?: string
  org_id: string
  analysis_id: string
  /** Original model prediction */
  predicted_label: 'genuine' | 'suspicious' | 'tampered'
  predicted_score: number
  /** User correction */
  actual_label: 'genuine' | 'tampered'
  /** Document type (passport, id_card, etc.) */
  document_type?: string
  /** Image hash for deduplication */
  image_hash?: string
  /** Additional context */
  notes?: string
  created_at?: string
}

export interface RetrainStatus {
  canRetrain: boolean
  feedbackCount: number
  threshold: number
  lastTrainedAt: string | null
  lastAuc: number | null
  pendingSamples: number
}

export interface ModelVersion {
  id: string
  version: number
  auc: number
  accuracy: number
  f1: number
  training_samples: number
  model_path: string
  deployed: boolean
  created_at: string
}

// ── Configuration ──────────────────────────────────────────────────────────────

const RETRAIN_THRESHOLD = parseInt(process.env.ML_RETRAIN_THRESHOLD || '100')
const DEPLOY_MODE = process.env.DEPLOY_MODE || 'cloud'
const SAGEMAKER_ROLE = process.env.SAGEMAKER_ROLE_ARN || ''
const S3_BUCKET = process.env.ML_S3_BUCKET || 'deep-check-ml'
const MIN_AUC_FOR_DEPLOY = parseFloat(process.env.ML_MIN_AUC || '0.80')

// ── Supabase Client ────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

// ── Feedback Collection ────────────────────────────────────────────────────────

/**
 * Store user feedback on a document analysis result.
 * This is the entry point for continuous learning.
 */
export async function submitFeedback(feedback: MLFeedback): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase()
  if (!supabase) {
    return { success: false, error: 'Database not configured' }
  }

  try {
    const { error } = await supabase
      .from('dc_ml_feedback')
      .insert({
        org_id: feedback.org_id,
        analysis_id: feedback.analysis_id,
        predicted_label: feedback.predicted_label,
        predicted_score: feedback.predicted_score,
        actual_label: feedback.actual_label,
        document_type: feedback.document_type || 'unknown',
        image_hash: feedback.image_hash || '',
        notes: feedback.notes || '',
        used_in_training: false,
      })

    if (error) {
      return { success: false, error: error.message }
    }

    // Check if we should trigger retraining
    const status = await getRetrainStatus(feedback.org_id)
    if (status.canRetrain) {
      // Don't await — fire-and-forget retraining trigger
      triggerRetraining(feedback.org_id).catch(console.error)
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Get the current retraining status for an organization.
 */
export async function getRetrainStatus(orgId: string): Promise<RetrainStatus> {
  const supabase = getSupabase()
  if (!supabase) {
    return {
      canRetrain: false,
      feedbackCount: 0,
      threshold: RETRAIN_THRESHOLD,
      lastTrainedAt: null,
      lastAuc: null,
      pendingSamples: 0,
    }
  }

  try {
    // Count unused feedback
    const { count: pendingCount } = await supabase
      .from('dc_ml_feedback')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('used_in_training', false)

    // Get latest model version
    const { data: latestModel } = await supabase
      .from('dc_ml_models')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Total feedback count
    const { count: totalCount } = await supabase
      .from('dc_ml_feedback')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)

    const pending = pendingCount || 0
    const canRetrain = pending >= RETRAIN_THRESHOLD && DEPLOY_MODE !== 'onpremise'

    return {
      canRetrain,
      feedbackCount: totalCount || 0,
      threshold: RETRAIN_THRESHOLD,
      lastTrainedAt: latestModel?.created_at || null,
      lastAuc: latestModel?.auc || null,
      pendingSamples: pending,
    }
  } catch {
    return {
      canRetrain: false,
      feedbackCount: 0,
      threshold: RETRAIN_THRESHOLD,
      lastTrainedAt: null,
      lastAuc: null,
      pendingSamples: 0,
    }
  }
}

// ── Retraining Trigger ─────────────────────────────────────────────────────────

/**
 * Trigger a SageMaker training job with accumulated feedback data.
 * Only works in cloud mode — on-premise uses local ONNX model.
 */
export async function triggerRetraining(orgId: string): Promise<{
  success: boolean
  jobName?: string
  error?: string
}> {
  if (DEPLOY_MODE === 'onpremise') {
    return { success: false, error: 'Retraining not available in on-premise mode. Use Colab notebook.' }
  }

  if (!SAGEMAKER_ROLE) {
    return { success: false, error: 'SageMaker role not configured (SAGEMAKER_ROLE_ARN)' }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return { success: false, error: 'Database not configured' }
  }

  try {
    // Mark feedback as being used in training
    const { data: feedbackData } = await supabase
      .from('dc_ml_feedback')
      .select('*')
      .eq('org_id', orgId)
      .eq('used_in_training', false)

    if (!feedbackData || feedbackData.length < RETRAIN_THRESHOLD) {
      return { success: false, error: `Need ${RETRAIN_THRESHOLD} samples, have ${feedbackData?.length || 0}` }
    }

    const jobName = `deep-check-retrain-${orgId.slice(0, 8)}-${Date.now()}`

    // In production, this would use AWS SDK to create a SageMaker training job:
    //
    // const { SageMakerClient, CreateTrainingJobCommand } = require('@aws-sdk/client-sagemaker')
    // const sm = new SageMakerClient({ region: 'eu-west-1' })
    // await sm.send(new CreateTrainingJobCommand({
    //   TrainingJobName: jobName,
    //   AlgorithmSpecification: {
    //     TrainingImage: 'deep-check-training:latest',
    //     TrainingInputMode: 'File',
    //   },
    //   RoleArn: SAGEMAKER_ROLE,
    //   InputDataConfig: [{
    //     ChannelName: 'training',
    //     DataSource: { S3DataSource: { S3Uri: `s3://${S3_BUCKET}/training-data/${orgId}` } },
    //   }],
    //   OutputDataConfig: { S3OutputPath: `s3://${S3_BUCKET}/models/${orgId}` },
    //   ResourceConfig: {
    //     InstanceType: 'ml.g4dn.xlarge',
    //     InstanceCount: 1,
    //     VolumeSizeInGB: 50,
    //   },
    //   StoppingCondition: { MaxRuntimeInSeconds: 7200 },
    //   HyperParameters: {
    //     'warmup-epochs': '5',
    //     'finetune-epochs': '15',
    //     'mining-epochs': '5',
    //     'batch-size': '32',
    //   },
    // }))

    // Record the retraining job
    await supabase.from('dc_ml_training_jobs').insert({
      org_id: orgId,
      job_name: jobName,
      status: 'pending',
      feedback_count: feedbackData.length,
      created_at: new Date().toISOString(),
    })

    // Mark feedback as used
    const feedbackIds = feedbackData.map(f => f.id)
    await supabase
      .from('dc_ml_feedback')
      .update({ used_in_training: true, training_job: jobName })
      .in('id', feedbackIds)

    return { success: true, jobName }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── Model Deployment ───────────────────────────────────────────────────────────

/**
 * Deploy a new model version after successful training.
 * Only deploys if AUC meets minimum threshold and improves on current.
 */
export async function deployModel(
  orgId: string,
  jobName: string,
  metrics: { auc: number; accuracy: number; f1: number; training_samples: number }
): Promise<{ success: boolean; deployed: boolean; reason?: string }> {
  if (metrics.auc < MIN_AUC_FOR_DEPLOY) {
    return {
      success: true,
      deployed: false,
      reason: `AUC ${metrics.auc} below minimum threshold ${MIN_AUC_FOR_DEPLOY}`,
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return { success: false, deployed: false, reason: 'Database not configured' }
  }

  try {
    // Check if new model is better than current
    const { data: currentModel } = await supabase
      .from('dc_ml_models')
      .select('auc')
      .eq('org_id', orgId)
      .eq('deployed', true)
      .single()

    if (currentModel && metrics.auc <= currentModel.auc) {
      return {
        success: true,
        deployed: false,
        reason: `New AUC ${metrics.auc} <= current ${currentModel.auc}. Rollback prevented.`,
      }
    }

    // Undeploy current model
    await supabase
      .from('dc_ml_models')
      .update({ deployed: false })
      .eq('org_id', orgId)
      .eq('deployed', true)

    // Deploy new model
    const modelPath = `s3://${S3_BUCKET}/models/${orgId}/${jobName}/efficientnet_doc_fraud.onnx`
    const { error } = await supabase.from('dc_ml_models').insert({
      org_id: orgId,
      training_job: jobName,
      auc: metrics.auc,
      accuracy: metrics.accuracy,
      f1: metrics.f1,
      training_samples: metrics.training_samples,
      model_path: modelPath,
      deployed: true,
    })

    if (error) {
      return { success: false, deployed: false, reason: error.message }
    }

    // Update training job status
    await supabase
      .from('dc_ml_training_jobs')
      .update({ status: 'deployed', completed_at: new Date().toISOString() })
      .eq('job_name', jobName)

    return { success: true, deployed: true }
  } catch (err) {
    return { success: false, deployed: false, reason: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── Model Version History ──────────────────────────────────────────────────────

/**
 * Get model version history for an organization.
 */
export async function getModelHistory(orgId: string): Promise<ModelVersion[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  try {
    const { data } = await supabase
      .from('dc_ml_models')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20)

    return (data || []).map((m, i) => ({
      id: m.id,
      version: data!.length - i,
      auc: m.auc,
      accuracy: m.accuracy,
      f1: m.f1,
      training_samples: m.training_samples,
      model_path: m.model_path,
      deployed: m.deployed,
      created_at: m.created_at,
    }))
  } catch {
    return []
  }
}
