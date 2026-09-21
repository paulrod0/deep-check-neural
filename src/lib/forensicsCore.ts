/**
 * forensicsCore.ts — Deep-Check Veritas Engine v3
 *
 * Low-level signal-processing primitives used by the forensics pipeline.
 * Pure TypeScript — no external dependencies, no DOM APIs.
 * All heavy operations use typed arrays (Float32Array) for cache efficiency.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Stats {
  mean:     number
  variance: number
  std:      number
  min:      number
  max:      number
  skewness: number  // third standardised moment
  kurtosis: number  // excess kurtosis (4th moment − 3)
}

export interface GradientMap {
  magnitude: Float32Array   // √(gx²+gy²) per pixel
  direction: Float32Array   // atan2(gy,gx) in [−π, π]
}

// ── Colour conversions ────────────────────────────────────────────────────────

/** RGBA Uint8ClampedArray → float32 luminance [0,1] (ITU-R BT.709) */
export function toLuminance(rgba: Uint8ClampedArray, n: number): Float32Array {
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i << 2
    lum[i] = (rgba[j] * 0.2126 + rgba[j + 1] * 0.7152 + rgba[j + 2] * 0.0722) / 255
  }
  return lum
}

/** Extract single channel [0,1] from RGBA (ch: 0=R 1=G 2=B) */
export function extractChannel(rgba: Uint8ClampedArray, n: number, ch: 0|1|2): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rgba[(i << 2) + ch] / 255
  return out
}

/** RGBA → per-pixel HSV saturation [0,1] */
export function saturationMap(rgba: Uint8ClampedArray, n: number): Float32Array {
  const sat = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j  = i << 2
    const r  = rgba[j] / 255, g = rgba[j + 1] / 255, b = rgba[j + 2] / 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    sat[i]   = mx < 1e-6 ? 0 : (mx - mn) / mx
  }
  return sat
}

// ── Statistics ────────────────────────────────────────────────────────────────

export function computeStats(a: Float32Array | number[]): Stats {
  const n = a.length
  if (n === 0) return { mean: 0, variance: 0, std: 0, min: 0, max: 0, skewness: 0, kurtosis: 0 }

  let sum = 0, mn = Infinity, mx = -Infinity
  for (let i = 0; i < n; i++) {
    sum += a[i]
    if (a[i] < mn) mn = a[i]
    if (a[i] > mx) mx = a[i]
  }
  const mean = sum / n

  let m2 = 0, m3 = 0, m4 = 0
  for (let i = 0; i < n; i++) {
    const d = a[i] - mean
    const d2 = d * d
    m2 += d2
    m3 += d2 * d
    m4 += d2 * d2
  }
  m2 /= n; m3 /= n; m4 /= n

  const variance = m2
  const std      = Math.sqrt(variance)
  const skewness = std > 1e-10 ? m3 / (std * std * std) : 0
  const kurtosis = std > 1e-10 ? m4 / (variance * variance) - 3 : 0

  return { mean, variance, std, min: mn, max: mx, skewness, kurtosis }
}

/** Pearson correlation coefficient between two same-length arrays */
export function pearsonR(a: Float32Array, b: Float32Array): number {
  const n = a.length
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n

  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    cov += da * db; va += da * da; vb += db * db
  }
  const denom = Math.sqrt(va * vb)
  return denom < 1e-10 ? 0 : cov / denom
}

/** Shannon entropy of a normalised probability array */
export function entropy(hist: Float32Array | number[]): number {
  let h = 0
  for (const p of hist) if (p > 1e-12) h -= p * Math.log2(p)
  return h
}

/** Coefficient of variation σ/|μ| (robust to zero mean) */
export function coefficientOfVariation(a: Float32Array | number[]): number {
  const s = computeStats(a)
  return Math.abs(s.mean) < 1e-10 ? (s.std > 0 ? 999 : 0) : s.std / Math.abs(s.mean)
}

// ── Filters ───────────────────────────────────────────────────────────────────

