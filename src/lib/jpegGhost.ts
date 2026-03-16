/**
 * jpegGhost.ts — JPEG Ghost Analysis for manipulation detection
 * ==============================================================
 * More powerful than basic ELA. Re-compresses the image at EVERY quality
 * level (50–98 in steps of 4) and for each grid block, finds the quality
 * level where the error is minimized ("ghost quality").
 *
 * Why it works:
 *   - When a JPEG is saved at quality Q, re-saving at Q produces near-zero
 *     error. Re-saving at any other quality produces higher error.
 *   - If an image was saved at Q=90 but a region was pasted from a Q=75
 *     source, that region's "ghost quality" is 75 while the rest is 90.
 *   - High variance in ghost quality across blocks = editing detected.
 *
 * Output:
 *   - ghostScore: 0–100 (0 = uniform, 100 = clear multi-source editing)
 *   - ghostQualityMap: per-block "best match" quality level
 *   - ghostVariance: variance of ghost qualities across blocks
 */

import sharp from 'sharp'

export interface JPEGGhostResult {
  ghostScore:       number    // 0–100 manipulation indicator
  ghostVariance:    number    // variance of ghost quality across blocks
  dominantQuality:  number    // most common ghost quality level
  outlierBlocks:    number    // blocks with different ghost quality
  totalBlocks:      number
  qualityRange:     number    // max - min ghost quality across blocks
  analysisMs:       number
}

const GRID_SIZE      = 8    // 8×8 grid of blocks
const WORK_SIZE      = 384  // resize for performance
const QUALITY_START  = 50
const QUALITY_END    = 98
const QUALITY_STEP   = 4    // test qualities: 50, 54, 58, ..., 98 (13 levels)

