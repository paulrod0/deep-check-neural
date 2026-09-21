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

import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@insforge/sdk'
import { parseMRZ } from '@/lib/mrzParser'
import { autoValidateDocument, getCountryByCode } from '@/lib/countryValidators'
import { validateApiKey, initDb } from '@/lib/db'
import { runDocForensics } from '@/lib/docForensics'

// ── Config ──────────────────────────────────────────────────────────────────────

const IS_ONPREMISE = process.env.DEPLOY_MODE === 'onpremise'
const HAS_AWS = !IS_ONPREMISE && Boolean(process.env.AWS_ACCESS_KEY_ID)
const MAX_BATCH_SIZE = 100
const CONCURRENCY = 5

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !key) return null
  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  })
}

// ── Job types (persisted in dc_batch_jobs — see migration 009) ──────────────

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
  // Tenant scope (org of the validated API key). Used for IDOR-safe polling.
  orgId: string | null
  // Documents to process — carried in-process to processBatch via after();
  // never persisted to the DB row (avoids storing raw document images).
  documents: BatchDocument[]
}

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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (
    process.env.NODE_ENV === 'production' ? 'https://deep-check.io' : 'http://localhost:3000'
  )

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

    // 3. Server-side document forensics (DINOv2 + ELA via ML worker, if configured).
    //    null => no worker / call failed => behave exactly as before (riskScore 0).
    const pTampered = await runDocForensics(doc.documentFront)
    const riskScore = pTampered === null ? 0 : Math.round(pTampered * 100)

    // 4. Verdict — combine MRZ checksums + forensics (only when forensics ran)
    let verdict: 'authentic' | 'suspicious' | 'tampered' = 'authentic'
    if (mrzResult.checksumsFailed > 0) verdict = 'suspicious'
    if (mrzResult.checksumsFailed >= 2) verdict = 'tampered'
    if (pTampered !== null) {
      if (pTampered >= 0.7) verdict = 'tampered'
      else if (pTampered >= 0.5 && verdict === 'authentic') verdict = 'suspicious'
    }

    // 5. Save to DB
    let certificateId = `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const supabase = getSupabase()
    if (supabase) {
      try {
        const countryInfo = natCode ? getCountryByCode(natCode) : undefined
        const { data } = await supabase.database
          .from('dc_document_analyses')
          .insert({
            filename: `batch_${doc.documentType}_${Date.now()}_${index}`,
            risk_score: riskScore,
            risk_level: verdict === 'authentic' ? 'clean' : verdict,
            ela_score: 0, exif_score: 0, noise_score: 0,
            dct_score: 0, chroma_score: 0, edge_score: 0,
            manipulation_prob: pTampered ?? 0,
            alerts: mrzResult.alerts,
            findings: {
              verdict,
              documentType: doc.documentType,
              forensicsAvailable: pTampered !== null,
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
      riskScore,
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

async function processBatch(job: BatchJob) {
  const documents = job.documents
  const results: BatchResult[] = []
  const verdicts = { authentic: 0, suspicious: 0, tampered: 0 }

  try {
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

      // Persist progress to dc_batch_jobs so polling (a different lambda) sees it.
      await updateJobRow(job.jobId, {
        processed_documents: job.processedDocuments,
        results,
        verdicts,
      })
    }
  } catch (err) {
    // Mark failed in the DB and stop — the GET poller will report status.
    await updateJobRow(job.jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      processed_documents: job.processedDocuments,
      results,
      verdicts,
    })
    console.error(`[batch] Job ${job.jobId} failed:`, (err as Error).message)
    return
  }

  // Mark complete
  job.status = 'completed'
  job.completedAt = new Date().toISOString()
  job.results = results
  job.verdicts = verdicts
  await updateJobRow(job.jobId, {
    status: 'completed',
    completed_at: job.completedAt,
    processed_documents: job.processedDocuments,
    results,
    verdicts,
  })

  // Save job summary to DB (org-scoped — dc_document_analyses.org_id added in
  // migration 002 and backfilled in 008).
  const supabase = getSupabase()
  if (supabase) {
    try {
      await supabase.database
        .from('dc_document_analyses')
        .insert({
          filename: `batch_summary_${job.jobId}`,
          org_id: job.orgId,
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

  // Rows are intentionally retained — pruning completed jobs by TTL/age is a
  // separate cron task, not done here.
}

// ── dc_batch_jobs persistence helpers ─────────────────────────────────────────

/** Insert the initial job row (status='processing'). Throws on failure so the
 *  POST can surface a 500 rather than returning a jobId no GET can ever read. */
async function insertJobRow(job: BatchJob): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('batch job store unavailable (no DB configured)')
  const { error } = await supabase.database
    .from('dc_batch_jobs')
    .insert({
      job_id: job.jobId,
      org_id: job.orgId,
      status: job.status,
      total_documents: job.totalDocuments,
      processed_documents: job.processedDocuments,
      verdicts: job.verdicts,
      results: job.results,
      webhook_url: job.webhookUrl ?? null,
      external_ref: job.documents[0]?.externalRef ?? null,
      created_at: job.createdAt,
      completed_at: job.completedAt,
    })
  if (error) throw new Error(`[batch] insertJobRow: ${error.message}`)
}

/** Patch an existing job row by job_id (progress / terminal state). Non-fatal:
 *  a failed update just means the next poll sees slightly staler progress. */
async function updateJobRow(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase.database
      .from('dc_batch_jobs')
      .update(patch)
      .eq('job_id', jobId)
  } catch { /* non-fatal */ }
}

/** Read a job row, scoped to the caller's org (IDOR guard). Returns null when
 *  the job does not exist OR belongs to a different tenant. */
async function getJobRow(
  jobId: string,
  orgId: string | null,
): Promise<Record<string, unknown> | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  // No org scope -> no tenant context -> fail closed (never cross-tenant read).
  if (!orgId) return null
  const { data, error } = await supabase.database
    .from('dc_batch_jobs')
    .select('*')
    .eq('job_id', jobId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return null
  return data as Record<string, unknown>
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
    orgId: keyRecord.orgId,
    documents: body.documents,
  }

  // Persist the job row (status='processing') BEFORE responding, so the GET
  // poller — which may hit a different serverless invocation — can read it.
  try {
    await insertJobRow(job)
  } catch (err) {
    console.error(`[batch] Failed to create job ${jobId}:`, (err as Error).message)
    return cors(NextResponse.json(
      { success: false, error: 'Failed to create batch job' },
      { status: 500 },
    ))
  }

  // Run processing AFTER the response is sent. next/server `after()` keeps the
  // work alive on Vercel serverless (fire-and-forget would be frozen).
  after(() => processBatch(job).catch(async err => {
    await updateJobRow(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
    })
    console.error(`[batch] Job ${jobId} failed:`, err)
  }))

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

  // Read the job from dc_batch_jobs, scoped to the caller's org. A job owned by
  // another tenant (or a non-existent job) returns null -> 404 (IDOR guard).
  const row = await getJobRow(jobId, keyRecord.orgId)
  if (!row) {
    return cors(NextResponse.json(
      { success: false, error: 'Job not found' },
      { status: 404 },
    ))
  }

  const status = (row.status as BatchJob['status']) ?? 'processing'
  const totalDocuments = (row.total_documents as number) ?? 0
  const processedDocuments = (row.processed_documents as number) ?? 0
  const results = Array.isArray(row.results) ? (row.results as BatchResult[]) : []
  const verdicts = (row.verdicts as BatchJob['verdicts']) ?? { authentic: 0, suspicious: 0, tampered: 0 }

  return cors(NextResponse.json({
    success: true,
    data: {
      jobId: row.job_id as string,
      status,
      createdAt: row.created_at as string,
      completedAt: (row.completed_at as string | null) ?? null,
      totalDocuments,
      processedDocuments,
      progress: totalDocuments > 0
        ? Math.round((processedDocuments / totalDocuments) * 100)
        : 0,
      verdicts,
      // Only include full results when completed
      results: status === 'completed' ? results : undefined,
    },
  }))
}
