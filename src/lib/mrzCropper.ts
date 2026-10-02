/**
 * mrzCropper.ts — Automatic MRZ Zone Detection & Cropping
 * ========================================================
 *
 * Detects and extracts the Machine Readable Zone (MRZ) from document
 * images to improve OCR accuracy. Works entirely client-side.
 *
 * Detection strategy:
 *   1. Convert to grayscale
 *   2. Apply Sobel edge detection
 *   3. Apply morphological closing (thick horizontal lines)
 *   4. Find contours/regions with high horizontal density
 *   5. Select the bottom-most region with correct aspect ratio
 *   6. Crop and enhance (threshold + deskew) for OCR
 *
 * Supported formats:
 *   - TD1 (3 lines × 30 chars): ID cards, 90mm × 55mm MRZ zone
 *   - TD3 (2 lines × 44 chars): Passports, 125mm × 16mm MRZ zone
 *
 * Zero external dependencies.
 */

'use client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MRZCropResult {
  /** Whether MRZ zone was detected */
  found: boolean
  /** Cropped MRZ zone as data URL (if found) */
  croppedDataUrl: string | null
  /** Enhanced (binarized) MRZ for OCR */
  enhancedDataUrl: string | null
  /** Detected MRZ format */
  format: 'TD1' | 'TD3' | 'unknown'
  /** Confidence of detection (0-1) */
  confidence: number
  /** Bounding box of MRZ zone in original image */
  boundingBox: { x: number; y: number; width: number; height: number } | null
  /** Processing time in ms */
  processingMs: number
}

// ── Image Processing Helpers ────────────────────────────────────────────────

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return gray
}

// Sobel edge detection (horizontal emphasis)
function sobelHorizontal(gray: Float32Array, width: number, height: number): Float32Array {
  const edges = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      // Horizontal Sobel kernel
      const gx = (
        -gray[(y - 1) * width + x - 1] + gray[(y - 1) * width + x + 1] +
        -2 * gray[y * width + x - 1] + 2 * gray[y * width + x + 1] +
        -gray[(y + 1) * width + x - 1] + gray[(y + 1) * width + x + 1]
      )
      edges[idx] = Math.abs(gx)
    }
  }
  return edges
}

// Morphological closing (dilate then erode) for horizontal structure
function morphClose(binary: Uint8Array, width: number, height: number, kernelW: number, kernelH: number): Uint8Array {
  const dilated = new Uint8Array(width * height)
  const result = new Uint8Array(width * height)
  const kw2 = Math.floor(kernelW / 2)
  const kh2 = Math.floor(kernelH / 2)

  // Dilate
  for (let y = kh2; y < height - kh2; y++) {
    for (let x = kw2; x < width - kw2; x++) {
      let maxVal = 0
      for (let ky = -kh2; ky <= kh2; ky++) {
        for (let kx = -kw2; kx <= kw2; kx++) {
          maxVal = Math.max(maxVal, binary[(y + ky) * width + x + kx])
        }
      }
      dilated[y * width + x] = maxVal
    }
  }

  // Erode
  for (let y = kh2; y < height - kh2; y++) {
    for (let x = kw2; x < width - kw2; x++) {
      let minVal = 255
      for (let ky = -kh2; ky <= kh2; ky++) {
        for (let kx = -kw2; kx <= kw2; kx++) {
          minVal = Math.min(minVal, dilated[(y + ky) * width + x + kx])
        }
      }
      result[y * width + x] = minVal
    }
  }

  return result
}

// Find horizontal dense regions (potential MRZ lines)
function findMRZRegion(
  edges: Float32Array,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number; density: number } | null {
  // Threshold edges
  const threshold = 30
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < binary.length; i++) {
    binary[i] = edges[i] > threshold ? 255 : 0
  }

  // Morphological closing with horizontal kernel (connect MRZ characters)
  const kernelW = Math.max(15, Math.floor(width / 40))
  const kernelH = 3
  const closed = morphClose(binary, width, height, kernelW, kernelH)

  // Compute row density (fraction of white pixels per row)
  const rowDensity = new Float32Array(height)
  for (let y = 0; y < height; y++) {
    let count = 0
    for (let x = 0; x < width; x++) {
      if (closed[y * width + x] > 0) count++
    }
    rowDensity[y] = count / width
  }

  // Find bottom-most dense region (MRZ is usually at bottom)
  // Look for consecutive rows with density > 0.3
  const minDensity = 0.25
  const minConsecutive = Math.max(10, Math.floor(height * 0.02))

  let bestRegion: { y: number; h: number; avgDensity: number } | null = null
  let currentStart = -1
  let currentDensitySum = 0
  let currentCount = 0

  // Search from bottom up
  for (let y = height - 1; y >= Math.floor(height * 0.3); y--) {
    if (rowDensity[y] > minDensity) {
      if (currentStart === -1) currentStart = y
      currentDensitySum += rowDensity[y]
      currentCount++
    } else {
      if (currentCount >= minConsecutive) {
        const region = {
          y: currentStart - currentCount + 1,
          h: currentCount,
          avgDensity: currentDensitySum / currentCount,
        }
        if (!bestRegion || region.y > bestRegion.y) {
          bestRegion = region
        }
      }
      currentStart = -1
      currentDensitySum = 0
      currentCount = 0
    }
  }
  if (currentCount >= minConsecutive) {
    const region = {
      y: currentStart - currentCount + 1,
      h: currentCount,
      avgDensity: currentDensitySum / currentCount,
    }
    if (!bestRegion || region.y > bestRegion.y) {
      bestRegion = region
    }
  }

  if (!bestRegion) return null

  // Find horizontal extent (leftmost and rightmost dense columns in region)
  let minX = width, maxX = 0
  for (let y = bestRegion.y; y < bestRegion.y + bestRegion.h; y++) {
    for (let x = 0; x < width; x++) {
      if (closed[y * width + x] > 0) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
  }

  // Add padding
  const padX = Math.floor(width * 0.02)
  const padY = Math.floor(bestRegion.h * 0.3)
  const x = Math.max(0, minX - padX)
  const y = Math.max(0, bestRegion.y - padY)
  const w = Math.min(width, maxX + padX) - x
  const h = Math.min(height, bestRegion.y + bestRegion.h + padY) - y

  return { x, y, w, h, density: bestRegion.avgDensity }
}

