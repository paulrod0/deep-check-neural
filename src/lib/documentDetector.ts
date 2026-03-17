/**
 * documentDetector.ts — Client-Side Document Type Auto-Detection
 * ================================================================
 * Analyzes a captured document image to detect:
 *   1. Document type (passport, ID card, driving license)
 *   2. MRZ zone presence and approximate format
 *   3. Image quality (blur, glare, rotation)
 *   4. Aspect ratio classification
 *
 * Runs entirely in the browser via Canvas API — no server call needed.
 * Used by the KYC wizard to auto-select document type and provide
 * real-time quality feedback.
 *
 * Zero external dependencies.
 */

'use client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocumentDetectionResult {
  /** Detected document type */
  detectedType:      'passport' | 'id_card' | 'driving_license' | 'unknown'
  /** Confidence 0–100 */
  confidence:        number
  /** Detected aspect ratio category */
  aspectCategory:    'td1' | 'td3' | 'square' | 'unknown'
  /** Aspect ratio (width/height) */
  aspectRatio:       number
  /** Whether MRZ-like text was detected at bottom */
  mrzZoneDetected:   boolean
  /** Image quality score 0–100 (higher is better) */
  qualityScore:      number
  /** Quality issues found */
  qualityIssues:     string[]
  /** Processing time in ms */
  processingMs:      number
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Standard document aspect ratios (width/height)
const PASSPORT_RATIO      = 1.42  // TD3: 125mm × 88mm = 1.42
const ID_CARD_RATIO       = 1.59  // TD1: 85.6mm × 53.98mm = 1.586 (credit card size)
const DRIVING_LICENSE_RATIO = 1.59  // Same as ID card in most countries

// Tolerance for aspect ratio matching
const RATIO_TOLERANCE = 0.15

// MRZ detection: character-like density in bottom portion of image
const MRZ_BOTTOM_FRACTION = 0.25  // Bottom 25% of the image

// Quality thresholds
const BLUR_THRESHOLD  = 20     // Laplacian variance
const GLARE_THRESHOLD = 0.03   // Fraction of overexposed pixels

// ── Canvas helpers ────────────────────────────────────────────────────────────

function loadImageToCanvas(dataUrl: string): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // Scale down for performance (max 800px)
      const scale = Math.min(1, 800 / Math.max(img.width, img.height))
      const width  = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve({ canvas, ctx, width, height })
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

function getGrayscale(ctx: CanvasRenderingContext2D, width: number, height: number): Uint8Array {
  const imageData = ctx.getImageData(0, 0, width, height)
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    const r = imageData.data[i * 4]
    const g = imageData.data[i * 4 + 1]
    const b = imageData.data[i * 4 + 2]
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return gray
}

// ── Blur detection (Laplacian variance) ──────────────────────────────────────

function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  let sum = 0
  let sumSq = 0
  let count = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const lap = (
        gray[idx - width] + gray[idx + width] +
        gray[idx - 1] + gray[idx + 1] -
        4 * gray[idx]
      )
      sum += lap
      sumSq += lap * lap
      count++
    }
  }

  const mean = sum / count
  return (sumSq / count) - (mean * mean)
}

// ── Glare detection ──────────────────────────────────────────────────────────

function glareScore(gray: Uint8Array): number {
  let overexposed = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= 250) overexposed++
  }
  return overexposed / gray.length
}

// ── MRZ zone detection ──────────────────────────────────────────────────────

/**
 * Check if the bottom portion of the image contains MRZ-like patterns:
 *   - High horizontal edge density (text lines)
 *   - Relatively uniform dark text on light background
 */
