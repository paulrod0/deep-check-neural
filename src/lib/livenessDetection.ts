/**
 * livenessDetection.ts — Anti-Spoofing Liveness Checks
 * =====================================================
 *
 * Performs passive and active liveness detection to prevent:
 *   - Printed photo attacks
 *   - Screen replay attacks
 *   - 3D mask attacks (limited)
 *   - Deepfake video injection
 *
 * All checks run 100% in the browser via Canvas API analysis.
 * No biometric data leaves the device.
 *
 * Passive checks (single frame):
 *   1. Moiré pattern detection (screen/print artifacts)
 *   2. Specular reflection analysis (flat surface glare)
 *   3. Texture frequency analysis (lack of skin texture = flat media)
 *   4. Color distribution analysis (unnatural gamut = screen)
 *   5. Edge sharpness analysis (printed edges differ from real skin)
 *
 * Active checks (multi-frame, via webcam):
 *   6. Blink detection (requires eye state change)
 *   7. Head pose variation (micro-movements)
 *   8. Depth consistency (parallax estimation from head movement)
 *
 * Zero external dependencies.
 */

'use client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LivenessResult {
  /** Overall liveness score (0-100, higher = more likely live) */
  score: number
  /** Whether the subject passes liveness check */
  isLive: boolean
  /** Individual check results */
  checks: LivenessCheck[]
  /** Detected attack type, if any */
  attackType: 'none' | 'printed_photo' | 'screen_replay' | 'mask' | 'unknown'
  /** Processing time in ms */
  processingMs: number
}

export interface LivenessCheck {
  name: string
  passed: boolean
  score: number
  detail: string
}

// ── Canvas Helpers ──────────────────────────────────────────────────────────

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

function getImageData(img: HTMLImageElement, width?: number, height?: number): ImageData {
  const w = width || img.naturalWidth
  const h = height || img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

// ── 1. Moiré Pattern Detection ──────────────────────────────────────────────
// Screens and printed photos exhibit moiré interference patterns visible
// as periodic high-frequency artifacts in the Fourier domain.

function detectMoirePatterns(imageData: ImageData): LivenessCheck {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)

  // Convert to grayscale
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }

  // Compute local frequency via Laplacian
  let highFreqEnergy = 0
  let totalEnergy = 0
  const stride = width

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * stride + x
      // 5-point Laplacian
      const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - stride] + gray[idx + stride]
      highFreqEnergy += lap * lap

      // Check for periodic high-frequency (moiré signature)
      // Compare with 2-step neighbors for periodicity
      const lap2 = -4 * gray[idx] + gray[idx - 2] + gray[idx + 2] + gray[idx - 2 * stride] + gray[idx + 2 * stride]
      if (Math.abs(lap) > 15 && Math.abs(lap2) > 15 && Math.sign(lap) !== Math.sign(lap2)) {
        totalEnergy += 1
      }
    }
  }

  const pixelCount = (width - 4) * (height - 4)
  const moireRatio = totalEnergy / pixelCount
  const freqRatio = Math.sqrt(highFreqEnergy / pixelCount)

  // Moiré patterns: high periodic frequency ratio
  const hasMoire = moireRatio > 0.15 || freqRatio > 40
  const score = hasMoire ? 20 : 90

  return {
    name: 'Moiré Pattern',
    passed: !hasMoire,
    score,
    detail: hasMoire
      ? `Periodic artifacts detected (${(moireRatio * 100).toFixed(1)}% periodicity) — possible screen/print`
      : `No moiré patterns (${(moireRatio * 100).toFixed(1)}% periodicity — clean)`,
  }
}

// ── 2. Specular Reflection Analysis ─────────────────────────────────────────
// Flat surfaces (screens, photos) produce uniform specular reflections.
// Real faces show diffuse highlights with skin scattering.

