/**
 * Deep-Check · Video Forensics API
 * POST /api/video  — accept pre-extracted frames (base64), run forensic analysis
 * GET  /api/video  — list recent video analyses from dc_video_analyses table
 *
 * Why client-side frame extraction?
 *   Next.js API routes run in Node.js which has no Canvas / HTMLVideoElement API.
 *   The page extracts frames with HTMLVideoElement + Canvas, then POSTs the base64
 *   frame images here for server-side scoring and persistence.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@insforge/sdk'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { checkDocLimit, incrementDocUsage } from '@/lib/planLimits'
import {
  analyzeFrameConsistency,
  detectTemporalAnomalies,
  buildVideoReport,
  type VideoFrame,
  type FrameAnalysisResult,
  type VideoAnalysisReport,
} from '@/lib/videoAnalysis'

// ML worker for server-side deepfake detection (V9 DINOv3 / V3 ONNX). Optional:
// if no worker is configured, deepfake scoring is skipped and frames are
// reported as "not_analyzed" rather than fabricating a score from byte size.
const ML_WORKER_URL = process.env.ML_WORKER_URL || process.env.XEON_ML_URL || ''
const ML_WORKER_API_KEY = process.env.ML_WORKER_API_KEY || ''

/**
 * Run real server-side deepfake detection on a single frame via the ML worker
 * (/detect/deepfake). Returns p_fake in [0,1], or null if no worker is
 * configured or the call fails (non-fatal — frame is reported as not analyzed).
 */
async function runDeepfakeDetection(frameBase64: string): Promise<number | null> {
  if (!ML_WORKER_URL) return null
  try {
    const form = new FormData()
    form.append('frameBase64', frameBase64)
    const res = await fetch(`${ML_WORKER_URL}/detect/deepfake`, {
      method: 'POST',
      body: form,
      headers: ML_WORKER_API_KEY ? { 'x-api-key': ML_WORKER_API_KEY } : undefined,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const p = typeof data?.p_fake === 'number' ? data.p_fake : null
    if (p === null || Number.isNaN(p)) return null
    return Math.min(1, Math.max(0, p))
  } catch {
    return null
  }
}

// ─── Supabase client ──────────────────────────────────────────────────────────

function getClient() {
  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.INSFORGE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    isServerMode: true,
  })
}