function detectMRZZone(gray: Uint8Array, width: number, height: number): boolean {
  const startY = Math.floor(height * (1 - MRZ_BOTTOM_FRACTION))
  let edgeCount = 0
  let totalPixels = 0
  let darkPixels = 0

  for (let y = startY; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      // Horizontal Sobel edge
      const gx = Math.abs(gray[idx + 1] - gray[idx - 1])
      if (gx > 30) edgeCount++
      if (gray[idx] < 100) darkPixels++
      totalPixels++
    }
  }

  const edgeDensity = edgeCount / totalPixels
  const darkDensity = darkPixels / totalPixels

  // MRZ zone typically has:
  // - Medium-high edge density (text characters)
  // - Noticeable dark pixels (printed text)
  return edgeDensity > 0.08 && darkDensity > 0.05 && darkDensity < 0.7
}

// ── Aspect ratio classification ─────────────────────────────────────────────

function classifyAspectRatio(ratio: number): DocumentDetectionResult['aspectCategory'] {
  if (Math.abs(ratio - PASSPORT_RATIO) < RATIO_TOLERANCE) return 'td3'
  if (Math.abs(ratio - ID_CARD_RATIO) < RATIO_TOLERANCE) return 'td1'
  if (Math.abs(ratio - 1.0) < 0.15) return 'square'
  return 'unknown'
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect document type from a captured image.
 *
 * @param dataUrl - Base64/data URL of the document image
 * @returns Detection result with type, confidence, quality metrics
 */
export async function detectDocumentType(dataUrl: string): Promise<DocumentDetectionResult> {
  const t0 = performance.now()

  try {
    const { ctx, width, height } = await loadImageToCanvas(dataUrl)
    const gray = getGrayscale(ctx, width, height)

    // Aspect ratio
    const aspectRatio = width / height
    const aspectCategory = classifyAspectRatio(aspectRatio)

    // Quality analysis
    const blur  = laplacianVariance(gray, width, height)
    const glare = glareScore(gray)
    const qualityIssues: string[] = []

    if (blur < BLUR_THRESHOLD) {
      qualityIssues.push('Image appears blurry — try holding the camera steady')
    }
    if (glare > GLARE_THRESHOLD) {
      qualityIssues.push('Glare detected — tilt the document to reduce reflections')
    }
    if (width < 400 || height < 300) {
      qualityIssues.push('Image resolution too low — move the camera closer')
    }

    const qualityScore = Math.round(Math.max(0, Math.min(100,
      100 - (blur < BLUR_THRESHOLD ? 40 : 0) - (glare > GLARE_THRESHOLD ? 30 : 0) - (width < 400 ? 20 : 0)
    )))

    // MRZ detection
    const mrzZoneDetected = detectMRZZone(gray, width, height)

    // Document type classification
    let detectedType: DocumentDetectionResult['detectedType'] = 'unknown'
    let confidence = 30

    if (aspectCategory === 'td3') {
      // Passport-like aspect ratio
      detectedType = 'passport'
      confidence = mrzZoneDetected ? 85 : 60
    } else if (aspectCategory === 'td1') {
      // ID card / driving license aspect ratio
      if (mrzZoneDetected) {
        detectedType = 'id_card'
        confidence = 75
      } else {
        // Could be driving license (many don't have MRZ)
        detectedType = 'driving_license'
        confidence = 55
      }
    } else if (mrzZoneDetected) {
      // Unknown aspect ratio but MRZ detected
      detectedType = aspectRatio > 1.5 ? 'id_card' : 'passport'
      confidence = 50
    }

    return {
      detectedType,
      confidence,
      aspectCategory,
      aspectRatio: Math.round(aspectRatio * 100) / 100,
      mrzZoneDetected,
      qualityScore,
      qualityIssues,
      processingMs: performance.now() - t0,
    }
  } catch {
    return {
      detectedType: 'unknown',
      confidence: 0,
      aspectCategory: 'unknown',
      aspectRatio: 0,
      mrzZoneDetected: false,
      qualityScore: 0,
      qualityIssues: ['Failed to analyze image'],
      processingMs: performance.now() - t0,
    }
  }
}

/**
 * Quick quality check on a document image.
 * Returns issues array (empty = good quality).
 */
export async function quickQualityCheck(dataUrl: string): Promise<string[]> {
  const result = await detectDocumentType(dataUrl)
  return result.qualityIssues
}