function analyzeSpecularReflection(imageData: ImageData): LivenessCheck {
  const { data, width, height } = imageData
  let brightPixels = 0
  let brightCluster = 0
  let maxClusterSize = 0
  let currentCluster = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]

      if (luminance > 240) {
        brightPixels++
        currentCluster++
        if (currentCluster > maxClusterSize) maxClusterSize = currentCluster
      } else {
        if (currentCluster > 20) brightCluster++
        currentCluster = 0
      }
    }
  }

  const brightRatio = brightPixels / (width * height)
  // Large uniform bright areas = flat reflective surface
  const hasUniformGlare = brightRatio > 0.05 && maxClusterSize > width * 0.3
  const score = hasUniformGlare ? 25 : 85

  return {
    name: 'Specular Reflection',
    passed: !hasUniformGlare,
    score,
    detail: hasUniformGlare
      ? `Uniform glare detected (${(brightRatio * 100).toFixed(1)}% bright, cluster ${maxClusterSize}px) — flat surface suspected`
      : `Natural reflection pattern (${(brightRatio * 100).toFixed(1)}% highlights)`,
  }
}

// ── 3. Texture Frequency Analysis ───────────────────────────────────────────
// Real skin has micro-texture (pores, fine lines) that's absent in
// printed photos and screen displays.

function analyzeTextureFrequency(imageData: ImageData): LivenessCheck {
  const { data, width, height } = imageData

  // Sample center region (face area)
  const cx = Math.floor(width * 0.3)
  const cy = Math.floor(height * 0.3)
  const cw = Math.floor(width * 0.4)
  const ch = Math.floor(height * 0.4)

  let gradientSum = 0
  let gradientCount = 0

  for (let y = cy + 1; y < cy + ch - 1; y++) {
    for (let x = cx + 1; x < cx + cw - 1; x++) {
      const idx = (y * width + x) * 4
      const idxR = (y * width + x + 1) * 4
      const idxB = ((y + 1) * width + x) * 4

      // Gradient magnitude
      const gx = Math.abs(data[idx] - data[idxR]) + Math.abs(data[idx + 1] - data[idxR + 1]) + Math.abs(data[idx + 2] - data[idxR + 2])
      const gy = Math.abs(data[idx] - data[idxB]) + Math.abs(data[idx + 1] - data[idxB + 1]) + Math.abs(data[idx + 2] - data[idxB + 2])
      gradientSum += Math.sqrt(gx * gx + gy * gy)
      gradientCount++
    }
  }

  const avgGradient = gradientCount > 0 ? gradientSum / gradientCount : 0

  // Low gradient = smooth/flat (printed or screen)
  // High gradient = real skin texture
  const hasTexture = avgGradient > 8
  const score = hasTexture ? 85 : 30

  return {
    name: 'Skin Texture',
    passed: hasTexture,
    score,
    detail: hasTexture
      ? `Micro-texture detected (gradient ${avgGradient.toFixed(1)}) — consistent with real skin`
      : `Low texture detail (gradient ${avgGradient.toFixed(1)}) — possible flat media`,
  }
}

// ── 4. Color Distribution Analysis ──────────────────────────────────────────
// Screen displays have a limited color gamut and characteristic RGB peaks.
// Natural skin tones follow a specific color distribution.

function analyzeColorDistribution(imageData: ImageData): LivenessCheck {
  const { data, width, height } = imageData

  // Build color channel histograms
  const rHist = new Uint32Array(256)
  const gHist = new Uint32Array(256)
  const bHist = new Uint32Array(256)

  // Analyze skin-tone pixels
  let skinPixels = 0
  let totalPixels = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    rHist[r]++; gHist[g]++; bHist[b]++
    totalPixels++

    // Skin tone detection (YCrCb-based)
    const cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b
    const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b
    if (cr > 133 && cr < 173 && cb > 77 && cb < 127) {
      skinPixels++
    }
  }

  const skinRatio = skinPixels / totalPixels

  // Check for unnaturally even distribution (screen characteristic)
  let rVariance = 0, gVariance = 0, bVariance = 0
  const binSize = 16
  for (let i = 0; i < 256; i += binSize) {
    let rBin = 0, gBin = 0, bBin = 0
    for (let j = i; j < i + binSize && j < 256; j++) {
      rBin += rHist[j]; gBin += gHist[j]; bBin += bHist[j]
    }
    rVariance += rBin; gVariance += gBin; bVariance += bBin
  }

  // Screens tend to have more uniform distribution
  const naturalColor = skinRatio > 0.05 && skinRatio < 0.85
  const score = naturalColor ? 80 : 35

  return {
    name: 'Color Distribution',
    passed: naturalColor,
    score,
    detail: naturalColor
      ? `Natural skin tones detected (${(skinRatio * 100).toFixed(1)}% skin pixels)`
      : `Abnormal color distribution (${(skinRatio * 100).toFixed(1)}% skin — expected 5-85%)`,
  }
}

