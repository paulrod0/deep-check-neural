/**
 * POST /api/v1/batch — Async Batch Document Verification
 * GET  /api/v1/batch?jobId=... — Poll job status
 * ======================================================
 *
 * Handles large-scale document verification batches (up to 100 documents).
 * Unlike the synchronous /api/v1/verify batch mode (max 10), this endpoint
 * creates a background job, processes documents concurrently (5 at a time),
 * and returns a jobId for polling.
 *
 * Enterprise customers use this for:
 *   - University bulk enrollment verification
 *   - Government immigration batch screening
 *   - Corporate onboarding document checks
 *
 * Authentication: Bearer token via API key (requires 'write' permission)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseMRZ } from '@/lib/mrzParser'
import { autoValidateDocument, getCountryByCode } from '@/lib/countryValidators'
import { validateApiKey, initDb } from '@/lib/db'

// ── Config ──────────────────────────────────────────────────────────────────────

const IS_ONPREMISE = process.env.DEPLOY_MODE === 'onpremise'
const HAS_AWS = !IS_ONPREMISE && Boolean(process.env.AWS_ACCESS_KEY_ID)
const MAX_BATCH_SIZE = 100
const CONCURRENCY = 5

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── In-memory job store (replaced by DB in production) ──────────────────────

interface BatchDocument {
  documentFront: string
  documentType: string
  documentBack?: string
  rawText?: string
  externalRef?: string
}

interface BatchResult {
  index: number
  certificateId: string
  verdict: 'authentic' | 'suspicious' | 'tampered'
  documentType: string
  holderName: string | null
  nationality: string | null
  docNumber: string | null
  mrzValid: boolean
  riskScore: number
  countryValidation: { valid: boolean; country: string; details?: string } | null
  verifyUrl: string
  externalRef?: string
  processingMs: number
  error?: string
}

interface BatchJob {
  jobId: string
  status: 'processing' | 'completed' | 'failed'
  createdAt: string
  completedAt: string | null
  totalDocuments: number
  processedDocuments: number
  results: BatchResult[]
  verdicts: { authentic: number; suspicious: number; tampered: number }
  webhookUrl?: string
  apiKeyId: string
}

// In-memory store for active jobs (would use Redis/DB in production)
const jobStore = new Map<string, BatchJob>()

// ── CORS ────────────────────────────────────────────────────────────────────────

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  return res
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

// ── Process a single document ───────────────────────────────────────────────

async function processDocument(doc: BatchDocument, index: number): Promise<BatchResult> {
  const t0 = Date.now()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://deep-check.io'

  try {
    // 1. OCR + MRZ
    let ocrText = doc.rawText || ''
    if (HAS_AWS && !doc.rawText) {
      try {
        const { runTextractAnalysis } = await import('@/lib/textractAnalysis')
        const textractResult = await runTextractAnalysis(doc.documentFront)
        ocrText = textractResult.rawText
      } catch { /* non-fatal */ }
    }

    const mrzResult = parseMRZ(ocrText)
    const fields = mrzResult.fields

    // 2. Country validation
    const natCode = fields.nationality || fields.issuingCountry
    let countryValidation: BatchResult['countryValidation'] = null
    if (natCode && fields.docNumber) {
      const cv = autoValidateDocument(natCode, fields.docNumber)
      if (cv) {
        countryValidation = {
          valid: cv.valid,
          country: cv.country,
          details: cv.details,
        }
      }
    }

    // 3. Verdict
    let verdict: 'authentic' | 'suspicious' | 'tampered' = 'authentic'
    if (mrzResult.checksumsFailed > 0) verdict = 'suspicious'
    if (mrzResult.checksumsFailed >= 2) verdict = 'tampered'

    // 4. Save to DB
    let certificateId = `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const supabase = getSupabase()
    if (supabase) {
      try {
        const countryInfo = natCode ? getCountryByCode(natCode) : undefined
        const { data } = await supabase
          .from('dc_document_analyses')
          .insert({
            filename: `batch_${doc.documentType}_${Date.now()}_${index}`,
            risk_score: 0,
            risk_level: verdict === 'authentic' ? 'clean' : verdict,
            ela_score: 0, exif_score: 0, noise_score: 0,
            dct_score: 0, chroma_score: 0, edge_score: 0,
            manipulation_prob: 0,
            alerts: mrzResult.alerts,
            findings: {
              verdict,
              documentType: doc.documentType,
              mrzValid: mrzResult.valid,
              mrzFields: fields,
              batchVerification: true,
              batchIndex: index,
              externalRef: doc.externalRef,
              countryValidation,
              countryInfo: countryInfo ? { name: countryInfo.name, region: countryInfo.region } : null,
            },
            case_ref: doc.externalRef || 'batch_verification',
            submitted_by: 'api_v1_batch',
          })
          .select('id')
          .single()
        if (data?.id) certificateId = data.id
      } catch { /* non-fatal */ }
    }

    const holderName = fields.givenNames
      ? `${fields.givenNames} ${fields.surname || ''}`.trim()
      : null

    return {
      index,
      certificateId,
      verdict,
      documentType: doc.documentType,
      holderName,
      nationality: fields.nationality || null,
      docNumber: fields.docNumber || null,
      mrzValid: mrzResult.valid,
      riskScore: 0,
      countryValidation,
      verifyUrl: `${baseUrl}/verify/${certificateId}`,
      externalRef: doc.externalRef,
      processingMs: Date.now() - t0,
    }
  } catch (err) {
    return {
      index,
      certificateId: '',
      verdict: 'tampered',
      documentType: doc.documentType,
      holderName: null,
      nationality: null,
      docNumber: null,
      mrzValid: false,
      riskScore: 100,
      countryValidation: null,
      verifyUrl: '',
      externalRef: doc.externalRef,
      processingMs: Date.now() - t0,
      error: (err as Error).message,
    }
  }
}

// ── Process batch with concurrency control ───────────────────────────────────

async function processBatch(job: BatchJob, documents: BatchDocument[]) {
  const results: BatchResult[] = []
  const verdicts = { authentic: 0, suspicious: 0, tampered: 0 }

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < documents.length; i += CONCURRENCY) {
    const chunk = documents.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(
      chunk.map((doc, j) => processDocument(doc, i + j))
    )

    for (const result of chunkResults) {
      results.push(result)
      if (result.verdict in verdicts) {
        verdicts[result.verdict as keyof typeof verdicts]++
      }
      job.processedDocuments++
    }

    // Update job in store
    job.results = results
    job.verdicts = verdicts
    jobStore.set(job.jobId, { ...job })
  }

  // Mark complete
  job.status = 'completed'
  job.completedAt = new Date().toISOString()
  job.results = results
  job.verdicts = verdicts
  jobStore.set(job.jobId, { ...job })

  // Save job summary to DB
  const supabase = getSupabase()
  if (supabase) {
    try {
      await supabase
        .from('dc_document_analyses')
        .insert({
          filename: `batch_summary_${job.jobId}`,
          risk_score: 0,
          risk_level: 'clean',
          ela_score: 0, exif_score: 0, noise_score: 0,
          dct_score: 0, chroma_score: 0, edge_score: 0,
          manipulation_prob: 0,
          alerts: [],
          findings: {
            batchJobId: job.jobId,
            totalDocuments: job.totalDocuments,
            verdicts: job.verdicts,
            completedAt: job.completedAt,
            certificateIds: results.map(r => r.certificateId),
          },
          case_ref: `batch_job_${job.jobId}`,
          submitted_by: 'api_v1_batch',
        })
    } catch { /* non-fatal */ }
  }

  // Webhook callback
  if (job.webhookUrl) {
    try {
      await fetch(job.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'batch_complete',
          jobId: job.jobId,
          status: 'completed',
          totalDocuments: job.totalDocuments,
          verdicts: job.verdicts,
          results: results.map(r => ({
            index: r.index,
            certificateId: r.certificateId,
            verdict: r.verdict,
            holderName: r.holderName,
            verifyUrl: r.verifyUrl,
            externalRef: r.externalRef,
          })),
          completedAt: job.completedAt,
        }),
      })
    } catch { /* fire-and-forget */ }
  }

  // Auto-cleanup: remove completed jobs after 1 hour
  setTimeout(() => {
    jobStore.delete(job.jobId)
  }, 3600_000)
}

// ── POST: Create batch job ──────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth
  const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!apiKey) {
    return cors(NextResponse.json(
      { success: false, error: 'Missing API key. Pass Authorization: Bearer dc_live_...' },
      { status: 401 },
    ))
  }

  await initDb()
  const keyRecord = await validateApiKey(apiKey)
  if (!keyRecord || !keyRecord.permissions.includes('write')) {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid API key or insufficient permissions' },
      { status: 401 },
    ))
  }

  let body: { documents: BatchDocument[]; webhookUrl?: string }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    ))
  }

  if (!Array.isArray(body.documents) || body.documents.length === 0) {
    return cors(NextResponse.json(
      { success: false, error: 'documents array is required and must not be empty' },
      { status: 400 },
    ))
  }

  if (body.documents.length > MAX_BATCH_SIZE) {
    return cors(NextResponse.json(
      { success: false, error: `Maximum ${MAX_BATCH_SIZE} documents per batch request` },
      { status: 400 },
    ))
  }

  // Validate each document
  for (let i = 0; i < body.documents.length; i++) {
    const doc = body.documents[i]
    if (!doc.documentFront || !doc.documentType) {
      return cors(NextResponse.json(
        { success: false, error: `Document at index ${i} missing documentFront or documentType` },
        { status: 400 },
      ))
    }
  }

  // Create job
  const jobId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const job: BatchJob = {
    jobId,
    status: 'processing',
    createdAt: new Date().toISOString(),
    completedAt: null,
    totalDocuments: body.documents.length,
    processedDocuments: 0,
    results: [],
    verdicts: { authentic: 0, suspicious: 0, tampered: 0 },
    webhookUrl: body.webhookUrl,
    apiKeyId: keyRecord.key,
  }

  jobStore.set(jobId, job)

  // Start processing in background (non-blocking)
  processBatch(job, body.documents).catch(err => {
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    jobStore.set(jobId, { ...job })
    console.error(`[batch] Job ${jobId} failed:`, err)
  })

  return cors(NextResponse.json({
    success: true,
    data: {
      jobId,
      status: 'processing',
      totalDocuments: body.documents.length,
      pollUrl: `/api/v1/batch?jobId=${jobId}`,
      estimatedTimeMs: body.documents.length * 2000, // ~2s per doc estimate
    },
  }))
}

// ── GET: Poll job status ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!apiKey) {
    return cors(NextResponse.json(
      { success: false, error: 'Missing API key' },
      { status: 401 },
    ))
  }

  await initDb()
  const keyRecord = await validateApiKey(apiKey)
  if (!keyRecord) {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid API key' },
      { status: 401 },
    ))
  }

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return cors(NextResponse.json(
      { success: false, error: 'jobId query parameter required' },
      { status: 400 },
    ))
  }

  const job = jobStore.get(jobId)
  if (!job) {
    return cors(NextResponse.json(
      { success: false, error: 'Job not found or expired (jobs expire after 1 hour)' },
      { status: 404 },
    ))
  }

  // Only allow the owner to check their job
  if (job.apiKeyId !== keyRecord.key) {
    return cors(NextResponse.json(
      { success: false, error: 'Job not found' },
      { status: 404 },
    ))
  }

  return cors(NextResponse.json({
    success: true,
    data: {
      jobId: job.jobId,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      progress: job.totalDocuments > 0
        ? Math.round((job.processedDocuments / job.totalDocuments) * 100)
        : 0,
      verdicts: job.verdicts,
      // Only include full results when completed
      results: job.status === 'completed' ? job.results : undefined,
    },
  }))
}
