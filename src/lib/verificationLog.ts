/**
 * verificationLog.ts — Store verification results for continuous learning
 * ========================================================================
 * Every verification is logged to Supabase (dc_admissions_verifications).
 * Users can submit feedback (correct/incorrect) which is used to:
 *   - Adjust scoring thresholds over time
 *   - Track false positive/negative rates per document type
 *   - Train future ML models with labeled ground truth
 */

import { createClient } from '@insforge/sdk'
import crypto from 'crypto'

// ── Supabase client ─────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  })
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface VerificationLogEntry {
  documentType:       string
  documentLabel:      string
  authenticityScore:  number
  verdict:            string
  frequencyScore:     number
  semanticScore:      number
  faceQualityScore:   number
  elaScore:           number
  exifScore:          number
  textConsistency:    number
  crossValidation:    number
  ghostScore:         number
  wordAnomalyScore:   number
  manipulationScore:  number
  overallRiskScore:   number
  ocrConfidence:      number
  mrzDetected:        boolean
  mrzValid:           boolean | null
  extractedName:      string | null
  extractedDocNumber: string | null
  alertCount:         number
  criticalAlerts:     number
  processingMs:       number
  backImageUsed:      boolean
  imageHash:          string
}

// ── Image hash (fast, for dedup) ────────────────────────────────────────────

export function computeImageHash(imageBase64: string): string {
  const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
  // Use first 2048 chars + last 2048 chars for fast fingerprinting
  const sample = b64.length > 4096
    ? b64.slice(0, 2048) + b64.slice(-2048)
    : b64
  return crypto.createHash('sha256').update(sample).digest('hex').slice(0, 32)
}

// ── Log a verification ──────────────────────────────────────────────────────

export async function logVerification(entry: VerificationLogEntry): Promise<string | null> {
  const sb = getClient()
  if (!sb) {
    console.warn('[verificationLog] No Supabase client — skipping log')
    return null
  }

  try {
    const { data, error } = await sb.database
      .from('dc_admissions_verifications')
      .insert({
        document_type:       entry.documentType,
        document_label:      entry.documentLabel,
        authenticity_score:  entry.authenticityScore,
        verdict:             entry.verdict,
        frequency_score:     entry.frequencyScore,
        semantic_score:      entry.semanticScore,
        face_quality_score:  entry.faceQualityScore,
        ela_score:           entry.elaScore,
        exif_score:          entry.exifScore,
        text_consistency:    entry.textConsistency,
        cross_validation:    entry.crossValidation,
        ghost_score:         entry.ghostScore,
        word_anomaly_score:  entry.wordAnomalyScore,
        manipulation_score:  entry.manipulationScore,
        overall_risk_score:  entry.overallRiskScore,
        ocr_confidence:      entry.ocrConfidence,
        mrz_detected:        entry.mrzDetected,
        mrz_valid:           entry.mrzValid,
        extracted_name:      entry.extractedName,
        extracted_doc_number: entry.extractedDocNumber,
        alert_count:         entry.alertCount,
        critical_alerts:     entry.criticalAlerts,
        processing_ms:       entry.processingMs,
        back_image_used:     entry.backImageUsed,
        image_hash:          entry.imageHash,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[verificationLog] Insert error:', error.message)
      return null
    }

    console.log(`[verificationLog] Logged verification ${data?.id}`)
    return data?.id ?? null
  } catch (err) {
    console.error('[verificationLog] Error:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Submit feedback ─────────────────────────────────────────────────────────

export async function submitFeedback(
  verificationId: string,
  correct: boolean,
  expectedVerdict?: string,
): Promise<boolean> {
  const sb = getClient()
  if (!sb) return false

  try {
    const { error } = await sb.database
      .from('dc_admissions_verifications')
      .update({
        feedback_correct:  correct,
        feedback_expected: expectedVerdict ?? null,
        feedback_at:       new Date().toISOString(),
      })
      .eq('id', verificationId)

    if (error) {
      console.error('[verificationLog] Feedback error:', error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}

// ── Get learning stats ──────────────────────────────────────────────────────

export interface LearningStats {
  totalVerifications:     number
  feedbackCount:          number
  correctCount:           number
  incorrectCount:         number
  falsePositiveRate:      number  // marked as tampered but user said correct
  falseNegativeRate:      number  // marked as authentic but user said wrong
  avgScoreByDocType:      Record<string, number>
  avgGhostByDocType:      Record<string, number>
}

export async function getLearningStats(): Promise<LearningStats | null> {
  const sb = getClient()
  if (!sb) return null

  try {
    const { data, error } = await sb.database
      .from('dc_admissions_verifications')
      .select('document_type, authenticity_score, verdict, ghost_score, feedback_correct, feedback_expected')

    if (error || !data) return null

    const total = data.length
    const withFeedback = data.filter(r => r.feedback_correct !== null)
    const correct = withFeedback.filter(r => r.feedback_correct === true)
    const incorrect = withFeedback.filter(r => r.feedback_correct === false)

    // False positives: system said tampered but user said it's correct
    const falsePositives = incorrect.filter(r => r.verdict === 'tampered')
    // False negatives: system said authentic but user said it's wrong
    const falseNegatives = incorrect.filter(r => r.verdict === 'authentic')

    // Average score by doc type
    const byType: Record<string, { scores: number[]; ghosts: number[] }> = {}
    for (const r of data) {
      if (!byType[r.document_type]) byType[r.document_type] = { scores: [], ghosts: [] }
      byType[r.document_type].scores.push(r.authenticity_score)
      byType[r.document_type].ghosts.push(r.ghost_score ?? 0)
    }

    const avgScoreByDocType: Record<string, number> = {}
    const avgGhostByDocType: Record<string, number> = {}
    for (const [type, { scores, ghosts }] of Object.entries(byType)) {
      avgScoreByDocType[type] = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
      avgGhostByDocType[type] = Math.round(ghosts.reduce((s, v) => s + v, 0) / ghosts.length)
    }

    return {
      totalVerifications: total,
      feedbackCount:      withFeedback.length,
      correctCount:       correct.length,
      incorrectCount:     incorrect.length,
      falsePositiveRate:  withFeedback.length > 0 ? falsePositives.length / withFeedback.length : 0,
      falseNegativeRate:  withFeedback.length > 0 ? falseNegatives.length / withFeedback.length : 0,
      avgScoreByDocType,
      avgGhostByDocType,
    }
  } catch {
    return null
  }
}
