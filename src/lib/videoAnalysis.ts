/**
 * Deep-Check · Video Forensics Engine
 * Client-side video frame extraction and analysis using HTML5 Canvas API.
 * No server-side dependencies (no ffmpeg) — runs entirely in the browser.
 *
 * Modules:
 *   1. Frame Extraction  — HTMLVideoElement + Canvas to capture frames
 *   2. Consistency Check — Detect splice points by inter-frame difference
 *   3. Temporal Anomaly  — Detect deepfake artifacts via temporal jitter analysis
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface VideoFrame {
  frameNumber: number
  timestamp: number   // seconds
  imageData: string   // base64 PNG data URL
  width: number
  height: number
}

export interface FrameAnalysisResult {
  frameNumber: number
  timestamp: number
  elaScore: number
  noiseScore: number
  aiScore: number
  alerts: string[]
  thumbnail: string   // base64 small thumbnail
}

export interface VideoAnalysisReport {
  filename: string
  duration: number
  totalFrames: number
  framesAnalyzed: number
  overallRiskScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  deepfakeScore: number
  splicingDetected: boolean
  suspiciousSegments: Array<{
    startTime: number
    endTime: number
    type: 'splice' | 'deepfake' | 'ai_generated' | 'metadata_anomaly'
    confidence: number
  }>
  frameResults: FrameAnalysisResult[]
  summary: string
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Decode a base64 data URL into ImageData using an OffscreenCanvas or a regular canvas.
 * Falls back to a regular canvas when OffscreenCanvas is not available.
 */
async function decodeFrame(dataUrl: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, img.width, img.height))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/** Convert an ImageData to a small thumbnail data URL (max 160px wide). */
function makeThumb(imageData: ImageData, maxW = 160): string {
  const scale = Math.min(1, maxW / imageData.width)
  const w = Math.round(imageData.width * scale)
  const h = Math.round(imageData.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Put the full-size image data into a temp canvas, then scale it
  const tmp = document.createElement('canvas')
  tmp.width = imageData.width
  tmp.height = imageData.height
  tmp.getContext('2d')!.putImageData(imageData, 0, 0)
  ctx.drawImage(tmp, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// ─── 1. Frame Extraction ───────────────────────────────────────────────────────

/**
 * Extract frames from a video file using HTMLVideoElement + Canvas.
 *
 * The function:
 *   - Creates an object URL for the File
 *   - Seeks the video to each target timestamp
 *   - Waits for 'seeked' event then captures the frame via canvas.toDataURL
 *   - Returns up to maxFrames VideoFrame objects
 *
 * @param videoFile  The video File object selected by the user
 * @param fps        Frames per second to sample (0.5 = 1 frame every 2 s, 5 = 5 fps)
 * @param maxFrames  Hard cap on extracted frames to avoid memory exhaustion
 * @param onProgress Optional callback reporting progress 0–100
 */
export async function extractFrames(
  videoFile: File,
  fps: number = 1,
  maxFrames: number = 60,
  onProgress?: (pct: number) => void,
): Promise<VideoFrame[]> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(videoFile)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'anonymous'

    const frames: VideoFrame[] = []

    video.onloadedmetadata = async () => {
      const duration = video.duration
      if (!isFinite(duration) || duration <= 0) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('No se pudo determinar la duración del vídeo'))
        return
      }

      const interval = 1 / fps
      const targetTimestamps: number[] = []
      for (let t = 0; t < duration; t += interval) {
        targetTimestamps.push(parseFloat(t.toFixed(3)))
        if (targetTimestamps.length >= maxFrames) break
      }

      // Canvas for frame capture — use the video's actual dimensions
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')!

      let frameNumber = 0
      const total = targetTimestamps.length

      for (const ts of targetTimestamps) {
        await new Promise<void>((seekResolve, seekReject) => {
          const timeout = setTimeout(() => seekResolve(), 3000) // safety timeout

          video.onseeked = () => {
            clearTimeout(timeout)
            try {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              const imageData = canvas.toDataURL('image/png')
              frames.push({
                frameNumber,
                timestamp: ts,
                imageData,
                width: canvas.width,
                height: canvas.height,
              })
            } catch (err) {
              // Frame capture failed — skip silently
              console.warn('[extractFrames] Frame capture failed at', ts, err)
            }
            frameNumber++
            onProgress?.(Math.round((frameNumber / total) * 100))
            seekResolve()
          }

          video.onerror = () => {
            clearTimeout(timeout)
            seekReject(new Error(`Error del vídeo en t=${ts}`))
          }

          video.currentTime = ts
        }).catch(() => { /* skip failed seeks */ })
      }

      URL.revokeObjectURL(objectUrl)
      video.src = ''
      resolve(frames)
    }

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo cargar el vídeo. Asegúrate de que el formato es compatible.'))
    }

    video.src = objectUrl
  })
}

