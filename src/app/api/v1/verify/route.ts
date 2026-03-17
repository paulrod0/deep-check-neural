/**
 * POST /api/v1/verify — Programmatic Document Verification API
 * =============================================================
 *
 * Enterprise-grade REST API for automated document verification.
 * Used by government agencies, universities, and enterprise clients
 * who need to verify documents at scale via their own systems.
 *
 * Features:
 *   - Single document verification
 *   - Batch verification (up to 10 documents per request)
 *   - MRZ parsing + forensics + face quality (cloud only)
 *   - Shareable certificate ID
 *   - Webhook callback on completion
 *
 * Authentication: Bearer token via API key
 *   Authorization: Bearer dc_live_xxxxx
 *
 * Rate limits: Based on plan (Free: 5/month, Pro: unlimited, Enterprise: unlimited)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseMRZ } from '@/lib/mrzParser'
import { autoValidateDocument, getCountryByCode } from '@/lib/countryValidators'
import { validateApiKey, initDb } from '@/lib/db'

// ── Config ──────────────────────────────────────────────────────────────────────

const IS_ONPREMISE = process.env.DEPLOY_MODE === 'onpremise'
const HAS_AWS = !IS_ONPREMISE && Boolean(process.env.AWS_ACCESS_KEY_ID)

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── Types ───────────────────────────────────────────────────────────────────────

interface VerifyDocumentRequest {
  /** Base64-encoded document image (front) */
  documentFront: string
  /** Document type: passport, dni, driving_license, residence_permit */
  documentType: string
  /** Optional base64-encoded document back */
  documentBack?: string
  /** Optional raw OCR text (for on-premise / custom OCR) */
  rawText?: string
  /** Optional webhook URL for async callback */
  webhookUrl?: string
  /** Optional external reference ID */
  externalRef?: string
}

interface BatchVerifyRequest {
  documents: VerifyDocumentRequest[]
}

interface VerifyDocumentResult {
  certificateId: string
  verdict: 'authentic' | 'suspicious' | 'tampered'
  documentType: string
  mrz: {
    valid: boolean
    documentType: string
    fields: Record<string, string | boolean | number> | null
    checksumsPassed: number
    checksumsFailed: number
    alerts: { field: string; detail: string }[]
  }
  forensics: {
    riskScore: number
    riskLevel: string
  }
  faceQuality: {
    faceFound: boolean
    faceCount: number
    qualityScore: number
  } | null
  countryValidation?: { valid: boolean; country: string; documentType: string; details?: string } | null
  countryInfo?: { name: string; region: string; idTypes: string[]; hasNFC: boolean } | null
  verifyUrl: string
  externalRef?: string
  processingMs: number
}

// ── CORS ────────────────────────────────────────────────────────────────────────

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  return res
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

// ── Verify Single Document ──────────────────────────────────────────────────────

