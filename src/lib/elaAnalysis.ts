/**
 * elaAnalysis.ts — Error Level Analysis (ELA) for JPEG manipulation detection
 * ============================================================================
 * Re-saves the image as JPEG at a known quality level, then compares the
 * re-compressed version against the original pixel-by-pixel.
 *
 * Why it works:
 *   - Unmodified JPEG regions have been compressed at a consistent quality.
 *     Re-saving at the same quality produces nearly identical pixels (low error).
 *   - Edited/spliced regions were saved at a different quality level, or contain
 *     pixels that weren't JPEG-compressed yet. Re-saving produces noticeably
 *     different pixels (higher error) in those regions.
 *
 * Output:
 *   - Overall ELA score 0–100 (0 = consistent, 100 = severe manipulation)
 *   - Grid-level variance: divides image into NxN blocks, flags blocks where
 *     the ELA residual is significantly different from the mean.
 *   - Suspicious region count: number of blocks with anomalous residuals
 */

import sharp from 'sharp'

export interface ELAResult {
  elaScore:            number    // 0–100 overall manipulation indicator
  meanResidual:        number    // average pixel difference across image
  maxResidual:         number    // peak pixel difference
  stdResidual:         number    // standard deviation of residuals
  suspiciousBlocks:    number    // number of grid blocks with anomalous residuals
  totalBlocks:         number    // total grid blocks analyzed
  blockVarianceRatio:  number    // ratio of block variance (high = inconsistent)
  analysisMs:          number
}

const ELA_QUALITY   = 75   // JPEG re-compression quality for comparison
const GRID_SIZE     = 8    // NxN block grid for regional analysis
const WORK_SIZE     = 512  // resize to this for consistent analysis
const ANOMALY_SIGMA = 2.0  // blocks > mean + ANOMALY_SIGMA * std are suspicious

export async function runELA(imageBase64: string): Promise<ELAResult> {
  const t0 = Date.now()

  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const originalBuf = Buffer.from(b64, 'base64')

    // Step 1: Decode original and resize to working resolution (grayscale)
    const originalRaw = await sharp(originalBuf)
      .resize(WORK_SIZE, WORK_SIZE, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = originalRaw.info.width
    const h = originalRaw.info.height
    const origPixels = new Uint8Array(originalRaw.data)

    // Step 2: Re-compress at known quality
    const recompressedJpeg = await sharp(originalBuf)
      .resize(w, h, { fit: 'fill' })
      .grayscale()
      .jpeg({ quality: ELA_QUALITY })
      .toBuffer()

    // Step 3: Decode re-compressed version back to raw pixels
    const recompRaw = await sharp(recompressedJpeg)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const recompPixels = new Uint8Array(recompRaw.data)

    // Step 4: Compute per-pixel residuals
    const totalPixels = w * h
    const residuals = new Float64Array(totalPixels)
    let sumResidual = 0
    let maxResidual = 0

    for (let i = 0; i < totalPixels; i++) {
      const diff = Math.abs(origPixels[i] - recompPixels[i])
      residuals[i] = diff
      sumResidual += diff
      if (diff > maxResidual) maxResidual = diff
    }

    const meanResidual = sumResidual / totalPixels

    // Standard deviation
    let sumSqDiff = 0
    for (let i = 0; i < totalPixels; i++) {
      sumSqDiff += (residuals[i] - meanResidual) ** 2
    }
    const stdResidual = Math.sqrt(sumSqDiff / totalPixels)

    // Step 5: Grid-based regional analysis
    const blockW = Math.floor(w / GRID_SIZE)
    const blockH = Math.floor(h / GRID_SIZE)
    const blockMeans: number[] = []

    for (let by = 0; by < GRID_SIZE; by++) {
      for (let bx = 0; bx < GRID_SIZE; bx++) {
        let blockSum = 0
        let blockCount = 0
        const startY = by * blockH
        const startX = bx * blockW
        for (let y = startY; y < Math.min(startY + blockH, h); y++) {
          for (let x = startX; x < Math.min(startX + blockW, w); x++) {
            blockSum += residuals[y * w + x]
            blockCount++
          }
        }
        if (blockCount > 0) blockMeans.push(blockSum / blockCount)
      }
    }

    const totalBlocks = blockMeans.length
    const blockMean = blockMeans.reduce((s, v) => s + v, 0) / totalBlocks
    const blockStd  = Math.sqrt(
      blockMeans.reduce((s, v) => s + (v - blockMean) ** 2, 0) / totalBlocks
    )
    const blockCV = blockMean > 0 ? blockStd / blockMean : 0

    // Suspicious blocks: those with residual significantly above average
    const threshold = blockMean + ANOMALY_SIGMA * blockStd
    const suspiciousBlocks = blockMeans.filter(m => m > threshold).length

    // Step 6: Compute overall ELA score
    //   - High mean residual overall → document was re-compressed (moderate signal)
    //   - High block variance (some blocks much higher than others) → selective editing (strong signal)
    //   - Many suspicious blocks → likely manipulated regions

    let elaScore = 0

    // Block variance contribution (most important: inconsistent editing)
    if (blockCV > 0.5) {
      elaScore += Math.min(50, Math.round((blockCV - 0.5) * 50))
    }

    // Suspicious block count contribution
    if (suspiciousBlocks > 0) {
      const suspiciousRatio = suspiciousBlocks / totalBlocks
      elaScore += Math.min(30, Math.round(suspiciousRatio * 100))
    }

    // Overall residual magnitude (high residual = heavily re-compressed, moderate signal)
    if (meanResidual > 15) {
      elaScore += Math.min(20, Math.round((meanResidual - 15) / 2))
    }

    elaScore = Math.min(100, elaScore)

    return {
      elaScore,
      meanResidual: Math.round(meanResidual * 100) / 100,
      maxResidual,
      stdResidual: Math.round(stdResidual * 100) / 100,
      suspiciousBlocks,
      totalBlocks,
      blockVarianceRatio: Math.round(blockCV * 1000) / 1000,
      analysisMs: Date.now() - t0,
    }
  } catch (err) {
    console.error('[elaAnalysis] Error:', err instanceof Error ? err.message : err)
    return {
      elaScore: 0,
      meanResidual: 0,
      maxResidual: 0,
      stdResidual: 0,
      suspiciousBlocks: 0,
      totalBlocks: 0,
      blockVarianceRatio: 0,
      analysisMs: Date.now() - t0,
    }
  }
}