// Enhance MRZ image for OCR (binarize + contrast)
function enhanceForOCR(imageData: ImageData): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)

  // Otsu's threshold
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    histogram[gray]++
  }

  const total = width * height
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * histogram[i]

  let sumB = 0, wB = 0, maxVariance = 0, threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += histogram[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break

    sumB += t * histogram[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const variance = wB * wF * (mB - mF) * (mB - mF)

    if (variance > maxVariance) {
      maxVariance = variance
      threshold = t
    }
  }

  // Apply threshold (inverted: black text on white background)
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const val = gray < threshold ? 0 : 255
    result.data[i] = val
    result.data[i + 1] = val
    result.data[i + 2] = val
    result.data[i + 3] = 255
  }

  return result
}

// ── Main Export ──────────────────────────────────────────────────────────────

/**
 * Detect and crop the MRZ zone from a document image.
 *
 * @param documentDataUrl The document image as a data URL
 * @returns MRZCropResult with cropped and enhanced MRZ images
 */
export async function cropMRZZone(documentDataUrl: string): Promise<MRZCropResult> {
  const t0 = performance.now()

  try {
    const img = await loadImage(documentDataUrl)

    // Resize for consistent processing (max 1200px wide)
    const scale = Math.min(1, 1200 / img.naturalWidth)
    const w = Math.floor(img.naturalWidth * scale)
    const h = Math.floor(img.naturalHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)

    // 1. Grayscale
    const gray = toGrayscale(imageData)

    // 2. Horizontal Sobel edges
    const edges = sobelHorizontal(gray, w, h)

    // 3. Find MRZ region
    const region = findMRZRegion(edges, w, h)

    if (!region || region.w < w * 0.3 || region.h < 10) {
      return {
        found: false,
        croppedDataUrl: null,
        enhancedDataUrl: null,
        format: 'unknown',
        confidence: 0,
        boundingBox: null,
        processingMs: Math.round(performance.now() - t0),
      }
    }

    // 4. Crop
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = region.w
    cropCanvas.height = region.h
    const cropCtx = cropCanvas.getContext('2d')!
    cropCtx.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
    const croppedDataUrl = cropCanvas.toDataURL('image/png')

    // 5. Enhance for OCR
    const croppedImageData = cropCtx.getImageData(0, 0, region.w, region.h)
    const enhanced = enhanceForOCR(croppedImageData)
    cropCtx.putImageData(enhanced, 0, 0)
    const enhancedDataUrl = cropCanvas.toDataURL('image/png')

    // 6. Determine format from aspect ratio of MRZ zone
    const aspectRatio = region.w / region.h
    let format: 'TD1' | 'TD3' | 'unknown' = 'unknown'
    if (aspectRatio > 5 && aspectRatio < 12) {
      format = 'TD3' // Passport: wide and thin (2 lines)
    } else if (aspectRatio > 2 && aspectRatio <= 5) {
      format = 'TD1' // ID card: less wide (3 lines)
    }

    // Scale bounding box back to original image coordinates
    const origBB = {
      x: Math.round(region.x / scale),
      y: Math.round(region.y / scale),
      width: Math.round(region.w / scale),
      height: Math.round(region.h / scale),
    }

    return {
      found: true,
      croppedDataUrl,
      enhancedDataUrl,
      format,
      confidence: Math.min(1, region.density * 1.5),
      boundingBox: origBB,
      processingMs: Math.round(performance.now() - t0),
    }
  } catch (err) {
    console.error('[mrzCropper] Error:', err)
    return {
      found: false,
      croppedDataUrl: null,
      enhancedDataUrl: null,
      format: 'unknown',
      confidence: 0,
      boundingBox: null,
      processingMs: Math.round(performance.now() - t0),
    }
  }
}
