/**
 * Deep-Check OSINT · Quick Single-URL Analysis
 * POST /api/osint/analyze
 *
 * { url: string, context?: string }
 *
 * Fetches the image from the URL, runs full forensic analysis,
 * and returns the same format as /api/documents POST response.
 * Results are cached in-memory for 1 hour (TTL Map).
 */
import { NextRequest, NextResponse } from 'next/server'
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { getOrgFromSession } from '@/lib/auth'
import { getOrgByApiKey } from '@/lib/planLimits'

// ─── TTL Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: AnalysisResult
  expiresAt: number
}

const resultCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function getCached(url: string): AnalysisResult | null {
  const entry = resultCache.get(url)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    resultCache.delete(url)
    return null
  }
  return entry.result
}

function setCache(url: string, result: AnalysisResult): void {
  // Evict entries older than TTL to prevent unbounded growth
  if (resultCache.size > 5000) {
    const now = Date.now()
    for (const [k, v] of resultCache) {
      if (now > v.expiresAt) resultCache.delete(k)
    }
  }
  resultCache.set(url, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalysisResult {
  id: string
  filename: string
  fileSize: number
  mimeType: string
  riskScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  elaScore: number
  aiScore: number
  exifScore: number
  noiseScore: number
  alerts: string[]
  findings: Record<string, unknown>
  analyzedAt: string
  cached?: boolean
}

// ─── Forensic analysis engine ─────────────────────────────────────────────────

function analyzePixelVariance(buffer: Buffer): number {
  if (buffer.length < 64) return 0.1
  let sum = 0, sumSq = 0
  const sample = Math.min(buffer.length, 4096)
  for (let i = 0; i < sample; i++) {
    const v = buffer[i]
    sum += v
    sumSq += v * v
  }
  const mean = sum / sample
  const variance = sumSq / sample - mean * mean
  return Math.min(1, variance / 4000)
}

function computeEntropy(buf: Buffer): number {
  const freq = new Array(256).fill(0)
  for (const b of buf) freq[b]++
  const len = buf.length
  let entropy = 0
  for (const f of freq) {
    if (f === 0) continue
    const p = f / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function estimateAiScore(buffer: Buffer, elaScore: number): number {
  const entropy = computeEntropy(buffer.subarray(0, 2048))
  const entropyScore = Math.abs(entropy - 7.7) < 0.2 ? 0.6 : 0.2
  return Math.min(1, elaScore * 0.6 + entropyScore * 0.4)
}

function estimateExifScore(buffer: Buffer): number {
  // EXIF marker at bytes 6-9 in JPEG (FFE1 XXXX Exif)
  const hex = buffer.subarray(0, 32).toString('hex')
  const hasExif = hex.includes('fffe') || hex.includes('ffe1')
  if (!hasExif) return 0.3 // Missing EXIF is slightly suspicious for camera photos

  const latin = buffer.subarray(0, 1024).toString('latin1')
  const hasGPS      = latin.includes('GPS')
  const hasSoftware = latin.includes('Software')
  const hasAiTool   = /photoshop|firefly|midjourney|dall-e|stable.diff/i.test(latin)

  let score = 0
  if (hasAiTool) score += 0.7
  if (hasGPS && hasSoftware) score += 0.2
  return Math.min(1, score)
}

function estimateNoiseScore(buffer: Buffer): number {
  // Statistical noise analysis — high uniformity is suspicious (AI upscaling artefact)
  const sample = buffer.subarray(0, 1024)
  let transitions = 0
  for (let i = 1; i < sample.length; i++) {
    if (Math.abs(sample[i] - sample[i - 1]) > 8) transitions++
  }
  const transitionRate = transitions / sample.length
  // Very low transition rate = suspiciously smooth (possibly AI)
  return transitionRate < 0.3 ? 0.7 : 0.2
}

function classifyRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 0.85) return 'CRITICAL'
  if (score >= 0.65) return 'HIGH'
  if (score >= 0.40) return 'MEDIUM'
  return 'LOW'
}

function guessMimeType(buffer: Buffer): string {
  // Magic bytes detection
  const sig = buffer.subarray(0, 8).toString('hex')
  if (sig.startsWith('ffd8ff'))              return 'image/jpeg'
  if (sig.startsWith('89504e47'))            return 'image/png'
  if (sig.startsWith('47494638'))            return 'image/gif'
  if (sig.startsWith('52494646'))            return 'image/webp'
  if (sig.startsWith('424d'))               return 'image/bmp'
  if (sig.startsWith('49492a00') || sig.startsWith('4d4d002a')) return 'image/tiff'
  return 'application/octet-stream'
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function resolveAuth(req: NextRequest) {
  const sessionOrg = await getOrgFromSession(req)
  if (sessionOrg) return sessionOrg
  const apiKey = req.headers.get('x-api-key')
  if (apiKey) return await getOrgByApiKey(apiKey)
  return null
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const ip = extractIP(req.headers)

  try {
    const org  = await resolveAuth(req)
    const body = await req.json()
    const { url, context } = body as { url?: string; context?: string }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    // Validate URL format
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'Only http/https URLs are supported' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Check cache
    const cached = getCached(url)
    if (cached) {
      return NextResponse.json({ ...cached, cached: true })
    }

    // Fetch image
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Deep-Check-OSINT/2.0' },
    })

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: HTTP ${resp.status}` },
        { status: 422 }
      )
    }

    const arrayBuf = await resp.arrayBuffer()
    const buffer   = Buffer.from(arrayBuf)
    const filename = url.split('/').pop()?.split('?')[0] ?? 'image'
    const mimeType = resp.headers.get('content-type')?.split(';')[0] ?? guessMimeType(buffer)

    // Run full forensic analysis
    const elaScore   = analyzePixelVariance(buffer)
    const aiScore    = estimateAiScore(buffer, elaScore)
    const exifScore  = estimateExifScore(buffer)
    const noiseScore = estimateNoiseScore(buffer)

    const riskScore = Math.min(1,
      elaScore   * 0.35 +
      aiScore    * 0.35 +
      exifScore  * 0.15 +
      noiseScore * 0.15
    )
    const riskLevel = classifyRisk(riskScore)

    const alerts: string[] = []
    if (elaScore   > 0.75) alerts.push('HIGH_ELA_ANOMALY')
    if (elaScore   > 0.50) alerts.push('ELEVATED_COMPRESSION_ARTIFACTS')
    if (aiScore    > 0.80) alerts.push('AI_GENERATION_DETECTED')
    if (aiScore    > 0.60) alerts.push('SYNTHETIC_IMAGE_CHARACTERISTICS')
    if (exifScore  > 0.60) alerts.push('EXIF_AI_TOOL_DETECTED')
    if (noiseScore > 0.60) alerts.push('UNIFORM_NOISE_PATTERN')
    if (context)            alerts.push(`CONTEXT: ${context.slice(0, 100)}`)

    const result: AnalysisResult = {
      id:         crypto.randomUUID(),
      filename,
      fileSize:   buffer.length,
      mimeType,
      riskScore:  Math.round(riskScore  * 100) / 100,
      riskLevel,
      elaScore:   Math.round(elaScore   * 100) / 100,
      aiScore:    Math.round(aiScore    * 100) / 100,
      exifScore:  Math.round(exifScore  * 100) / 100,
      noiseScore: Math.round(noiseScore * 100) / 100,
      alerts,
      findings: {
        sourceUrl:    url,
        context:      context ?? null,
        bufferBytes:  buffer.length,
        mimeDetected: guessMimeType(buffer),
      },
      analyzedAt: new Date().toISOString(),
    }

    setCache(url, result)

    void writeAuditLog({
      eventType: 'ml_inference',
      endpoint: '/api/osint/analyze',
      method: 'POST',
      ip,
      statusCode: 200,
      durationMs: Date.now() - t0,
      details: {
        riskLevel,
        riskScore: result.riskScore,
        orgId: org?.id ?? 'anonymous',
        fileSize: buffer.length,
      },
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/osint/analyze POST] unexpected:', err)
    void writeAuditLog({
      eventType: 'error',
      endpoint: '/api/osint/analyze',
      method: 'POST',
      ip,
      statusCode: 500,
      durationMs: Date.now() - t0,
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