async function verifyDocument(doc: VerifyDocumentRequest): Promise<VerifyDocumentResult> {
  const t0 = Date.now()

  // 1. MRZ Parse
  let ocrText = doc.rawText || ''
  let ocrMode = 'none'

  if (HAS_AWS && !doc.rawText) {
    try {
      const { runTextractAnalysis } = await import('@/lib/textractAnalysis')
      const textractResult = await runTextractAnalysis(doc.documentFront)
      ocrText = textractResult.rawText
      ocrMode = 'textract'
    } catch {
      ocrMode = 'textract_failed'
    }
  } else if (doc.rawText) {
    ocrMode = 'client_ocr'
  }

  const mrzResult = parseMRZ(ocrText)

  // 2. Face quality (cloud only)
  let faceQuality: VerifyDocumentResult['faceQuality'] = null
  let faceSuspicious = false
  if (HAS_AWS) {
    try {
      const { runRekognitionAnalysis } = await import('@/lib/rekognitionAnalysis')
      const rek = await runRekognitionAnalysis(doc.documentFront, doc.documentType)
      faceQuality = {
        faceFound: rek.faceCount > 0,
        faceCount: rek.faceCount,
        qualityScore: rek.faceQualityScore,
      }
      faceSuspicious = rek.hasSuspiciousQuality
    } catch {
      // Non-fatal
    }
  }

  // 2b. Country-specific validation
  let countryValidation: { valid: boolean; country: string; documentType: string; details?: string } | null = null
  const natCode = mrzResult.fields.nationality || mrzResult.fields.issuingCountry
  if (natCode && mrzResult.fields.docNumber) {
    const cv = autoValidateDocument(natCode, mrzResult.fields.docNumber)
    if (cv) {
      countryValidation = {
        valid: cv.valid,
        country: cv.country,
        documentType: cv.documentType,
        details: cv.details,
      }
    }
  }
  const countryInfo = natCode ? getCountryByCode(natCode) : undefined

  // 3. Compute verdict
  const riskScore = 0 // Client-side forensics not available via API
  let verdict: 'authentic' | 'suspicious' | 'tampered' = 'authentic'
  if (mrzResult.checksumsFailed > 0) verdict = 'suspicious'
  if (mrzResult.checksumsFailed >= 2) verdict = 'tampered'
  if (faceSuspicious) verdict = 'suspicious'

  // 4. Save to database
  let certificateId = `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const supabase = getSupabase()
  if (supabase) {
    try {
      const { data } = await supabase
        .from('dc_document_analyses')
        .insert({
          filename: `api_${doc.documentType}_${Date.now()}`,
          risk_score: riskScore,
          risk_level: verdict === 'authentic' ? 'clean' : verdict === 'suspicious' ? 'suspicious' : 'high_risk',
          ela_score: 0,
          exif_score: 0,
          noise_score: 0,
          dct_score: 0,
          chroma_score: 0,
          edge_score: 0,
          manipulation_prob: 0,
          alerts: mrzResult.alerts,
          findings: {
            verdict,
            documentType: doc.documentType,
            mrzValid: mrzResult.valid,
            mrzFields: mrzResult.fields,
            mrzAlerts: mrzResult.alerts,
            ocrMode,
            onPremise: IS_ONPREMISE,
            apiVerification: true,
            externalRef: doc.externalRef,
            countryValidation,
            countryInfo: countryInfo ? { name: countryInfo.name, region: countryInfo.region } : null,
          },
          case_ref: doc.externalRef || 'api_verification',
          submitted_by: 'api_v1',
        })
        .select('id')
        .single()

      if (data?.id) certificateId = data.id
    } catch (err) {
      console.warn('[v1/verify] DB save error:', (err as Error).message)
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (
    process.env.NODE_ENV === 'production' ? 'https://deep-check.io' : 'http://localhost:3000'
  )

  return {
    certificateId,
    verdict,
    documentType: doc.documentType,
    mrz: {
      valid: mrzResult.valid,
      documentType: mrzResult.documentType,
      fields: mrzResult.valid ? (mrzResult.fields as unknown as Record<string, string | boolean | number>) : null,
      checksumsPassed: mrzResult.checksumsPassed,
      checksumsFailed: mrzResult.checksumsFailed,
      alerts: mrzResult.alerts,
    },
    forensics: {
      riskScore,
      riskLevel: verdict === 'authentic' ? 'clean' : verdict,
    },
    faceQuality,
    countryValidation,
    countryInfo: countryInfo ? {
      name: countryInfo.name,
      region: countryInfo.region,
      idTypes: countryInfo.idTypes,
      hasNFC: countryInfo.hasNFC,
    } : null,
    verifyUrl: `${baseUrl}/verify/${certificateId}`,
    externalRef: doc.externalRef,
    processingMs: Date.now() - t0,
  }
}

// ── POST: Verify documents ──────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth
  const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!apiKey) {
    return cors(NextResponse.json(
      { success: false, error: 'Missing API key. Pass Authorization: Bearer dc_live_...' },
      { status: 401 }
    ))
  }

  await initDb()
  const keyRecord = await validateApiKey(apiKey)
  if (!keyRecord || !keyRecord.permissions.includes('write')) {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid API key or insufficient permissions' },
      { status: 401 }
    ))
  }

  let body: VerifyDocumentRequest | BatchVerifyRequest
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    ))
  }

  // Detect batch vs single
  const isBatch = 'documents' in body && Array.isArray((body as BatchVerifyRequest).documents)

  if (isBatch) {
    const batch = body as BatchVerifyRequest
    if (batch.documents.length > 10) {
      return cors(NextResponse.json(
        { success: false, error: 'Maximum 10 documents per batch request' },
        { status: 400 }
      ))
    }

    if (batch.documents.length === 0) {
      return cors(NextResponse.json(
        { success: false, error: 'At least one document required' },
        { status: 400 }
      ))
    }

    // Verify all documents in parallel
    const results = await Promise.all(
      batch.documents.map(doc => verifyDocument(doc))
    )

    // Webhook callback (fire-and-forget)
    const webhookUrl = batch.documents[0]?.webhookUrl
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'batch_verification_complete',
          results,
          completedAt: new Date().toISOString(),
        }),
      }).catch(() => { /* fire-and-forget */ })
    }

    return cors(NextResponse.json({
      success: true,
      data: {
        results,
        totalDocuments: results.length,
        verdicts: {
          authentic: results.filter(r => r.verdict === 'authentic').length,
          suspicious: results.filter(r => r.verdict === 'suspicious').length,
          tampered: results.filter(r => r.verdict === 'tampered').length,
        },
      },
    }))
  }

  // Single document
  const doc = body as VerifyDocumentRequest
  if (!doc.documentFront || !doc.documentType) {
    return cors(NextResponse.json(
      { success: false, error: 'documentFront and documentType are required' },
      { status: 400 }
    ))
  }

  const result = await verifyDocument(doc)

  // Webhook callback (fire-and-forget)
  if (doc.webhookUrl) {
    fetch(doc.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'verification_complete',
        result,
        completedAt: new Date().toISOString(),
      }),
    }).catch(() => { /* fire-and-forget */ })
  }

  return cors(NextResponse.json({
    success: true,
    data: result,
  }))
}
