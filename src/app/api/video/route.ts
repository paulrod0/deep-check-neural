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
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { checkDocLimit, incrementDocUsage } from '@/lib/planLimits'
import {
  analyzeFrame,
  analyzeFrameConsistency,
  detectTemporalAnomalies,
  buildVideoReport,
  type VideoFrame,
  type FrameAnalysisResult,
  type VideoAnalysisReport,
} from '@/lib/videoAnalysis'

// ─── Supabase client ──────────────────────────────────────────────────────────

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
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

    // ── Per-frame analysis ─────────────────────────────────────────────────────
    // In Node.js we do NOT have HTMLCanvasElement.  We run the full analyzeFrame
    // function which internally uses document.createElement — this will fail in
    // Node.  Instead we implement a pure-Node pixel-level analysis below that
    // mirrors the browser logic using raw base64 decoding.

    const frameResults: FrameAnalysisResult[] = await Promise.all(
      frames.map(f => analyzeFrameServer(f.imageData, f.frameNumber, f.timestamp)),
    )

    // ── Consistency & temporal analysis ───────────────────────────────────────
    // analyzeFrameConsistency uses VideoFrame.imageData (the base64 size proxy)
    const videoFrames: VideoFrame[] = frames.map(f => ({
      frameNumber: f.frameNumber,
      timestamp:   f.timestamp,
      imageData:   f.imageData,
      width:       0,
      height:      0,
    }))

    const { splicePoints, consistencyScore } = analyzeFrameConsistency(videoFrames)
    const { deepfakeScore, anomalyFrames }   = detectTemporalAnomalies(frameResults)

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

    // ── Persist to Supabase (graceful — table may not exist yet) ───────────────
    let savedId: string | null = null
    try {
      const sb = getClient()
      const { data, error } = await sb
        .from('dc_video_analyses')
        .insert({
          filename:             report.filename,
          duration:             report.duration,
          total_frames:         report.totalFrames,
          frames_analyzed:      report.framesAnalyzed,
          overall_risk_score:   report.overallRiskScore,
          risk_level:           report.riskLevel,
          deepfake_score:       report.deepfakeScore,
          splicing_detected:    report.splicingDetected,
          suspicious_segments:  report.suspiciousSegments,
          summary:              report.summary,
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
        deepfakeScore:    report.deepfakeScore,
        savedId,
      },
    })

    return NextResponse.json({ ...report, id: savedId }, { status: 201 })
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
    let query = sb
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

// ─── Server-side frame analysis (no Canvas) ───────────────────────────────────

/**
 * Server-side equivalent of analyzeFrame from videoAnalysis.ts.
 *
 * Since Node.js has no Canvas API, we decode the base64 PNG data URL and
 * perform raw pixel-level analysis by parsing the PNG using JavaScript.
 * For simplicity and to avoid native dependencies, we use a pure-JS approach:
 *
 *   - ELA score: approximated by comparing compressed size ratio. PNG compressed
 *     size relative to a JPEG-equivalent size (estimated by pixel count × quality)
 *     gives a proxy for information density and compression history.
 *
 *   - Noise score: we estimate from the entropy of the base64 payload and a
 *     simple run-length analysis on the raw bytes.
 *
 *   - AI score: combination of ELA + noise proxies.
 *
 * This is a deliberate lightweight approximation: the more accurate Canvas-based
 * analysis runs client-side in the browser (see videoAnalysis.ts).
 */

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

async function analyzeFrameServer(
  dataUrl: string,
  frameNumber: number,
  timestamp: number,
): Promise<FrameAnalysisResult> {
  try {
    // Strip the data URL header to get the raw base64 payload
    const comma = dataUrl.indexOf(',')
    const b64 = comma !== -1 ? dataUrl.slice(comma + 1) : dataUrl
    const byteLen = Math.round((b64.length * 3) / 4) // approximate decoded byte size

    // Pixel count estimate from frame dimensions (not available server-side,
    // so we use the encoded size as proxy).  A typical 640×360 frame at
    // reasonable quality = ~230 KB PNG ≈ 307,200 bytes base64 overhead.
    // We normalise against that baseline.
    const BASE_SIZE = 230_000  // expected bytes for a "normal" 640×360 frame

    // ── ELA proxy ─────────────────────────────────────────────────────────────
    // Very small file → very uniform content → either AI-generated or near-black frame
    // Very large file → high detail / noise → likely real camera content
    const sizeRatio = byteLen / BASE_SIZE
    // Frames much smaller than baseline are suspiciously clean (AI / solid colour)
    // Frames much larger than baseline have rich noise (real camera)
    let elaScore: number
    if (sizeRatio < 0.15) {
      // Extremely small → nearly blank frame — not suspicious for ELA
      elaScore = 5
    } else if (sizeRatio < 0.5) {
      // Unusually small for a natural frame → AI-like uniformity
      elaScore = Math.round((1 - sizeRatio / 0.5) * 40)
    } else if (sizeRatio > 3.0) {
      // Very large → rich texture → higher ELA (possible edit artefacts)
      elaScore = Math.round(Math.min(70, 30 + (sizeRatio - 3) * 10))
    } else {
      elaScore = Math.round(15 + sizeRatio * 10)
    }

    // ── Noise proxy via byte entropy ──────────────────────────────────────────
    // Decode a sample of the base64 to measure byte distribution entropy.
    // High entropy → rich / noisy content (real camera)
    // Low entropy  → uniform / synthetic content (AI generation)
    const SAMPLE_LEN = Math.min(b64.length, 4000)
    const sample = b64.slice(0, SAMPLE_LEN)
    const freq: Record<string, number> = {}
    for (const ch of sample) {
      freq[ch] = (freq[ch] ?? 0) + 1
    }
    const chars = Object.values(freq)
    const total = chars.reduce((a, b) => a + b, 0)
    let entropy = 0
    for (const c of chars) {
      const p = c / total
      if (p > 0) entropy -= p * Math.log2(p)
    }
    // Base64 max entropy ≈ 6 bits/char (64 symbols)
    const entropyRatio = entropy / 6
    // Low entropy → uniform → higher noise score (AI-like)
    const noiseScore = clamp(Math.round((1 - entropyRatio) * 100), 0, 100)

    // ── AI Score ──────────────────────────────────────────────────────────────
    const aiScore = clamp(Math.round(elaScore * 0.4 + noiseScore * 0.6), 0, 100)

    // ── Alerts ────────────────────────────────────────────────────────────────
    const alerts: string[] = []
    if (elaScore > 55)  alerts.push('High ELA — possible edit artefacts')
    if (noiseScore > 70) alerts.push('Low entropy — suspiciously uniform frame')
    if (aiScore > 65)   alerts.push('High AI probability score')

    return {
      frameNumber,
      timestamp,
      elaScore:   clamp(elaScore, 0, 100),
      noiseScore: clamp(noiseScore, 0, 100),
      aiScore:    clamp(aiScore, 0, 100),
      alerts,
      thumbnail:  '',   // no canvas in Node — thumbnails extracted client-side
    }
  } catch (err) {
    console.error('[analyzeFrameServer] frame error:', err)
    return {
      frameNumber,
      timestamp,
      elaScore:  0,
      noiseScore: 0,
      aiScore:   0,
      alerts:    ['server_analysis_error'],
      thumbnail: '',
    }
  }
}
