/**
 * frequencyAnalysis.ts — Server-side Frequency Domain Analysis
 *
 * Two sub-analyses for detecting image manipulation via frequency domain:
 *   1. FFT spectral analysis — detects splicing artifacts and double-JPEG ghosts
 *   2. Haar wavelet decomposition — detects regional noise inconsistencies
 *
 * Implemented in pure JS/TS (no WASM, no native extensions) for Lambda compatibility.
 * Uses sharp for pixel extraction.
 */

import sharp from 'sharp'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FrequencyResult {
  spectralAnomalyScore: number   // 0–100: periodic peaks or splicing artifacts in FFT
  waveletScore:         number   // 0–100: inconsistent HH subbands between regions
  score:                number   // 0–100 combined
  analysisMs:           number
}

// ── Cooley-Tukey FFT (pure JS, 1D) ────────────────────────────────────────────
// Operates on power-of-two arrays

function fft1d(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n <= 1) return

  // Bit-reversal permutation
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const ang     = (2 * Math.PI) / len
    const wRe     = Math.cos(ang), wIm = -Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let k = 0; k < halfLen; k++) {
        const uRe = re[i + k], uIm = im[i + k]
        const vRe = re[i + k + halfLen] * curRe - im[i + k + halfLen] * curIm
        const vIm = re[i + k + halfLen] * curIm + im[i + k + halfLen] * curRe
        re[i + k]           = uRe + vRe
        im[i + k]           = uIm + vIm
        re[i + k + halfLen] = uRe - vRe
        im[i + k + halfLen] = uIm - vIm
        const newRe = curRe * wRe - curIm * wIm
        curIm       = curRe * wIm + curIm * wRe
        curRe       = newRe
      }
    }
  }
}

/** Compute 2D FFT via row+column 1D FFTs */
function fft2d(lum: Float64Array, width: number, height: number): Float64Array {
  // We compute the power spectrum (magnitude squared) at each frequency bin
  const re = new Float64Array(width * height)
  const im = new Float64Array(width * height)
  re.set(lum)

  // Row-wise FFTs
  const rowRe = new Float64Array(width)
  const rowIm = new Float64Array(width)
  for (let y = 0; y < height; y++) {
    rowRe.set(re.subarray(y * width, (y + 1) * width))
    rowIm.fill(0)
    fft1d(rowRe, rowIm)
    re.set(rowRe, y * width)
    im.set(rowIm, y * width)
  }

  // Column-wise FFTs
  const colRe = new Float64Array(height)
  const colIm = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colRe[y] = re[y * width + x]
      colIm[y] = im[y * width + x]
    }
    fft1d(colRe, colIm)
    for (let y = 0; y < height; y++) {
      re[y * width + x] = colRe[y]
      im[y * width + x] = colIm[y]
    }
  }

  // Power spectrum: |FFT|^2
  const power = new Float64Array(width * height)
  for (let i = 0; i < power.length; i++) {
    power[i] = re[i] * re[i] + im[i] * im[i]
  }
  return power
}

/** Round up to nearest power of 2 */
function nextPow2(n: number): number {
  let p = 1; while (p < n) p <<= 1; return p
}

/** Pad lum array to (pw × ph) by replicating boundary pixels */
function padLum(src: Float64Array, w: number, h: number, pw: number, ph: number): Float64Array {
  const out = new Float64Array(pw * ph)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * pw + x] = src[y * w + x]
    for (let x = w; x < pw; x++) out[y * pw + x] = src[y * w + w - 1]
  }
  for (let y = h; y < ph; y++) {
    for (let x = 0; x < pw; x++) out[y * pw + x] = out[(h - 1) * pw + x]
  }
  return out
}

// ── FFT Spectral Analysis ──────────────────────────────────────────────────────

/**
 * Detect periodic spectral peaks (moiré, halftone, splicing grid) in the FFT
 * power spectrum. Authentic photographs have broad, smooth power spectra.
 * Manipulated/printed/scanned documents often show periodic peaks.
 */
function analyzeSpectrum(power: Float64Array, pw: number, ph: number): number {
  const cx = pw >> 1, cy = ph >> 1
  const totalEnergy = power.reduce((s, v) => s + v, 0)
  if (totalEnergy === 0) return 0

  // Look at radial power distribution (frequency rings)
  // Periodic artifacts show as sharp spikes in specific frequency bands
  const RINGS   = 16
  const ringEnergy = new Float64Array(RINGS)
  const ringCount  = new Float64Array(RINGS)
  const maxRadius  = Math.min(cx, cy)

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const dx = x - cx, dy = y - cy
      const r  = Math.sqrt(dx * dx + dy * dy)
      const ri = Math.floor((r / maxRadius) * RINGS)
      if (ri < RINGS) {
        ringEnergy[ri] += power[y * pw + x]
        ringCount[ri]++
      }
    }
  }

  // Normalise ring energies
  const ringNorm = new Float64Array(RINGS)
  for (let i = 0; i < RINGS; i++) {
    ringNorm[i] = ringCount[i] > 0 ? ringEnergy[i] / ringCount[i] : 0
  }

  // Detect periodic spikes: a ring with energy > 3× its neighbours is suspicious
  let peakCount = 0
  for (let i = 1; i < RINGS - 1; i++) {
    const neighbours = (ringNorm[i - 1] + ringNorm[i + 1]) / 2
    if (neighbours > 0 && ringNorm[i] > neighbours * 3) peakCount++
  }

  // Also check for DC spike concentration (very low frequency content dominant)
  // In spliced images, sharp boundaries create energy at many frequencies
  const dcRatio = ringCount[0] > 0 ? ringEnergy[0] / totalEnergy : 0
  const highFreqRatio = ringCount.slice(RINGS >> 1).reduce((s, _, i) =>
    s + ringEnergy[(RINGS >> 1) + i], 0) / totalEnergy

  // Score: peaks + high frequency anomalies
  const peakScore = Math.min(60, peakCount * 20)
  const hfScore   = Math.min(40, Math.round(highFreqRatio * 80))

  return Math.min(100, peakScore + hfScore)
}