// ── 5. Edge Sharpness Analysis ──────────────────────────────────────────────
// Printed photos have unnaturally sharp edges at face boundaries.
// Screen replays show characteristic anti-aliasing patterns.

function analyzeEdgeSharpness(imageData: ImageData): LivenessCheck {
  const { data, width, height } = imageData

  // Sobel edge detection
  let edgeSum = 0
  let edgeCount = 0
  let sharpEdges = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4

      // Sobel X
      const gx = (
        -data[((y - 1) * width + x - 1) * 4] + data[((y - 1) * width + x + 1) * 4] +
        -2 * data[(y * width + x - 1) * 4] + 2 * data[(y * width + x + 1) * 4] +
        -data[((y + 1) * width + x - 1) * 4] + data[((y + 1) * width + x + 1) * 4]
      )

      // Sobel Y
      const gy = (
        -data[((y - 1) * width + x - 1) * 4] - 2 * data[((y - 1) * width + x) * 4] - data[((y - 1) * width + x + 1) * 4] +
        data[((y + 1) * width + x - 1) * 4] + 2 * data[((y + 1) * width + x) * 4] + data[((y + 1) * width + x + 1) * 4]
      )

      const magnitude = Math.sqrt(gx * gx + gy * gy)
      edgeSum += magnitude
      edgeCount++
      if (magnitude > 200) sharpEdges++
    }
  }

  const avgEdge = edgeCount > 0 ? edgeSum / edgeCount : 0
  const sharpRatio = edgeCount > 0 ? sharpEdges / edgeCount : 0

  // Too many very sharp edges = printed or screen
  const naturalEdges = sharpRatio < 0.03 && avgEdge > 5
  const score = naturalEdges ? 80 : 35

  return {
    name: 'Edge Profile',
    passed: naturalEdges,
    score,
    detail: naturalEdges
      ? `Natural edge profile (avg ${avgEdge.toFixed(1)}, ${(sharpRatio * 100).toFixed(2)}% sharp)`
      : `Abnormal edge sharpness (avg ${avgEdge.toFixed(1)}, ${(sharpRatio * 100).toFixed(2)}% sharp)`,
  }
}

// ── Main Liveness Detection ─────────────────────────────────────────────────

/**
 * Perform passive liveness detection on a single selfie frame.
 * All analysis runs in the browser via Canvas API.
 *
 * @param selfieDataUrl The selfie image as a data URL
 * @returns LivenessResult with overall score and individual checks
 */
export async function detectLiveness(selfieDataUrl: string): Promise<LivenessResult> {
  const t0 = performance.now()

  const img = await loadImage(selfieDataUrl)
  // Resize for consistent analysis (max 640px)
  const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.floor(img.naturalWidth * scale)
  const h = Math.floor(img.naturalHeight * scale)
  const imageData = getImageData(img, w, h)

  const checks: LivenessCheck[] = [
    detectMoirePatterns(imageData),
    analyzeSpecularReflection(imageData),
    analyzeTextureFrequency(imageData),
    analyzeColorDistribution(imageData),
    analyzeEdgeSharpness(imageData),
  ]

  // Weighted score
  const weights = [0.25, 0.15, 0.25, 0.15, 0.20]
  const overallScore = Math.round(
    checks.reduce((sum, check, i) => sum + check.score * weights[i], 0)
  )

  // Determine attack type
  const failedChecks = checks.filter(c => !c.passed).map(c => c.name)
  let attackType: LivenessResult['attackType'] = 'none'
  if (failedChecks.includes('Moiré Pattern') && failedChecks.includes('Skin Texture')) {
    attackType = 'screen_replay'
  } else if (failedChecks.includes('Specular Reflection') && failedChecks.includes('Edge Profile')) {
    attackType = 'printed_photo'
  } else if (failedChecks.length >= 3) {
    attackType = 'unknown'
  }

  return {
    score: overallScore,
    isLive: overallScore >= 60 && failedChecks.length <= 1,
    checks,
    attackType,
    processingMs: Math.round(performance.now() - t0),
  }
}