/**
 * Fast separable box blur (approximates Gaussian for large r).
 * O(n) time regardless of radius r.
 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const dst = new Float32Array(w * h)
  const inv = 1 / (2 * r + 1)

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x]
    // Extend left border by replication
    sum += src[row] * Math.max(0, r - 0)
    tmp[row] = sum * inv
    for (let x = 1; x < w; x++) {
      sum += src[row + Math.min(x + r, w - 1)] - src[row + Math.max(x - r - 1, 0)]
      tmp[row + x] = sum * inv
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x]
    sum += tmp[x] * Math.max(0, r - 0)
    dst[x] = sum * inv
    for (let y = 1; y < h; y++) {
      sum += tmp[Math.min(y + r, h - 1) * w + x] - tmp[Math.max(y - r - 1, 0) * w + x]
      dst[y * w + x] = sum * inv
    }
  }
  return dst
}

/**
 * Gaussian denoising via 3-pass box blur (σ ≈ r * √(1/3)).
 * Produces near-Gaussian results while staying O(n).
 */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  // Approximate with 3 box blurs of radius r where r ≈ σ*√3
  const r = Math.max(1, Math.round(sigma * 1.73))
  let out = boxBlur(src, w, h, r)
  out = boxBlur(out, w, h, r)
  out = boxBlur(out, w, h, r)
  return out
}

// ── Gradient (Sobel) ──────────────────────────────────────────────────────────

/**
 * Sobel gradient on float luminance [0,1].
 * Border pixels are left at zero.
 */
export function sobelGradient(lum: Float32Array, w: number, h: number): GradientMap {
  const magnitude = new Float32Array(w * h)
  const direction = new Float32Array(w * h)

  for (let y = 1; y < h - 1; y++) {
    const yn = (y - 1) * w, yc = y * w, yp = (y + 1) * w
    for (let x = 1; x < w - 1; x++) {
      const tl = lum[yn + x - 1], tc = lum[yn + x], tr = lum[yn + x + 1]
      const ml = lum[yc + x - 1],                   mr = lum[yc + x + 1]
      const bl = lum[yp + x - 1], bc = lum[yp + x], br = lum[yp + x + 1]

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br

      const i = yc + x
      magnitude[i] = Math.sqrt(gx * gx + gy * gy)
      direction[i] = Math.atan2(gy, gx)
    }
  }
  return { magnitude, direction }
}

// ── 8×8 DCT ──────────────────────────────────────────────────────────────────

/** Normalised Type-II DCT basis matrix (precomputed once) */
const _DCT_BASIS = (() => {
  const C = new Float32Array(64)
  const k = Math.PI / 16
  for (let u = 0; u < 8; u++) {
    const alpha = u === 0 ? 1 / Math.sqrt(8) : Math.sqrt(2 / 8)
    for (let x = 0; x < 8; x++) C[u * 8 + x] = alpha * Math.cos(k * u * (2 * x + 1))
  }
  return C
})()

/**
 * 2-D 8×8 Type-II DCT of a 64-element float block.
 * Returns a new 64-element array of coefficients.
 */
export function dct8x8(block: Float32Array): Float32Array {
  const tmp = new Float32Array(64)
  const out = new Float32Array(64)

  // Row-wise DCT
  for (let i = 0; i < 8; i++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += block[i * 8 + x] * _DCT_BASIS[u * 8 + x]
      tmp[i * 8 + u] = s
    }
  }
  // Column-wise DCT
  for (let j = 0; j < 8; j++) {
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + j] * _DCT_BASIS[v * 8 + y]
      out[v * 8 + j] = s
    }
  }
  return out
}

// ── 1-D Haar DWT ──────────────────────────────────────────────────────────────

/** In-place 1-D Haar DWT. n must be even. */
function _haarDWT1D(a: Float32Array, n: number): void {
  const tmp = new Float32Array(n)
  const h   = n >> 1
  for (let i = 0; i < h; i++) {
    tmp[i]     = (a[2 * i] + a[2 * i + 1]) * 0.5
    tmp[h + i] = (a[2 * i] - a[2 * i + 1]) * 0.5
  }
  a.set(tmp.subarray(0, n))
}