// ── Haar Wavelet Analysis ──────────────────────────────────────────────────────

/** In-place 1D Haar DWT */
function haar1d(a: Float64Array): void {
  const n = a.length
  const tmp = new Float64Array(n)
  for (let i = 0; i < n >> 1; i++) {
    tmp[i]           = (a[2 * i] + a[2 * i + 1]) / Math.SQRT2
    tmp[(n >> 1) + i] = (a[2 * i] - a[2 * i + 1]) / Math.SQRT2
  }
  a.set(tmp)
}

/** In-place 2D Haar DWT (1 level) */
function haar2d(data: Float64Array, w: number, h: number): void {
  // Row-wise
  const row = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    row.set(data.subarray(y * w, (y + 1) * w))
    haar1d(row)
    data.set(row, y * w)
  }
  // Column-wise
  const col = new Float64Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = data[y * w + x]
    haar1d(col)
    for (let y = 0; y < h; y++) data[y * w + x] = col[y]
  }
}

/**
 * Analyse HH (diagonal detail) subband energy across 4×4 regions.
 * Authentic images: moderate spatial variation (texture depends on content).
 * Spliced images: sharp discontinuities in HH energy at splice boundaries.
 * AI/Canva renders: suspiciously uniform HH energy (no camera noise).
 */
function analyzeWavelets(lum: Float64Array, pw: number, ph: number): number {
  const data = new Float64Array(lum)
  haar2d(data, pw, ph)

  // HH subband = bottom-right quadrant of one-level DWT
  const GRID   = 4
  const hhW    = pw >> 1, hhH = ph >> 1
  const regionW = Math.floor(hhW / GRID)
  const regionH = Math.floor(hhH / GRID)

  const energies: number[] = []
  for (let ry = 0; ry < GRID; ry++) {
    for (let rx = 0; rx < GRID; rx++) {
      let e = 0, cnt = 0
      const startY = hhH + ry * regionH
      const startX = hhW + rx * regionW
      for (let y = startY; y < Math.min(startY + regionH, ph); y++) {
        for (let x = startX; x < Math.min(startX + regionW, pw); x++) {
          const v = data[y * pw + x]
          e += v * v; cnt++
        }
      }
      if (cnt > 0) energies.push(e / cnt)
    }
  }

  if (energies.length < 2) return 0

  const mean = energies.reduce((s, v) => s + v, 0) / energies.length
  const std  = Math.sqrt(energies.reduce((s, v) => s + (v - mean) ** 2, 0) / energies.length)
  const cv   = mean > 0 ? std / mean : 0

  // Very low CV (< 0.2) → unnaturally uniform → AI/render signal
  // Very high CV (> 2.0) → discontinuous → potential splice
  let score = 0
  if (cv < 0.2) score = Math.round((0.2 - cv) / 0.2 * 60)          // AI/render
  else if (cv > 1.5) score = Math.round(Math.min(1, (cv - 1.5) / 1.5) * 40) // splice

  return Math.min(100, score)
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runFrequencyAnalysis(imageBase64: string): Promise<FrequencyResult> {
  const t0 = Date.now()

  try {
    // Strip data URL prefix
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buf = Buffer.from(b64, 'base64')

    // Use sharp to get raw luminance pixels at a working resolution
    const MAX_DIM = 256   // FFT is O(n log n); 256px is sufficient for spectral analysis
    const { data, info } = await sharp(buf)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { width: w, height: h } = info

    // Normalise to 0–1
    const lum64 = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) lum64[i] = data[i] / 255

    // Pad to power-of-two for FFT
    const pw = nextPow2(w), ph = nextPow2(h)
    const lumPadded = padLum(lum64, w, h, pw, ph)

    // FFT spectral analysis
    const power           = fft2d(lumPadded, pw, ph)
    const spectralAnomalyScore = analyzeSpectrum(power, pw, ph)

    // Wavelet analysis (fresh copy, in-place modification)
    const waveletScore    = analyzeWavelets(lumPadded.slice(), pw, ph)

    // Combined score (weighted average)
    const score = Math.round(spectralAnomalyScore * 0.55 + waveletScore * 0.45)

    return { spectralAnomalyScore, waveletScore, score, analysisMs: Date.now() - t0 }
  } catch (err: unknown) {
    console.error('[frequencyAnalysis] error:', (err as Error).message)
    return { spectralAnomalyScore: 0, waveletScore: 0, score: 0, analysisMs: Date.now() - t0 }
  }
}
