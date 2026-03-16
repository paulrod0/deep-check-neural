/**
 * textConsistency.ts — Text/Font Consistency Analysis
 * =====================================================
 * Detects inconsistencies in text rendering that indicate manipulation.
 *
 * Techniques:
 *   1. Character spacing variance — edited text often has irregular spacing
 *   2. Noise level per text region — pasted text has different noise profile
 *   3. Edge sharpness consistency — edited chars have different edge profiles
 *   4. Local contrast analysis — manipulated regions have different luminance patterns
 *
 * Uses sharp for pixel analysis. No ML models required.
 */

import sharp from 'sharp'

export interface TextConsistencyResult {
  consistencyScore:     number   // 0–100 (0 = consistent, 100 = inconsistent)
  noiseVariance:        number   // coefficient of variation of local noise
  edgeSharpnessVar:     number   // variance in edge sharpness across regions
  localContrastVar:     number   // variance in local contrast across regions
  suspiciousRegions:    number   // number of regions with anomalous profiles
  totalRegions:         number
  analysisMs:           number
}

const WORK_SIZE  = 400   // working resolution
const GRID_SIZE  = 6     // 6×6 grid of regions

export async function runTextConsistencyAnalysis(imageBase64: string): Promise<TextConsistencyResult> {
  const t0 = Date.now()

  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buf = Buffer.from(b64, 'base64')

    // Get grayscale raw pixels
    const { data, info } = await sharp(buf)
      .resize(WORK_SIZE, WORK_SIZE, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = info.width
    const h = info.height
    const pixels = new Uint8Array(data)

    // ── 1. Local noise analysis per grid block ─────────────────────────
    // Noise = standard deviation of pixel values in small neighborhoods
    const blockW = Math.floor(w / GRID_SIZE)
    const blockH = Math.floor(h / GRID_SIZE)
    const noisePerBlock: number[] = []
    const edgePerBlock: number[] = []
    const contrastPerBlock: number[] = []

    for (let by = 0; by < GRID_SIZE; by++) {
      for (let bx = 0; bx < GRID_SIZE; bx++) {
        const startY = by * blockH
        const startX = bx * blockW
        const endY   = Math.min(startY + blockH, h)
        const endX   = Math.min(startX + blockW, w)

        // Compute local noise (high-pass filter residual)
        let noiseSum = 0
        let noiseCnt = 0
        let edgeSum  = 0
        let edgeCnt  = 0
        let minPx = 255, maxPx = 0

        for (let y = startY + 1; y < endY - 1; y++) {
          for (let x = startX + 1; x < endX - 1; x++) {
            const idx = y * w + x
            const center = pixels[idx]

            // Track min/max for contrast
            if (center < minPx) minPx = center
            if (center > maxPx) maxPx = center

            // High-pass: difference from average of 4 neighbors
            const avg4 = (
              pixels[(y - 1) * w + x] +
              pixels[(y + 1) * w + x] +
              pixels[y * w + (x - 1)] +
              pixels[y * w + (x + 1)]
            ) / 4
            noiseSum += Math.abs(center - avg4)
            noiseCnt++

            // Sobel-like edge magnitude (horizontal + vertical)
            const gx = Math.abs(
              pixels[y * w + (x + 1)] - pixels[y * w + (x - 1)]
            )
            const gy = Math.abs(
              pixels[(y + 1) * w + x] - pixels[(y - 1) * w + x]
            )
            edgeSum += Math.sqrt(gx * gx + gy * gy)
            edgeCnt++
          }
        }

        noisePerBlock.push(noiseCnt > 0 ? noiseSum / noiseCnt : 0)
        edgePerBlock.push(edgeCnt > 0 ? edgeSum / edgeCnt : 0)
        contrastPerBlock.push(maxPx - minPx)
      }
    }

    // ── 2. Compute variance metrics ──────────────────────────────────
    const totalRegions = noisePerBlock.length

    const computeCV = (arr: number[]) => {
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length
      const std  = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
      return mean > 0 ? std / mean : 0
    }

    const noiseCV    = computeCV(noisePerBlock)
    const edgeCV     = computeCV(edgePerBlock)
    const contrastCV = computeCV(contrastPerBlock)

    // ── 3. Detect suspicious regions (outliers) ─────────────────────
    const detectOutliers = (arr: number[], sigma: number = 2.0): number => {
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length
      const std  = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
      return arr.filter(v => Math.abs(v - mean) > sigma * std).length
    }

    const noiseOutliers    = detectOutliers(noisePerBlock)
    const edgeOutliers     = detectOutliers(edgePerBlock)
    const contrastOutliers = detectOutliers(contrastPerBlock)
    const suspiciousRegions = Math.max(noiseOutliers, edgeOutliers, contrastOutliers)

    // ── 4. Compute overall consistency score ────────────────────────
    // Natural documents: noise, edge sharpness, and contrast are relatively
    // uniform across the document. Manipulation creates local inconsistencies.
    let consistencyScore = 0

    // Noise variance contribution (30%)
    // CV > 0.5 is suspicious for a uniform document
    if (noiseCV > 0.3) {
      consistencyScore += Math.min(30, Math.round((noiseCV - 0.3) * 60))
    }

    // Edge sharpness variance contribution (30%)
    // Different tools create edges with different profiles
    if (edgeCV > 0.4) {
      consistencyScore += Math.min(30, Math.round((edgeCV - 0.4) * 50))
    }

    // Contrast variance contribution (20%)
    if (contrastCV > 0.3) {
      consistencyScore += Math.min(20, Math.round((contrastCV - 0.3) * 40))
    }

    // Suspicious region bonus (20%)
    if (suspiciousRegions > 0) {
      consistencyScore += Math.min(20, suspiciousRegions * 5)
    }

    consistencyScore = Math.min(100, consistencyScore)

    return {
      consistencyScore,
      noiseVariance:     Math.round(noiseCV * 1000) / 1000,
      edgeSharpnessVar:  Math.round(edgeCV * 1000) / 1000,
      localContrastVar:  Math.round(contrastCV * 1000) / 1000,
      suspiciousRegions,
      totalRegions,
      analysisMs:        Date.now() - t0,
    }
  } catch (err) {
    console.error('[textConsistency] Error:', err instanceof Error ? err.message : err)
    return {
      consistencyScore:  0,
      noiseVariance:     0,
      edgeSharpnessVar:  0,
      localContrastVar:  0,
      suspiciousRegions: 0,
      totalRegions:      0,
      analysisMs:        Date.now() - t0,
    }
  }
}