export async function runJPEGGhost(imageBase64: string): Promise<JPEGGhostResult> {
  const t0 = Date.now()

  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const originalBuf = Buffer.from(b64, 'base64')

    // Decode original to working resolution (grayscale)
    const originalRaw = await sharp(originalBuf)
      .resize(WORK_SIZE, WORK_SIZE, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const w = originalRaw.info.width
    const h = originalRaw.info.height
    const origPixels = new Uint8Array(originalRaw.data)
    const totalPixels = w * h

    // Pre-compute block boundaries
    const blockW = Math.floor(w / GRID_SIZE)
    const blockH = Math.floor(h / GRID_SIZE)

    // For each quality level, compute per-block mean squared error
    const qualities: number[] = []
    for (let q = QUALITY_START; q <= QUALITY_END; q += QUALITY_STEP) {
      qualities.push(q)
    }

    // blockErrors[blockIdx][qualityIdx] = mean error for that block at that quality
    const numBlocks = GRID_SIZE * GRID_SIZE
    const blockErrors: Float64Array[] = Array.from(
      { length: numBlocks },
      () => new Float64Array(qualities.length),
    )

    // Re-compress at each quality and compute per-block errors
    for (let qi = 0; qi < qualities.length; qi++) {
      const quality = qualities[qi]

      const recompressed = await sharp(originalBuf)
        .resize(w, h, { fit: 'fill' })
        .grayscale()
        .jpeg({ quality })
        .toBuffer()

      const recompRaw = await sharp(recompressed)
        .raw()
        .toBuffer({ resolveWithObject: true })

      const recompPixels = new Uint8Array(recompRaw.data)

      // Compute per-block mean squared error
      for (let by = 0; by < GRID_SIZE; by++) {
        for (let bx = 0; bx < GRID_SIZE; bx++) {
          const blockIdx = by * GRID_SIZE + bx
          const startY = by * blockH
          const startX = bx * blockW
          let sumSqErr = 0
          let count = 0

          for (let y = startY; y < Math.min(startY + blockH, h); y++) {
            for (let x = startX; x < Math.min(startX + blockW, w); x++) {
              const idx = y * w + x
              const diff = origPixels[idx] - recompPixels[idx]
              sumSqErr += diff * diff
              count++
            }
          }

          blockErrors[blockIdx][qi] = count > 0 ? sumSqErr / count : 0
        }
      }
    }

    // For each block, find the quality level with minimum error ("ghost quality")
    const ghostQualities: number[] = []

    for (let b = 0; b < numBlocks; b++) {
      let minErr = Infinity
      let bestQi = 0

      for (let qi = 0; qi < qualities.length; qi++) {
        if (blockErrors[b][qi] < minErr) {
          minErr = blockErrors[b][qi]
          bestQi = qi
        }
      }

      ghostQualities.push(qualities[bestQi])
    }

    // Compute statistics on ghost quality distribution
    const meanGQ = ghostQualities.reduce((s, v) => s + v, 0) / numBlocks
    const ghostVariance = Math.sqrt(
      ghostQualities.reduce((s, v) => s + (v - meanGQ) ** 2, 0) / numBlocks,
    )

    // Find dominant quality (mode)
    const qualityCounts: Record<number, number> = {}
    for (const q of ghostQualities) {
      qualityCounts[q] = (qualityCounts[q] ?? 0) + 1
    }
    const dominantQuality = Number(
      Object.entries(qualityCounts).sort((a, b) => b[1] - a[1])[0][0],
    )

    // Count outlier blocks (not matching dominant quality)
    const outlierBlocks = ghostQualities.filter(q => q !== dominantQuality).length

    // Quality range
    const minQ = Math.min(...ghostQualities)
    const maxQ = Math.max(...ghostQualities)
    const qualityRange = maxQ - minQ

    // ── Compute ghost score ──────────────────────────────────────────────
    //
    // CALIBRATION NOTES:
    //   - A photo of a physical document (diploma, certificate) taken with a
    //     phone/camera naturally produces variance 4-10 due to:
    //       • varied textures (gold paper, white margins, ornate borders)
    //       • lighting gradients (angle, distance from flash)
    //       • camera JPEG encoder not matching original print quality
    //   - A genuine edit (paste from another JPEG source) produces variance 8+
    //     but ALSO shows a distinct cluster of outlier blocks at a specific
    //     different quality level, not just random noise.
    //   - We need to distinguish "natural texture variance" from "actual editing"
    //     by checking whether outlier blocks cluster at a SPECIFIC alternative
    //     quality (editing) vs spread across many levels (natural noise).
    //
    let ghostScore = 0

    // Check if outlier blocks cluster at specific quality levels (editing signal)
    // vs spread across many levels (natural noise from photo of physical doc)
    const outlierQualities = ghostQualities.filter(q => q !== dominantQuality)
    const outlierQSet = new Set(outlierQualities)
    const outlierConcentration = outlierQualities.length > 0
      ? Math.max(...[...outlierQSet].map(q => outlierQualities.filter(oq => oq === q).length)) / outlierQualities.length
      : 0
    // outlierConcentration ~1.0 = all outliers at same quality = likely editing
    // outlierConcentration ~0.2 = outliers spread across many qualities = natural

    // High variance in ghost quality
    // Raised thresholds: variance > 6 is suspicious, > 10 is strong
    // (photos of physical docs typically show variance 3-7)
    if (ghostVariance > 6) {
      const varianceContrib = Math.min(35, Math.round((ghostVariance - 6) * 5))
      // Scale down if outliers are scattered (natural) vs concentrated (editing)
      ghostScore += Math.round(varianceContrib * (0.4 + 0.6 * outlierConcentration))
    }

    // Many outlier blocks = selective editing (raised from 0.1 to 0.2)
    const outlierRatio = outlierBlocks / numBlocks
    if (outlierRatio > 0.2) {
      const outlierContrib = Math.min(25, Math.round((outlierRatio - 0.2) * 100))
      ghostScore += Math.round(outlierContrib * (0.3 + 0.7 * outlierConcentration))
    }

    // Wide quality range = multiple source images (raised threshold)
    if (qualityRange > QUALITY_STEP * 3) {
      ghostScore += Math.min(15, Math.round((qualityRange - QUALITY_STEP * 3) / 3))
    }

    // STRONG signal: small number of outliers concentrated at ONE quality
    // This is the hallmark of a paste-from-different-source edit
    if (outlierBlocks >= 2 && outlierBlocks <= 12 &&
        qualityRange >= QUALITY_STEP * 3 &&
        outlierConcentration >= 0.7) {
      ghostScore += Math.min(25, outlierBlocks * 3)
    }

    ghostScore = Math.min(100, ghostScore)

    console.log(`[jpegGhost] variance=${ghostVariance.toFixed(2)}, dominantQ=${dominantQuality}, outliers=${outlierBlocks}/${numBlocks}, range=${qualityRange}, outlierConcentration=${outlierConcentration.toFixed(2)} → score=${ghostScore}`)

    return {
      ghostScore,
      ghostVariance:   Math.round(ghostVariance * 100) / 100,
      dominantQuality,
      outlierBlocks,
      totalBlocks:     numBlocks,
      qualityRange,
      analysisMs:      Date.now() - t0,
    }
  } catch (err) {
    console.error('[jpegGhost] Error:', err instanceof Error ? err.message : err)
    return {
      ghostScore:      0,
      ghostVariance:   0,
      dominantQuality: 0,
      outlierBlocks:   0,
      totalBlocks:     0,
      qualityRange:    0,
      analysisMs:      Date.now() - t0,
    }
  }
}