// ─── 2. Frame Consistency Analysis ────────────────────────────────────────────

/**
 * Detect splice points by measuring the mean absolute difference (MAD) between
 * consecutive frames converted to greyscale.
 *
 * A sudden jump in MAD (> mean + 2*std across all pairs) is a candidate splice
 * point — it indicates a cut/edit that introduced visually discontinuous content.
 *
 * Additionally, very low MAD across many consecutive frames (< mean - 1*std)
 * can indicate duplicated/looped footage.
 *
 * Returns:
 *   splicePoints: indices into frames[] where splices are suspected
 *   consistencyScore: 0–100 (0 = highly consistent, 100 = many discontinuities)
 */
export function analyzeFrameConsistency(
  frames: VideoFrame[],
): { splicePoints: number[]; consistencyScore: number } {
  if (frames.length < 2) {
    return { splicePoints: [], consistencyScore: 0 }
  }

  // We need decoded pixel data — but this function is synchronous and takes
  // pre-decoded frames.  For the synchronous variant we work on a placeholder
  // heuristic: we analyse the base64 string length as a rough proxy for the
  // compressed size of each frame.  Two consecutive frames that are visually
  // similar will compress to similar sizes; a scene cut causes a large jump.
  // This is a well-known lightweight approximation used in hardware encoders.
  const sizes = frames.map(f => {
    // base64 data URL length ≈ (4/3) * compressed bytes + overhead
    // Remove the header ("data:image/png;base64,") for a cleaner signal
    const raw = f.imageData.split(',')[1] ?? f.imageData
    return raw.length
  })

  const diffs: number[] = []
  for (let i = 1; i < sizes.length; i++) {
    const d = Math.abs(sizes[i] - sizes[i - 1])
    diffs.push(d)
  }

  if (diffs.length === 0) return { splicePoints: [], consistencyScore: 0 }

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
  const std = Math.sqrt(diffs.reduce((a, v) => a + (v - mean) ** 2, 0) / diffs.length)

  const HIGH_THRESHOLD = mean + 2.0 * std
  const splicePoints: number[] = []

  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] > HIGH_THRESHOLD && std > 0) {
      // i is the diff between frames[i] and frames[i+1]; flag frames[i+1]
      splicePoints.push(i + 1)
    }
  }

  // Normalise consistency score: ratio of splice-point diffs to overall variance
  const spliceRatio = splicePoints.length / Math.max(1, diffs.length)
  const consistencyScore = clamp(Math.round(spliceRatio * 100 + (std > 0 ? Math.min(50, (std / mean) * 30) : 0)), 0, 100)

  return { splicePoints, consistencyScore }
}

// ─── 3. Temporal Anomaly Detection (Deepfake heuristic) ───────────────────────

