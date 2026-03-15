/**
 * POST /api/documents/verify
 * ==========================
 * Server-side KYC verification pipeline (cloud-side step).
 *
 * Performs:
 *   1. AWS Textract OCR + MRZ field extraction (cloud mode)
 *      OR pure-regex MRZ parse on client-provided rawText (on-premise)
 *   2. AWS Rekognition face quality analysis (cloud mode only)
 *   3. Combined verdict + save to dc_document_analyses
 *
 * NOTE: Image forensics (ELA/EXIF) and face match are done CLIENT-SIDE
 * in analyzeImage() and compareFaces() respectively. The client passes
 * the forensics report in the request body. This matches the pattern
 * used by /api/documents — client computes, server stores.
 *
 * Zero biometric data is processed server-side in on-premise mode.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseMRZ } from '@/lib/mrzParser'
import type { ForensicsReport } from '@/lib/imageForensics'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface VerifyRequest {
  documentFront: string           // base64 or data URL (for AWS calls)
  documentType:  string           // 'passport' | 'dni' | 'driving_license'
  documentBack?: string
  /** Pre-computed client-side forensics report */
  forensicsReport?: Partial<ForensicsReport>
  /** Raw OCR text if client performed local OCR (e.g. tesseract) */
  rawText?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IS_ONPREMISE = process.env.DEPLOY_MODE === 'onpremise'
const HAS_AWS      = !IS_ONPREMISE && Boolean(process.env.AWS_ACCESS_KEY_ID)

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeVerdict(
  forensicsRisk: number,
  mrzValid:      boolean | null,
  faceQuality:   number,
): 'authentic' | 'suspicious' | 'tampered' {
  if (forensicsRisk >= 70)                              return 'tampered'
  if (forensicsRisk >= 40 || faceQuality >= 40 ||
      mrzValid === false)                               return 'suspicious'
  return 'authentic'
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: VerifyRequest
  try {
    body = await req.json() as VerifyRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { documentFront, documentType, forensicsReport, rawText } = body
  if (!documentFront || !documentType) {
    return NextResponse.json(
      { error: 'documentFront and documentType are required' },
      { status: 400 },
    )
  }

  // Client-provided forensics (computed by analyzeImage in browser)
  const forensicsRisk   = forensicsReport?.riskScore  ?? 0
  const forensicsLevel  = forensicsReport?.riskLevel  ?? 'clean'
  const forensicsAlerts = forensicsReport?.alerts     ?? []

  // ── 1. OCR + MRZ ──────────────────────────────────────────────────────────
  let ocrRawText     = rawText ?? ''
  let semanticAlerts: unknown[] = []
  let ocrMode        = 'none'

  if (HAS_AWS) {
    try {
      const { runTextractAnalysis } = await import('@/lib/textractAnalysis')
      const textractResult = await runTextractAnalysis(documentFront)
      ocrRawText     = textractResult.rawText
      semanticAlerts = textractResult.semanticAlerts
      ocrMode        = 'textract'
    } catch (err) {
      console.warn('[verify] Textract error:', (err as Error).message)
      ocrMode = 'textract_failed'
    }
  } else if (rawText) {
    ocrMode = 'client_ocr'
  }

  // MRZ parse (works on any OCR text, including empty → returns no MRZ alert)
  const mrzResult = parseMRZ(ocrRawText)

  // ── 2. Face quality via Rekognition (cloud only) ───────────────────────────
  let faceQualityScore = 0
  let faceCount        = 0
  let faceSuspicious   = false

  if (HAS_AWS) {
    try {
      const { runRekognitionAnalysis } = await import('@/lib/rekognitionAnalysis')
      const rek = await runRekognitionAnalysis(documentFront, documentType)
      faceQualityScore = rek.faceQualityScore
      faceCount        = rek.faceCount
      faceSuspicious   = rek.hasSuspiciousQuality
    } catch (err) {
      console.warn('[verify] Rekognition error:', (err as Error).message)
    }
  }

  // ── 3. Verdict ────────────────────────────────────────────────────────────
  const verdict = computeVerdict(
    forensicsRisk,
    mrzResult.valid ? true : (mrzResult.rawLines.length > 0 ? false : null),
    faceQualityScore,
  )

  // ── 4. Save to database ───────────────────────────────────────────────────
  let certificateId = `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  try {
    const supabase = getClient()
    const allAlerts = [
      ...(forensicsAlerts as import('@/lib/imageForensics').ForensicAlert[]).map(a => ({
        code: a.code,
        label: a.label,
        detail: a.detail,
        severity: a.severity,
      })),
      ...mrzResult.alerts.map(a => ({ code: a.field, label: a.field, detail: a.detail, severity: 'high' as const })),
    ]

    const { data } = await supabase
      .from('dc_document_analyses')
      .insert({
        filename:          `${documentType}_kyc_${Date.now()}`,
        risk_score:        forensicsRisk,
        risk_level:        forensicsLevel,
        ela_score:         forensicsReport?.elaScore   ?? 0,
        exif_score:        forensicsReport?.exifScore  ?? 0,
        noise_score:       forensicsReport?.noiseScore ?? 0,
        dct_score:         forensicsReport?.dctScore   ?? 0,
        chroma_score:      forensicsReport?.chromaScore ?? 0,
        edge_score:        forensicsReport?.edgeScore  ?? 0,
        manipulation_prob: forensicsRisk / 100,
        alerts:            allAlerts,
        findings: {
          verdict,
          documentType,
          mrzValid:        mrzResult.valid,
          mrzFields:       mrzResult.fields,
          mrzAlerts:       mrzResult.alerts,
          semanticAlerts,
          faceQualityScore,
          faceSuspicious,
          ocrMode,
          onPremise:       IS_ONPREMISE,
        },
        case_ref:          'identity_verification',
        submitted_by:      'kyc_wizard',
      })
      .select('id')
      .single()

    if (data?.id) certificateId = data.id
  } catch (err) {
    console.warn('[verify] DB save error (non-fatal):', (err as Error).message)
  }

  // ── Response ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    ocr: {
      rawTextSnippet:  ocrRawText.slice(0, 400),
      mrzValid:        mrzResult.valid,
      mrzDocumentType: mrzResult.documentType,
      mrzFields:       mrzResult.fields,
      mrzAlerts:       mrzResult.alerts,
      checksumsPassed: mrzResult.checksumsPassed,
      checksumsFailed: mrzResult.checksumsFailed,
      semanticAlerts,
      ocrMode,
    },
    faceQuality: {
      faceFound:     faceCount > 0,
      faceCount,
      qualityScore:  faceQualityScore,
      suspicious:    faceSuspicious,
    },
    verdict,
    certificateId,
    onPremise: IS_ONPREMISE,
  })
}