/**
 * One-level 2-D Haar DWT on a w×h float32 image (in-place).
 * w and h must be even. After the call:
 *   [0..w/2, 0..h/2]     → LL (approximation)
 *   [w/2..w, 0..h/2]     → LH (horizontal detail)
 *   [0..w/2, h/2..h]     → HL (vertical detail)
 *   [w/2..w, h/2..h]     → HH (diagonal detail)
 */
export function haarDWT2D(data: Float32Array, w: number, h: number): void {
  const rowBuf = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    const off = y * w
    rowBuf.set(data.subarray(off, off + w))
    _haarDWT1D(rowBuf, w)
    data.set(rowBuf, off)
  }
  const colBuf = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colBuf[y] = data[y * w + x]
    _haarDWT1D(colBuf, h)
    for (let y = 0; y < h; y++) data[y * w + x] = colBuf[y]
  }
}

// ── Histogram utilities ───────────────────────────────────────────────────────

/**
 * Compute a normalised histogram of `bins` bins over values in [lo, hi].
 * Values outside the range are clamped to the nearest bin.
 */
export function histogram(
  values: Float32Array | number[],
  bins: number,
  lo: number,
  hi: number
): Float32Array {
  const hist  = new Float32Array(bins)
  const range = hi - lo
  const n     = values.length
  if (range <= 0 || n === 0) return hist

  for (let i = 0; i < n; i++) {
    const bin = Math.floor(((values[i] - lo) / range) * bins)
    hist[Math.min(Math.max(bin, 0), bins - 1)]++
  }
  for (let b = 0; b < bins; b++) hist[b] /= n
  return hist
}

/**
 * Symmetrised KL-divergence D(p‖q) + D(q‖p) (Jensen-Shannon style).
 * Epsilon guard avoids log(0).
 */
export function klDivergence(p: Float32Array, q: Float32Array): number {
  const eps = 1e-9
  let kl = 0
  for (let i = 0; i < p.length; i++) {
    const pi = p[i] + eps, qi = q[i] + eps
    kl += pi * Math.log(pi / qi) + qi * Math.log(qi / pi)
  }
  return kl * 0.5
}

// ── Bayesian log-likelihood ratio ─────────────────────────────────────────────

/**
 * Gaussian log-likelihood ratio (LLR) of a scalar observation s.
 *
 *   LLR(s) = log P(s | manipulated) − log P(s | authentic)
 *           = −(s−μ_m)²/(2σ_m²) + log σ_a
 *             +(s−μ_a)²/(2σ_a²) − log σ_m
 *
 * Positive LLR → evidence for manipulation.
 * Negative LLR → evidence for authenticity.
 *
 * @param s    Observed score in [0, 100]
 * @param μa   Expected mean when authentic
 * @param σa   Expected std when authentic
 * @param μm   Expected mean when manipulated
 * @param σm   Expected std when manipulated
 */
export function gaussianLLR(
  s:  number,
  μa: number, σa: number,
  μm: number, σm: number,
): number {
  const da = (s - μa) / σa
  const dm = (s - μm) / σm
  return -0.5 * dm * dm + Math.log(σa) + 0.5 * da * da - Math.log(σm)
}

/**
 * Bayesian posterior probability of manipulation given a total LLR.
 *
 *   P(manip | evidence) = σ(log_prior + LLR_total)
 *
 * Base rate: assume 5 % of submitted images are manipulated.
 */
const LOG_PRIOR = Math.log(0.05 / 0.95) // ≈ −2.944

export function bayesianPosterior(totalLLR: number): number {
  const logOdds = LOG_PRIOR + totalLLR
  return 1 / (1 + Math.exp(-logOdds))
}

// ── Math utilities ────────────────────────────────────────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x }
export function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)) }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