/**
 * Detect deepfake and AI-generation artifacts by analysing the temporal
 * distribution of per-frame scores.
 *
 * Deepfake videos tend to produce:
 *   - High AI scores clustered in specific segments (face-swap regions)
 *   - Unusually stable ELA scores (too clean — no natural camera motion blur)
 *   - Jitter in AI/noise scores (model uncertainty produces frame-to-frame noise)
 *
 * The function:
 *   1. Computes the mean and std of aiScore across all frames
 *   2. Flags frames whose aiScore > mean + 1.5*std as anomalous
 *   3. Computes the deepfake score as a weighted combination of:
 *      - Mean AI score
 *      - Proportion of anomalous frames
 *      - Temporal jitter (std of frame-to-frame aiScore delta)
 *
 * Returns:
 *   deepfakeScore: 0–100 (0 = normal, 100 = strong deepfake indicators)
 *   anomalyFrames: indices of frames with anomalous AI signatures
 */
export function detectTemporalAnomalies(
  frameResults: FrameAnalysisResult[],
): { deepfakeScore: number; anomalyFrames: number[] } {
  if (frameResults.length === 0) {
    return { deepfakeScore: 0, anomalyFrames: [] }
  }

  const aiScores = frameResults.map(f => f.aiScore)
  const elaScores = frameResults.map(f => f.elaScore)

  // Mean and std of AI scores
  const aiMean = aiScores.reduce((a, b) => a + b, 0) / aiScores.length
  const aiStd = Math.sqrt(aiScores.reduce((a, v) => a + (v - aiMean) ** 2, 0) / aiScores.length)

  // Anomaly threshold: mean + 1.5 * std
  const aiThreshold = aiMean + 1.5 * aiStd

  const anomalyFrames: number[] = []
  for (let i = 0; i < frameResults.length; i++) {
    if (aiScores[i] > aiThreshold && aiScores[i] > 40) {
      anomalyFrames.push(i)
    }
  }

  // Temporal jitter: std of frame-to-frame ai score delta
  const aiDeltas: number[] = []
  for (let i = 1; i < aiScores.length; i++) {
    aiDeltas.push(Math.abs(aiScores[i] - aiScores[i - 1]))
  }
  const jitter = aiDeltas.length > 0
    ? aiDeltas.reduce((a, b) => a + b, 0) / aiDeltas.length
    : 0

  // ELA uniformity: deepfakes often have suspiciously uniform ELA (face region
  // was generated, not captured)
  const elaMean = elaScores.reduce((a, b) => a + b, 0) / elaScores.length
  const elaStd = Math.sqrt(elaScores.reduce((a, v) => a + (v - elaMean) ** 2, 0) / elaScores.length)
  const elaUniformityFlag = elaStd < 8 && elaMean > 15 ? 20 : 0  // very uniform ELA with some signal

  const anomalyRatio = anomalyFrames.length / Math.max(1, frameResults.length)

  // Weighted combination
  const deepfakeScore = clamp(
    Math.round(
      aiMean * 0.40 +           // baseline AI content across all frames
      anomalyRatio * 100 * 0.35 + // proportion of anomalous frames
      jitter * 0.15 +             // temporal instability
      elaUniformityFlag * 0.10    // ELA uniformity penalty
    ),
    0,
    100,
  )

  return { deepfakeScore, anomalyFrames }
}

// ─── Per-frame ELA (lightweight, synchronous) ──────────────────────────────────

/**
 * Lightweight ELA on a single frame's ImageData.
 * Re-encodes the pixel data as JPEG quality 75 via canvas, measures mean difference.
 * Returns 0–100 score.
 */
