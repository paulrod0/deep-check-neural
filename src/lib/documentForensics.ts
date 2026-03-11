/**
 * documentForensics.ts — Server-side Document Forensics Orchestrator
 *
 * Coordinates 4 parallel server-side analyses:
 *   1. Textract — semantic validation (math errors, NIF/CIF, IBAN, MRZ)
 *   2. DocForensics CNN — document type classification + manipulation score
 *   3. Rekognition — face quality for ID docs, moderation for media
 *   4. Frequency — FFT spectral + wavelet splice detection
 *
 * Runs all 4 in parallel via Promise.allSettled (graceful degradation).
 * Returns combined result with 4 new signal scores + semantic alerts.
 */

import { runTextractAnalysis, type TextractResult, type SemanticAlert } from './textractAnalysis'
import { runDocForensicsCnn, type CnnResult, type DocumentClass } from './docForensicsCnn'
import { runRekognitionAnalysis, type RekognitionResult } from './rekognitionAnalysis'
import { runFrequencyAnalysis, type FrequencyResult } from './frequencyAnalysis'

// ── Types ──────────────────────────────────────────────────────────────────────

export type { DocumentClass, SemanticAlert }

export interface DocumentForensicsResult {
  documentType:      DocumentClass | null
  semanticScore:     number          // 0–100 (Textract semantic validation)
  cnnScore:          number          // 0–100 (CNN manipulation score)
  rekognitionScore:  number          // 0–100 (face quality anomaly)
  frequencyScore:    number          // 0–100 (FFT + wavelet)
  semanticAlerts:    SemanticAlert[]
  analysisMs:        number
  // Sub-results for XAI (optional, may be partial on error)
  textractResult?:   Partial<TextractResult>
  cnnResult?:        Partial<CnnResult>
  rekognitionResult?: Partial<RekognitionResult>
  frequencyResult?:  Partial<FrequencyResult>
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

export async function runDocumentForensics(
  imageBase64: string,
  options?: {
    enableTextract?:    boolean   // default: true
    enableCnn?:         boolean   // default: true
    enableRekognition?: boolean   // default: true
    enableFrequency?:   boolean   // default: true
  }
): Promise<DocumentForensicsResult> {
  const t0 = Date.now()
  const {
    enableTextract    = true,
    enableCnn         = true,
    enableRekognition = true,
    enableFrequency   = true,
  } = options ?? {}

  // ── Run all analyses in parallel ──────────────────────────────────────────
  const [
    textractSettled,
    cnnSettled,
    // Rekognition needs CNN result first to know document type — run it after CNN
    // Actually run all in parallel; pass null documentType initially
    frequencySettled,
  ] = await Promise.allSettled([
    enableTextract  ? runTextractAnalysis(imageBase64)  : Promise.resolve(null),
    enableCnn       ? runDocForensicsCnn(imageBase64)   : Promise.resolve(null),
    enableFrequency ? runFrequencyAnalysis(imageBase64) : Promise.resolve(null),
  ])

  // Extract CNN result first to get document type for Rekognition
  const cnnResult = cnnSettled.status === 'fulfilled' ? cnnSettled.value as CnnResult | null : null
  const documentType = cnnResult?.documentType ?? null

  // Now run Rekognition with document type context
  const rekognitionSettled = await Promise.allSettled([
    enableRekognition
      ? runRekognitionAnalysis(imageBase64, documentType ?? undefined)
      : Promise.resolve(null),
  ]).then(r => r[0])

  // ── Extract results safely ─────────────────────────────────────────────────
  const textractResult: TextractResult | null =
    textractSettled.status === 'fulfilled' ? textractSettled.value as TextractResult | null : null
  const rekognitionResult: RekognitionResult | null =
    rekognitionSettled.status === 'fulfilled' ? rekognitionSettled.value as RekognitionResult | null : null
  const frequencyResult: FrequencyResult | null =
    frequencySettled.status === 'fulfilled' ? frequencySettled.value as FrequencyResult | null : null

  // Log errors from failed analyses (but don't throw)
  if (textractSettled.status === 'rejected') {
    console.error('[documentForensics] Textract error:', textractSettled.reason)
  }
  if (cnnSettled.status === 'rejected') {
    console.error('[documentForensics] CNN error:', cnnSettled.reason)
  }
  if (rekognitionSettled.status === 'rejected') {
    console.error('[documentForensics] Rekognition error:', rekognitionSettled.reason)
  }
  if (frequencySettled.status === 'rejected') {
    console.error('[documentForensics] Frequency error:', frequencySettled.reason)
  }

  // ── Aggregate scores ───────────────────────────────────────────────────────
  const semanticScore    = textractResult?.semanticScore    ?? 0
  const cnnScore         = cnnResult?.score                 ?? 0
  const rekognitionScore = rekognitionResult?.score         ?? 0
  const frequencyScore   = frequencyResult?.score           ?? 0
  const semanticAlerts   = textractResult?.semanticAlerts   ?? []

  return {
    documentType,
    semanticScore,
    cnnScore,
    rekognitionScore,
    frequencyScore,
    semanticAlerts,
    analysisMs: Date.now() - t0,
    textractResult:    textractResult    ?? undefined,
    cnnResult:         cnnResult         ?? undefined,
    rekognitionResult: rekognitionResult ?? undefined,
    frequencyResult:   frequencyResult   ?? undefined,
  }
}