// ─── POST — analyse video frames ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  try {
    // ── Plan gating ────────────────────────────────────────────────────────────
    const org = await getOrgFromSession(req)
    if (org) {
      const { allowed, used, limit } = await checkDocLimit(org.id)
      if (!allowed) {
        return NextResponse.json(
          { error: 'Límite del plan alcanzado', used, limit, upgradeUrl: '/pricing' },
          { status: 403 },
        )
      }
    }

    // ── Parse request body ─────────────────────────────────────────────────────
    let body: {
      filename: string
      duration: number
      totalFrames: number
      frames: Array<{ frameNumber: number; timestamp: number; imageData: string }>
    }

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { filename, duration, totalFrames, frames } = body

    if (!filename || !Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json(
        { error: 'Se requieren filename y un array frames no vacío' },
        { status: 400 },
      )
    }

    if (frames.length > 300) {
      return NextResponse.json(
        { error: 'Demasiados frames. Máximo 300 por análisis.' },
        { status: 400 },
      )
    }

    // ── Per-frame deepfake analysis ────────────────────────────────────────────
    // Pixel-level deepfake scoring requires a real model. In Node.js we have no
    // Canvas, so we call the ML worker (/detect/deepfake) per frame for a genuine
    // p_fake. If no worker is configured (or a frame fails), that frame is marked
    // "not_analyzed" — we do NOT fabricate a score from base64 size/entropy.
    const framePFakes: Array<number | null> = await Promise.all(
      frames.map(f => runDeepfakeDetection(f.imageData)),
    )
    const analyzed = framePFakes.some(p => p !== null)

    const frameResults: FrameAnalysisResult[] = frames.map((f, i) => {
      const pFake = framePFakes[i]
      if (pFake === null) {
        // No real score available for this frame — report honestly, no invented numbers.
        return {
          frameNumber: f.frameNumber,
          timestamp:   f.timestamp,
          elaScore:    0,
          noiseScore:  0,
          aiScore:     0,
          alerts:      ['not_analyzed'],
          thumbnail:   '',
        }
      }
      const aiScore = Math.round(pFake * 100)
      const alerts: string[] = []
      if (pFake >= 0.7) alerts.push('High deepfake probability (model)')
      else if (pFake >= 0.5) alerts.push('Moderate deepfake probability (model)')
      return {
        frameNumber: f.frameNumber,
        timestamp:   f.timestamp,
        elaScore:    0,
        noiseScore:  0,
        aiScore,
        alerts,
        thumbnail:   '',
      }
    })

    // ── Consistency & temporal analysis ───────────────────────────────────────
    // Splice/consistency detection from frame sizes is a structural heuristic and
    // does not fabricate a deepfake verdict — keep it. Temporal anomaly detection
    // is only meaningful when real per-frame scores exist.
    const videoFrames: VideoFrame[] = frames.map(f => ({
      frameNumber: f.frameNumber,
      timestamp:   f.timestamp,
      imageData:   f.imageData,
      width:       0,
      height:      0,
    }))

    const { splicePoints, consistencyScore } = analyzeFrameConsistency(videoFrames)
    // Deepfake score reflects the real model output, or 0 when nothing was analyzed.
    const { deepfakeScore, anomalyFrames } = analyzed
      ? detectTemporalAnomalies(frameResults)
      : { deepfakeScore: 0, anomalyFrames: [] as number[] }

    const report = buildVideoReport({
      filename:         filename ?? 'video',
      duration:         duration ?? 0,
      totalFrames:      totalFrames ?? frames.length,
      frameResults,
      splicePoints,
      consistencyScore,
      deepfakeScore,
      anomalyFrames,
    })

    // Honest deepfake status: mark whether a real model actually ran. When it
    // did not, the deepfake score is "not analyzed", not a clean verdict.
    const deepfakeStatus: 'analyzed' | 'not_analyzed' = analyzed ? 'analyzed' : 'not_analyzed'
    const summary = analyzed
      ? report.summary
      : `Análisis deepfake no disponible (sin motor ML configurado). ${report.summary}`

    // ── Persist to Supabase (graceful — table may not exist yet) ───────────────
    // Only persist a deepfake verdict when a real model produced it. Without a
    // worker we still record the structural (splice/consistency) findings, but
    // store deepfake_score as null so no fabricated forensic verdict is saved.
    let savedId: string | null = null
    try {
      const sb = getClient()
      const { data, error } = await sb.database
        .from('dc_video_analyses')
        .insert({
          filename:             report.filename,
          duration:             report.duration,
          total_frames:         report.totalFrames,
          frames_analyzed:      report.framesAnalyzed,
          overall_risk_score:   report.overallRiskScore,
          risk_level:           report.riskLevel,
          deepfake_score:       analyzed ? report.deepfakeScore : null,
          splicing_detected:    report.splicingDetected,
          suspicious_segments:  report.suspiciousSegments,
          summary,
          frame_results:        report.frameResults.map(fr => ({
            frameNumber: fr.frameNumber,
            timestamp:   fr.timestamp,
            elaScore:    fr.elaScore,
            noiseScore:  fr.noiseScore,
            aiScore:     fr.aiScore,
            alerts:      fr.alerts,
            // Omit thumbnail from DB to keep row size manageable
          })),
        })
        .select('id, created_at')
        .single()

      if (!error && data) {
        savedId = data.id
        if (org) void incrementDocUsage(org.id)
      }
    } catch (dbErr) {
      // DB persistence is best-effort — return results even if save fails
      console.error('[api/video POST] DB persist error:', dbErr)
    }

    void writeAuditLog({
      eventType:  'document_analyzed',
      endpoint:   '/api/video',
      method:     'POST',
      ip,
      statusCode: 201,
      durationMs: Date.now() - t0,
      details: {
        filename,
        framesAnalyzed:   frameResults.length,
        overallRiskScore: report.overallRiskScore,
        riskLevel:        report.riskLevel,
        splicingDetected: report.splicingDetected,
        deepfakeScore:    analyzed ? report.deepfakeScore : null,
        deepfakeStatus,
        savedId,
      },
    })

    // Response shape stays compatible (all report fields preserved), plus an
    // explicit honesty flag and a real-or-null deepfake score.
    return NextResponse.json(
      {
        ...report,
        summary,
        deepfakeScore: analyzed ? report.deepfakeScore : null,
        deepfakeStatus,
        id: savedId,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('[api/video POST] unexpected:', e)
    void writeAuditLog({
      eventType:  'error',
      endpoint:   '/api/video',
      method:     'POST',
      ip,
      statusCode: 500,
      durationMs: Date.now() - t0,
    })
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// ─── GET — list recent video analyses ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit     = Math.min(50, parseInt(searchParams.get('limit') ?? '20'))
    const riskLevel = searchParams.get('riskLevel')

    const sb = getClient()
    let query = sb.database
      .from('dc_video_analyses')
      .select('id, created_at, filename, duration, overall_risk_score, risk_level, deepfake_score, splicing_detected, frames_analyzed, summary')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (riskLevel) query = query.eq('risk_level', riskLevel)

    const { data, error } = await query

    if (error) {
      // If the table doesn't exist yet, return empty list gracefully
      const isTableMissing = error.message.includes('does not exist') ||
                             error.code === '42P01'
      if (isTableMissing) {
        return NextResponse.json({ items: [], total: 0, tableReady: false })
      }
      console.error('[api/video GET]', error.message)
      return NextResponse.json({ items: [], total: 0 })
    }

    const items = (data ?? []).map(row => ({
      id:               row.id,
      filename:         row.filename,
      duration:         row.duration,
      framesAnalyzed:   row.frames_analyzed,
      overallRiskScore: row.overall_risk_score,
      riskLevel:        row.risk_level,
      deepfakeScore:    row.deepfake_score,
      splicingDetected: row.splicing_detected,
      summary:          row.summary,
      createdAt:        row.created_at,
    }))

    return NextResponse.json({ items, total: items.length, tableReady: true })
  } catch (e) {
    console.error('[api/video GET] unexpected:', e)
    return NextResponse.json({ items: [], total: 0 })
  }
}

// NOTE: A previous version derived a "deepfake" score here from base64 payload
// size and character entropy. That produced fabricated forensic verdicts with no
// relation to the actual frame content, so it was removed. Real per-frame scoring
// now goes through runDeepfakeDetection() against the ML worker; when no worker is
// configured, frames are reported as "not_analyzed" instead of inventing a score.