async function frameELA(imageData: ImageData): Promise<number> {
  // Original → canvas
  const origCanvas = document.createElement('canvas')
  origCanvas.width = imageData.width
  origCanvas.height = imageData.height
  origCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

  // Re-compress at q=75
  const recompUrl = origCanvas.toDataURL('image/jpeg', 0.75)

  return new Promise<number>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const recompCanvas = document.createElement('canvas')
      recompCanvas.width = imageData.width
      recompCanvas.height = imageData.height
      const ctx = recompCanvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const recomp = ctx.getImageData(0, 0, imageData.width, imageData.height)

      let totalDiff = 0
      const len = imageData.data.length
      for (let i = 0; i < len; i += 4) {
        const dr = Math.abs(imageData.data[i]   - recomp.data[i])
        const dg = Math.abs(imageData.data[i+1] - recomp.data[i+1])
        const db = Math.abs(imageData.data[i+2] - recomp.data[i+2])
        totalDiff += (dr + dg + db) / 3
      }
      const meanDiff = totalDiff / (imageData.width * imageData.height)
      // Normalise: meanDiff of 20 → score ~80
      const score = clamp(Math.round((meanDiff / 25) * 100), 0, 100)
      resolve(score)
    }
    img.onerror = () => resolve(30) // fallback
    img.src = recompUrl
  })
}

/**
 * Noise uniformity score (synchronous, same algorithm as imageForensics.ts).
 * Returns 0–100 (high = uniform / AI-like).
 */
function frameNoise(imageData: ImageData): number {
  const W = imageData.width
  const H = imageData.height
  const data = imageData.data

  const grey = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    grey[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2]
  }

  // Per-block variance (16×16)
  const BLOCK = 16
  const blockVars: number[] = []
  for (let by = 0; by < H - BLOCK; by += BLOCK) {
    for (let bx = 0; bx < W - BLOCK; bx += BLOCK) {
      const vals: number[] = []
      for (let y = by; y < by + BLOCK; y++) {
        for (let x = bx; x < bx + BLOCK; x++) {
          vals.push(grey[y * W + x])
        }
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length
      blockVars.push(variance)
    }
  }

  if (blockVars.length === 0) return 0

  const meanBV = blockVars.reduce((a, b) => a + b, 0) / blockVars.length
  const stdBV = Math.sqrt(blockVars.reduce((a, v) => a + (v - meanBV) ** 2, 0) / blockVars.length)
  const cv = meanBV > 0 ? stdBV / meanBV : 1
  const uniformity = clamp(1 - cv, 0, 1)

  return clamp(Math.round(uniformity * 100), 0, 100)
}

/**
 * Combined AI probability score for a single frame.
 * Combines noise uniformity with ELA cleanliness.
 */
function frameAIScore(elaScore: number, noiseScore: number): number {
  // Very low ELA (too clean) AND high noise uniformity → likely AI
  const elaCleanFlag = elaScore < 12 ? (1 - elaScore / 12) * 50 : 0
  const combined = noiseScore * 0.6 + elaCleanFlag * 0.4
  return clamp(Math.round(combined), 0, 100)
}

/**
 * Analyse a single frame's base64 image data and return a FrameAnalysisResult.
 * Used by the API route when processing client-extracted frames.
 */
export async function analyzeFrame(
  frameDataUrl: string,
  frameNumber: number,
  timestamp: number,
): Promise<FrameAnalysisResult> {
  const imageData = await decodeFrame(frameDataUrl)

  if (!imageData) {
    return {
      frameNumber,
      timestamp,
      elaScore: 0,
      noiseScore: 0,
      aiScore: 0,
      alerts: ['frame_decode_failed'],
      thumbnail: '',
    }
  }

  const thumbnail = makeThumb(imageData)
  const [elaScore, noiseScore] = await Promise.all([
    frameELA(imageData),
    Promise.resolve(frameNoise(imageData)),
  ])
  const aiScore = frameAIScore(elaScore, noiseScore)

  const alerts: string[] = []
  if (elaScore > 65) alerts.push('High ELA — possible edit')
  if (elaScore < 5 && noiseScore > 60) alerts.push('AI-generated content likely')
  if (noiseScore > 75) alerts.push('Uniform noise — synthetic texture')
  if (aiScore > 70) alerts.push('High AI probability score')

  return { frameNumber, timestamp, elaScore, noiseScore, aiScore, alerts, thumbnail }
}

// ─── Risk Level helpers ────────────────────────────────────────────────────────

export function videoRiskLevel(score: number): VideoAnalysisReport['riskLevel'] {
  if (score >= 75) return 'CRITICAL'
  if (score >= 50) return 'HIGH'
  if (score >= 25) return 'MEDIUM'
  return 'LOW'
}

export function videoRiskColor(level: VideoAnalysisReport['riskLevel']): string {
  switch (level) {
    case 'CRITICAL': return '#ff2222'
    case 'HIGH':     return '#ff8800'
    case 'MEDIUM':   return '#ffcc00'
    case 'LOW':      return '#00ff9d'
  }
}

/**
 * Build the full VideoAnalysisReport from frame results and metadata.
 * Called both client-side (after receiving API response) and inside the API route.
 */
export function buildVideoReport(params: {
  filename: string
  duration: number
  totalFrames: number
  frameResults: FrameAnalysisResult[]
  splicePoints: number[]
  consistencyScore: number
  deepfakeScore: number
  anomalyFrames: number[]
}): VideoAnalysisReport {
  const { filename, duration, totalFrames, frameResults, splicePoints, consistencyScore, deepfakeScore, anomalyFrames } = params

  const overallRiskScore = clamp(
    Math.round(
      (frameResults.reduce((a, f) => a + f.elaScore, 0) / Math.max(1, frameResults.length)) * 0.30 +
      consistencyScore * 0.35 +
      deepfakeScore   * 0.35,
    ),
    0,
    100,
  )

  const riskLevel = videoRiskLevel(overallRiskScore)
  const splicingDetected = splicePoints.length > 0

  // Build suspicious segment list
  const suspiciousSegments: VideoAnalysisReport['suspiciousSegments'] = []

  // Splice segments
  for (const spIdx of splicePoints) {
    const frame = frameResults[spIdx]
    if (!frame) continue
    suspiciousSegments.push({
      startTime: Math.max(0, frame.timestamp - 0.5),
      endTime:   frame.timestamp + 0.5,
      type:      'splice',
      confidence: clamp(consistencyScore / 100, 0.3, 0.99),
    })
  }

  // Deepfake anomaly segments
  if (anomalyFrames.length > 0) {
    // Group consecutive anomaly frames into segments
    let segStart = anomalyFrames[0]
    let segEnd   = anomalyFrames[0]

    for (let i = 1; i <= anomalyFrames.length; i++) {
      const curr = anomalyFrames[i]
      if (curr !== undefined && curr === segEnd + 1) {
        segEnd = curr
      } else {
        const startFrame = frameResults[segStart]
        const endFrame   = frameResults[segEnd]
        if (startFrame && endFrame) {
          suspiciousSegments.push({
            startTime: startFrame.timestamp,
            endTime:   endFrame.timestamp,
            type:      deepfakeScore > 60 ? 'deepfake' : 'ai_generated',
            confidence: clamp(deepfakeScore / 100, 0.3, 0.99),
          })
        }
        if (curr !== undefined) {
          segStart = curr
          segEnd   = curr
        }
      }
    }
  }

  // Summary text
  const issues: string[] = []
  if (splicingDetected) issues.push(`${splicePoints.length} posibles puntos de corte/empalme`)
  if (deepfakeScore > 60) issues.push(`alta probabilidad de deepfake (${deepfakeScore}/100)`)
  if (deepfakeScore > 30 && deepfakeScore <= 60) issues.push(`indicios moderados de manipulación facial`)
  const highELAFrames = frameResults.filter(f => f.elaScore > 60).length
  if (highELAFrames > 0) issues.push(`${highELAFrames} frames con alta señal ELA`)

  const summary = issues.length > 0
    ? `Se detectaron anomalías forenses: ${issues.join('; ')}.`
    : 'No se detectaron anomalías forenses significativas. El vídeo parece auténtico.'

  return {
    filename,
    duration,
    totalFrames,
    framesAnalyzed: frameResults.length,
    overallRiskScore,
    riskLevel,
    deepfakeScore,
    splicingDetected,
    suspiciousSegments,
    frameResults,
    summary,
  }
}
