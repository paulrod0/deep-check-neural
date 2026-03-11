/**
 * imageForensics.ts — Deep-Check Veritas Engine v3
 *
 * Complete rewrite of the image forensics pipeline.
 *
 * Architecture
 * ────────────
 * Stage 1 · Preprocessing   — normalise to working resolution, extract raw pixels
 * Stage 2 · Signal extraction (6 independent forensic signals)
 *   S1  Multi-Quality ELA   — compression-history curve analysis (5 JPEG qualities)
 *   S2  DCT Statistics      — double-JPEG detection via coefficient periodicity
 *   S3  Noise Residual      — PRNU-proxy: inter-region correlation of denoising residual
 *   S4  Edge Statistics     — Sobel regional analysis, direction KL-divergence
 *   S5  EXIF Forensics      — metadata anomaly detection (enhanced)
 *   S6  Chroma Analysis     — RGB correlation, kurtosis, saturation entropy
 * Stage 3 · False-positive prevention
 *   • PNG / screenshot exemptions
 *   • JPEG quality normalisation for ELA
 *   • Signal-agreement veto (≥2 signals must exceed threshold)
 * Stage 4 · Bayesian combination (Veritas combiner)
 *   • Log-likelihood ratio per signal (Gaussian model)
 *   • Conservative prior: P(manipulated) = 0.05
 *   • Posterior → risk score 0–100
 * Stage 5 · Verdict & alerts
 *
 * All analysis runs client-side (Canvas API only — no WASM, no server).
 * Working resolution: max 512 px on the longest side for performance.
 */

import {
  toLuminance, extractChannel, saturationMap,
  computeStats, pearsonR, entropy, coefficientOfVariation,
  boxBlur, gaussianBlur, sobelGradient,
  dct8x8, haarDWT2D,
  histogram, klDivergence,
  gaussianLLR, bayesianPosterior,
  clamp, clamp01,
} from './forensicsCore'

// ── Public types (backward-compatible API surface) ────────────────────────────

export type RiskLevel = 'clean' | 'suspicious' | 'high_risk'

export interface ForensicAlert {
  code:     string
  label:    string
  detail:   string
  severity: 'low' | 'medium' | 'high'
  module:   'ela' | 'exif' | 'noise' | 'dct' | 'edge' | 'chroma' | 'meta'
}

export interface ELAResult {
  score:             number   // 0–100 (higher → more manipulation evidence)
  heatmapDataUrl:    string
  maxDiff:           number
  meanDiff:          number
  suspiciousRegions: number
  // v3 additions (optional for backward compatibility)
  curveMonotonicity?: number   // 0–1 (1 = perfectly monotonic = authentic)
  highQualityResidue?: number  // ELA at q=92 (near 0 for authentic)
  aiSignature?:       boolean  // curve is flat AND near-zero (AI-generated)
}

export interface EXIFResult {
  score:                  number
  raw:                    Record<string, unknown>
  flags:                  string[]
  software?:              string
  dateTime?:              string
  gpsPresent:             boolean
  editSoftwareDetected:   boolean
  dateTimeInconsistency:  boolean
  // v3 additions (optional for backward compatibility)
  isSuspectedScreenshot?:  boolean
  estimatedJpegQuality?:   number    // 0 = unknown, 1–100 = estimated
}

export interface NoiseResult {
  score:              number   // 0–100 (higher → AI/synthetic)
  laplacianVariance:  number
  uniformityScore:    number   // 0–1 (high = uniform = AI)
  blockVarianceStd:   number
  // v3 additions (optional for backward compatibility)
  residualCorrelation?: number  // mean inter-region correlation (PRNU proxy)
  waveletConsistency?:  number  // 0–1 (high = consistent = authentic)
}

export interface ForensicsReport {
  elaScore:   number
  exifScore:  number
  noiseScore: number
  riskScore:  number
  riskLevel:  RiskLevel
  ela:        ELAResult
  exif:       EXIFResult
  noise:      NoiseResult
  alerts:     ForensicAlert[]
  thumbnail:  string
  analysisMs: number
  // v3 signal breakdown (optional for backward compatibility)
  dctScore?:           number
  edgeScore?:          number
  chromaScore?:        number
  manipulationProb?:   number   // 0–1 Bayesian posterior
  confidenceLevel?:    number   // 0–1 (how many signals agreed)
  signalsAboveThresh?: number   // count of signals flagging manipulation
  docPixelScore?:      number   // S7 — document pixel analysis (0–100, high = synthetic/vector)
}

// ── Internal types ────────────────────────────────────────────────────────────

interface WorkingImage {
  rgba: Uint8ClampedArray
  lum:  Float32Array
  w:    number
  h:    number
  canvas: HTMLCanvasElement
  img:    HTMLImageElement
  aspectRatio: number
  isPng:  boolean
  isJpeg: boolean
}

interface MultiQualityELA {
  scores:            number[]       // ELA score at each quality level
  qualities:         number[]       // [55, 65, 75, 85, 92]
  meanScore:         number
  monotonicViolations: number       // # pairs where score increased (wrong direction)
  curveMonotonicity: number         // 0–1
  highQualityResidue: number
  aiSignature:       boolean
  heatmapDataUrl:    string
  maxDiff:           number
  meanDiff:          number
  suspiciousRegions: number
  score:             number         // final 0–100 ELA score
}

interface DCTAnalysis {
  dcGapScore:     number   // 0–100, periodicity of DC histogram → double JPEG
  acKurtosis:     number   // excess kurtosis of AC coefficients
  acVarianceCV:   number   // coefficient of variation of AC energy per block
  score:          number   // 0–100 combined
}

interface NoiseResidualAnalysis {
  residualCorrelation: number   // mean pairwise cross-correlation of residuals
  correlationVariance: number   // high → splice evidence
  waveletConsistency:  number   // 0–1 (Haar HH subband uniformity ratio)
  score:               number   // 0–100 (high → inconsistent = spliced / AI)
}

interface EdgeAnalysis {
  densityCV:    number   // coeff. of variation of edge density across regions
  directionKL:  number   // mean KL-divergence between adjacent region histograms
  score:        number   // 0–100 (high → suspicious)
}

interface ChromaAnalysis {
  rgCorrelation:  number   // Pearson R(R-channel, G-channel)
  rbCorrelation:  number
  gbCorrelation:  number
  avgCorrelation: number
  satEntropy:     number   // Shannon entropy of saturation histogram
  channelKurt:    number   // mean excess kurtosis across R,G,B
  score:          number   // 0–100 (high → AI / synthetic)
}

interface DocPixelAnalysis {
  noiseFloorScore:   number   // Canva export σ≈0 vs scan σ≈5-15 → high score = vector/synthetic
  edgeSharpScore:    number   // 1px-sharp edges (vector) vs 3-5px natural edges
  bimodalScore:      number   // tight bimodal (vector) vs broad (scan)
  score:             number   // 0–100 combined (high = document looks synthetic/vector-generated)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DIM          = 512    // resize longest side to this for analysis
const ELA_QUALITIES    = [55, 65, 75, 85, 92]
const DCT_BLOCK        = 8
const REGION_GRID      = 4      // 4×4 grid for regional analysis
const BLUR_SIGMA       = 2.5    // Gaussian σ for noise residual
const EDIT_SOFTWARE_PATTERNS = [
  'photoshop', 'lightroom', 'gimp', 'affinity photo', 'affinity',
  'paint.net', 'canva', 'pixlr', 'snapseed', 'facetune', 'meitu',
  'stable diffusion', 'midjourney', 'dall-e', 'firefly', 'adobe firefly',
  'runway', 'imagen', 'bing image creator', 'nightcafe', 'artbreeder',
  'fotor', 'luminar', 'capture one', 'darktable', 'rawtherapee',
  'illustrator', 'inkscape', 'corel', 'paintshop',
]

// ── Helper: load image from src string ───────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img  = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src    = src
  })
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader()
    reader.onload  = e => resolve(e.target!.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Stage 1: Preprocessing ────────────────────────────────────────────────────

/**
 * Resize the image to MAX_DIM × MAX_DIM (preserving aspect ratio),
 * extract RGBA pixels and luminance, and return a WorkingImage bundle.
 */
async function prepareWorkingImage(
  img: HTMLImageElement,
  file: File,
): Promise<WorkingImage> {
  const isPng  = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
  const isJpeg = file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name)

  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
  const w     = Math.max(1, Math.round(img.naturalWidth  * scale))
  const h     = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data as Uint8ClampedArray
  const lum  = toLuminance(rgba, w * h)

  return { rgba, lum, w, h, canvas, img, aspectRatio: w / h, isPng, isJpeg }
}

// ── Stage 2·S1: Multi-Quality ELA ─────────────────────────────────────────────

/**
 * Compress the working canvas at 5 JPEG quality levels.
 * For each quality q:
 *   1. Get JPEG data URL at q%
 *   2. Load back into a canvas
 *   3. Compute mean absolute per-pixel luminance difference with original
 *
 * Curve analysis:
 *   Authentic images: ELA score decreases (roughly monotonically) as q increases
 *     toward the image's original quality.
 *   AI-generated images: curve is flat and near-zero at ALL qualities (never JPEG-compressed).
 *   Manipulated images: curve shows violations of monotonicity in regions with
 *     different compression history.
 */
async function runMultiQualityELA(wi: WorkingImage): Promise<MultiQualityELA> {
  const { canvas, w, h } = wi

  // --- Draw original at working resolution ---
  const ctx0 = canvas.getContext('2d', { willReadFrequently: true })!
  ctx0.drawImage(wi.img, 0, 0, w, h)
  const origData = ctx0.getImageData(0, 0, w, h).data

  // Accumulate best (highest-quality) ELA for heatmap
  let bestHeatmap: Uint8ClampedArray | null = null
  const scores: number[] = []

  for (const q of ELA_QUALITIES) {
    const jpegUrl    = canvas.toDataURL('image/jpeg', q / 100)
    const recompImg  = await loadImage(jpegUrl)
    const rc         = document.createElement('canvas')
    rc.width = w; rc.height = h
    const rctx = rc.getContext('2d', { willReadFrequently: true })!
    rctx.drawImage(recompImg, 0, 0, w, h)
    const recompData = rctx.getImageData(0, 0, w, h).data

    // Compute per-pixel luminance difference
    const AMPLIFY = 15
    let total = 0, maxB = 0
    const elaData = new Uint8ClampedArray(w * h * 4)

    for (let i = 0; i < origData.length; i += 4) {
      const dr = Math.abs(origData[i]   - recompData[i])   * AMPLIFY
      const dg = Math.abs(origData[i+1] - recompData[i+1]) * AMPLIFY
      const db = Math.abs(origData[i+2] - recompData[i+2]) * AMPLIFY
      const r  = Math.min(dr, 255), g = Math.min(dg, 255), b = Math.min(db, 255)
      const br = (r + g + b) / 3
      elaData[i] = r; elaData[i+1] = g; elaData[i+2] = b; elaData[i+3] = 255
      total += br
      if (br > maxB) maxB = br
    }

    const meanDiff = total / (w * h)

    // Count suspicious 8×8 blocks
    const BLK = 8, THRESH = 35
    let suspicious = 0, totalBlocks = 0
    for (let by = 0; by < h; by += BLK) {
      for (let bx = 0; bx < w; bx += BLK) {
        let bSum = 0, bCnt = 0
        for (let y = by; y < Math.min(by + BLK, h); y++) {
          for (let x = bx; x < Math.min(bx + BLK, w); x++) {
            const idx = (y * w + x) << 2
            bSum += (elaData[idx] + elaData[idx+1] + elaData[idx+2]) / 3
            bCnt++
          }
        }
        if (bCnt > 0 && bSum / bCnt > THRESH) suspicious++
        totalBlocks++
      }
    }

    const suspRatio = totalBlocks > 0 ? suspicious / totalBlocks : 0
    const rawScore  = (meanDiff / 255) * 55 + suspRatio * 45
    scores.push(clamp(rawScore * 100, 0, 100))

    // Keep heatmap from q=75 (most diagnostic quality)
    if (q === 75 && !bestHeatmap) {
      const tmp = rc.getContext('2d')!
      const id  = tmp.createImageData(w, h)
      id.data.set(elaData)
      tmp.putImageData(id, 0, 0)
      bestHeatmap = elaData
    }
  }

  // --- Render heatmap ---
  const hmCanvas  = document.createElement('canvas')
  hmCanvas.width  = w; hmCanvas.height = h
  const hmCtx     = hmCanvas.getContext('2d')!
  if (bestHeatmap) {
    const id = hmCtx.createImageData(w, h)
    id.data.set(bestHeatmap)
    hmCtx.putImageData(id, 0, 0)
  }
  const heatmapDataUrl = hmCanvas.toDataURL('image/jpeg', 0.85)

  // --- Curve analysis ---
  // Monotonicity: in a well-compressed authentic image, ELA should
  // decrease (or stay flat) as quality increases from low to high.
  // A violation is when score[i] > score[i-1] by a significant margin.
  let violations = 0
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[i - 1] + 3) violations++   // tolerance of 3 points
  }
  const curveMonotonicity = clamp01(1 - violations / (scores.length - 1))

  const meanScore         = scores.reduce((a, b) => a + b, 0) / scores.length
  const highQualityResidue = scores[scores.length - 1]   // at q=92

  // AI signature: all scores are very low (never compressed → no JPEG history)
  // Threshold: mean < 6 AND max < 12
  const maxScore   = Math.max(...scores)
  const aiSignature = meanScore < 6 && maxScore < 12

  // Final ELA score:
  //   - Monotonicity violation raises score (manipulation evidence)
  //   - Very high mean score raises it
  //   - Flat near-zero curve raises it (AI signature)
  const monotonPenalty  = (1 - curveMonotonicity) * 30
  const residuePenalty  = Math.max(0, highQualityResidue - 5) * 1.2
  const aiBoost         = aiSignature ? 20 : 0
  const score           = clamp(Math.round(meanScore * 0.60 + monotonPenalty + residuePenalty * 0.20 + aiBoost), 0, 100)

  return {
    scores, qualities: ELA_QUALITIES, meanScore, monotonicViolations: violations,
    curveMonotonicity, highQualityResidue, aiSignature, heatmapDataUrl,
    maxDiff: maxScore, meanDiff: meanScore, suspiciousRegions: 0,
    score,
  }
}

// ── Stage 2·S2: DCT Block Statistics ─────────────────────────────────────────

/**
 * Analyse 8×8 DCT blocks of the luminance channel.
 *
 * Double-JPEG indicator (DJPEG):
 *   When a JPEG is compressed a second time with a different quality table,
 *   the quantisation process creates a characteristic periodic pattern in
 *   the histogram of DC coefficients (gaps at multiples of ~8 bins).
 *   We measure this periodicity as a manipulation signal.
 *
 * AC coefficient statistics:
 *   Real photographs: AC coefficients follow a generalised Laplacian distribution
 *   with moderate variance.
 *   AI-generated images often have suspiciously low AC variance (too smooth).
 */
function runDCTAnalysis(wi: WorkingImage): DCTAnalysis {
  const { lum, w, h } = wi
  const block = new Float32Array(64)
  const dcCoeffs: number[] = []
  const acVariances: number[] = []

  for (let by = 0; by + DCT_BLOCK <= h; by += DCT_BLOCK) {
    for (let bx = 0; bx + DCT_BLOCK <= w; bx += DCT_BLOCK) {
      // Extract 8×8 block (mean-centred)
      let blockMean = 0
      for (let y = 0; y < DCT_BLOCK; y++) {
        for (let x = 0; x < DCT_BLOCK; x++) {
          block[y * DCT_BLOCK + x] = lum[(by + y) * w + (bx + x)]
          blockMean += block[y * DCT_BLOCK + x]
        }
      }
      blockMean /= 64
      for (let i = 0; i < 64; i++) block[i] -= blockMean

      const dct  = dct8x8(block)
      const dc   = dct[0]
      dcCoeffs.push(dc)

      // AC energy (sum of squared AC coefficients)
      let acE = 0
      for (let i = 1; i < 64; i++) acE += dct[i] * dct[i]
      acVariances.push(acE / 63)
    }
  }

  if (dcCoeffs.length < 4) return { dcGapScore: 0, acKurtosis: 0, acVarianceCV: 0, score: 0 }

  // DC histogram periodicity (double-JPEG detection)
  const dcArr   = new Float32Array(dcCoeffs)
  const dcStats = computeStats(dcArr)
  const dcHist  = histogram(dcArr, 64, dcStats.min, dcStats.max)

  // Look for periodic gaps in the DC histogram (step size ~8 bins)
  // A gap is a bin with value significantly lower than its neighbours
  let periodicity = 0
  const stepSize  = 8
  for (let i = stepSize; i < dcHist.length - stepSize; i += stepSize) {
    const left  = (dcHist[i - 1] + dcHist[i - 2]) / 2
    const right = (dcHist[i + 1] + dcHist[i + 2]) / 2
    const gap   = ((left + right) / 2) - dcHist[i]
    if (gap > 0.005) periodicity += gap * 200  // amplify small gaps
  }
  const dcGapScore = clamp(Math.round(periodicity), 0, 100)

  // AC statistics
  const acArr  = new Float32Array(acVariances)
  const acStat = computeStats(acArr)
  const acCV   = acStat.mean > 0 ? acStat.std / acStat.mean : 0

  // Very low AC variance CV is suspicious (too uniform → AI)
  const acVarianceCV = acCV

  // AC kurtosis: high positive kurtosis is normal for natural images
  //              low or negative kurtosis may indicate AI
  const acKurtosis = acStat.kurtosis

  // Combined DCT score
  const dcGapWeight  = 0.55
  const acFlatWeight = 0.45
  // Low AC CV (< 0.4) is suspicious; natural images have CV ~ 0.8–1.5
  const acFlatScore  = clamp(Math.round(Math.max(0, 0.6 - acCV) * 100 / 0.6), 0, 60)
  const score        = clamp(Math.round(dcGapScore * dcGapWeight + acFlatScore * acFlatWeight), 0, 100)

  return { dcGapScore, acKurtosis, acVarianceCV, score }
}

// ── Stage 2·S3: Noise Residual Consistency (PRNU proxy) ──────────────────────

/**
 * Real cameras produce a fixed-pattern noise signature (PRNU — Photo Response
 * Non-Uniformity) superimposed on shot noise.  The denoising residual
 * (original − Gaussian_blur) captures this noise floor.
 *
 * For authentic images from a single camera, residuals in different regions
 * are moderately positively correlated (same sensor fingerprint).
 *
 * For AI-generated images, residuals have zero or negative correlation
 * (independent random noise per region).
 *
 * For spliced images, correlation is inconsistently distributed: some region
 * pairs correlate (same source) while others do not (different sources).
 *
 * Additionally, Haar HH (diagonal) wavelet detail coefficients are analysed:
 * authentic images have consistent HH magnitude across the image; AI images
 * tend to have unusually uniform or zero HH bands.
 */
function runNoiseResidualAnalysis(wi: WorkingImage): NoiseResidualAnalysis {
  const { lum, w, h } = wi

  // Gaussian denoised residual
  const blurred  = gaussianBlur(lum, w, h, BLUR_SIGMA)
  const residual = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) residual[i] = lum[i] - blurred[i]

  // Divide into REGION_GRID × REGION_GRID quadrants
  const rw   = Math.floor(w / REGION_GRID)
  const rh   = Math.floor(h / REGION_GRID)
  const regions: Float32Array[] = []

  for (let ry = 0; ry < REGION_GRID; ry++) {
    for (let rx = 0; rx < REGION_GRID; rx++) {
      const startY = ry * rh, endY = Math.min((ry + 1) * rh, h)
      const startX = rx * rw, endX = Math.min((rx + 1) * rw, w)
      const pixels: number[] = []
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) pixels.push(residual[y * w + x])
      }
      regions.push(new Float32Array(pixels))
    }
  }

  // Compute pairwise Pearson correlation between horizontally adjacent regions
  const correlations: number[] = []
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const minLen  = Math.min(regions[i].length, regions[j].length)
      const a       = regions[i].subarray(0, minLen)
      const b       = regions[j].subarray(0, minLen)
      if (minLen > 10) correlations.push(pearsonR(a, b))
    }
  }

  if (correlations.length === 0) {
    return { residualCorrelation: 0, correlationVariance: 0, waveletConsistency: 0.5, score: 0 }
  }

  const corrArr  = new Float32Array(correlations)
  const corrStat = computeStats(corrArr)

  // residualCorrelation: authentic ~ 0.1–0.4, AI ~ -0.05–0.05, spliced: high variance
  const residualCorrelation = corrStat.mean
  const correlationVariance = corrStat.variance

  // Haar wavelet HH subband consistency
  // Resize lum to next power-of-two dimensions for clean wavelet
  const pw = nextPowerOfTwo(w), ph = nextPowerOfTwo(h)
  const lumPadded = padToPowerOfTwo(lum, w, h, pw, ph)
  haarDWT2D(lumPadded, pw, ph)

  // Extract HH subband (bottom-right quadrant)
  const hhEnergies: number[] = []
  const regionW = Math.floor(pw / 2 / REGION_GRID)
  const regionH = Math.floor(ph / 2 / REGION_GRID)
  for (let ry = 0; ry < REGION_GRID; ry++) {
    for (let rx = 0; rx < REGION_GRID; rx++) {
      let energy = 0, cnt = 0
      const startY = ph / 2 + ry * regionH
      const startX = pw / 2 + rx * regionW
      for (let y = startY; y < Math.min(startY + regionH, ph); y++) {
        for (let x = startX; x < Math.min(startX + regionW, pw); x++) {
          const v = lumPadded[y * pw + x]
          energy += v * v; cnt++
        }
      }
      if (cnt > 0) hhEnergies.push(energy / cnt)
    }
  }

  const hhCV     = hhEnergies.length > 1 ? coefficientOfVariation(hhEnergies) : 0.5
  // Low CV → wavelet is very uniform → AI signature (value near 1 = authentic)
  // Natural images have moderate spatial variation in HH energy
  const waveletConsistency = clamp01(Math.min(1, hhCV / 0.6))

  // Score:
  //   Low residual correlation (< 0.05) → AI-like → raise score
  //   High correlation variance (> 0.04) → possible splicing → raise score
  //   Low wavelet consistency (< 0.3) → AI → raise score
  const aiSignalScore     = clamp(Math.round(Math.max(0, 0.10 - residualCorrelation) * 500), 0, 40)
  const spliceSignalScore = clamp(Math.round(correlationVariance * 1500), 0, 40)
  const waveletScore      = clamp(Math.round((1 - waveletConsistency) * 35), 0, 35)
  const score             = clamp(aiSignalScore + spliceSignalScore + waveletScore, 0, 100)

  return { residualCorrelation, correlationVariance, waveletConsistency, score }
}

// Power-of-two helpers for wavelet
function nextPowerOfTwo(n: number): number {
  let p = 1; while (p < n) p <<= 1; return p
}
function padToPowerOfTwo(src: Float32Array, w: number, h: number, pw: number, ph: number): Float32Array {
  const out = new Float32Array(pw * ph)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * pw + x] = src[y * w + x]
    // Replicate last column
    for (let x = w; x < pw; x++) out[y * pw + x] = src[y * w + w - 1]
  }
  // Replicate last row
  for (let y = h; y < ph; y++) {
    for (let x = 0; x < pw; x++) out[y * pw + x] = out[(h - 1) * pw + x]
  }
  return out
}

// ── Stage 2·S4: Edge Statistics ───────────────────────────────────────────────

/**
 * Authentic natural images follow well-known natural image statistics:
 *   - Edge density varies across regions (different scene content)
 *   - Gradient directions tend to cluster (structures, horizons, faces)
 *   - Adjacent regions have correlated gradient direction distributions
 *
 * Spliced images exhibit discontinuities:
 *   - Sharp change in edge density at splice boundaries
 *   - High KL-divergence between adjacent region direction histograms
 *
 * AI-generated images often show:
 *   - Suspiciously uniform edge density across regions
 *   - Overly smooth gradients (unnaturally consistent direction histograms)
 */
function runEdgeAnalysis(wi: WorkingImage): EdgeAnalysis {
  const { lum, w, h } = wi
  const grad = sobelGradient(lum, w, h)

  const rw  = Math.floor(w / REGION_GRID)
  const rh  = Math.floor(h / REGION_GRID)

  const densities:  number[] = []
  const dirHistograms: Float32Array[] = []

  for (let ry = 0; ry < REGION_GRID; ry++) {
    for (let rx = 0; rx < REGION_GRID; rx++) {
      const startY = ry * rh, endY = Math.min((ry + 1) * rh, h)
      const startX = rx * rw, endX = Math.min((rx + 1) * rw, w)

      const magnitudes: number[] = []
      const directions: number[] = []

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = y * w + x
          magnitudes.push(grad.magnitude[i])
          if (grad.magnitude[i] > 0.05) directions.push(grad.direction[i])
        }
      }

      // Edge density: fraction of pixels with significant gradient
      const strongEdges = magnitudes.filter(m => m > 0.08).length
      densities.push(magnitudes.length > 0 ? strongEdges / magnitudes.length : 0)

      // Direction histogram (16 bins over [−π, π])
      const dirArr = new Float32Array(directions)
      dirHistograms.push(
        directions.length > 5
          ? histogram(dirArr, 16, -Math.PI, Math.PI)
          : new Float32Array(16).fill(1 / 16)
      )
    }
  }

  // Edge density coefficient of variation
  const densityCV = coefficientOfVariation(densities)

  // Mean KL-divergence between adjacent-region direction histograms
  const klValues: number[] = []
  for (let ry = 0; ry < REGION_GRID; ry++) {
    for (let rx = 0; rx < REGION_GRID; rx++) {
      const i = ry * REGION_GRID + rx
      // Right neighbour
      if (rx + 1 < REGION_GRID) klValues.push(klDivergence(dirHistograms[i], dirHistograms[i + 1]))
      // Bottom neighbour
      if (ry + 1 < REGION_GRID) klValues.push(klDivergence(dirHistograms[i], dirHistograms[i + REGION_GRID]))
    }
  }

  const directionKL = klValues.length > 0 ? klValues.reduce((a, b) => a + b, 0) / klValues.length : 0

  // Score:
  //   Very high density CV (> 0.8) suggests splice → raise score
  //   Very LOW density CV (< 0.1) suggests AI uniform → raise score
  //   High KL-divergence between adjacent regions → splice → raise score
  const spliceEdgeScore = clamp(Math.round(Math.max(0, densityCV - 0.5) * 80), 0, 40)
  const aiEdgeScore     = clamp(Math.round(Math.max(0, 0.15 - densityCV) * 200), 0, 30)
  const klScore         = clamp(Math.round(directionKL * 25), 0, 40)
  const score           = clamp(spliceEdgeScore + aiEdgeScore + klScore, 0, 100)

  return { densityCV, directionKL, score }
}

// ── Stage 2·S5: Enhanced EXIF ─────────────────────────────────────────────────

const _SCREENSHOT_CUES = ['screenshot', 'screen shot', 'screencap', 'screenrecord', 'grab']

async function runEXIF(file: File): Promise<EXIFResult> {
  let raw: Record<string, unknown>  = {}
  let score                         = 0
  const flags: string[]             = []
  let software: string | undefined
  let gpsPresent                    = false
  let editSoftwareDetected          = false
  let dateTimeInconsistency         = false
  let isSuspectedScreenshot         = false
  let estimatedJpegQuality          = 0

  try {
    const exifr = await import('exifr')
    const data  = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, iptc: true, icc: false,
      sanitize: true, mergeOutput: false,
    })
    if (data) raw = { ...data.tiff, ...data.exif, gps: data.gps }
  } catch {
    // PNG, WebP, or non-EXIF file — this is NOT inherently suspicious
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
    isSuspectedScreenshot = isPng
    return {
      score: isPng ? 5 : 12,   // PNG without EXIF is expected; JPEG without EXIF is mildly suspicious
      raw: {}, flags: [isPng ? 'png_no_exif' : 'no_exif'],
      gpsPresent: false, editSoftwareDetected: false, dateTimeInconsistency: false,
      software: undefined, dateTime: undefined, isSuspectedScreenshot: isPng,
      estimatedJpegQuality: 0,
    }
  }

  // ── Software tag ──
  const sw = ((raw.Software as string | undefined) ?? '').toLowerCase()
  if (sw) {
    software = raw.Software as string
    for (const pat of EDIT_SOFTWARE_PATTERNS) {
      if (sw.includes(pat)) {
        editSoftwareDetected = true
        flags.push(`edit_software:${pat}`)
        score += 40
        break
      }
    }
    // Screenshot cues in software field
    if (_SCREENSHOT_CUES.some(c => sw.includes(c))) {
      isSuspectedScreenshot = true
      flags.push('screenshot_software')
    }
  } else {
    score += 5; flags.push('missing_software')
  }

  // ── XMP CreatorTool ──
  const creator = ((raw.CreatorTool as string | undefined) ?? '').toLowerCase()
  if (creator) {
    if (EDIT_SOFTWARE_PATTERNS.some(p => creator.includes(p))) {
      score += 28; flags.push('creator_tool_edit')
    }
    if (_SCREENSHOT_CUES.some(c => creator.includes(c))) {
      isSuspectedScreenshot = true; flags.push('screenshot_creator')
    }
  }

  // ── GPS presence ──
  const gps = raw.gps as Record<string, unknown> | undefined
  gpsPresent = !!(gps?.latitude)

  // ── Date/time inconsistency ──
  const dto = raw.DateTimeOriginal as string | undefined
  const dtd = raw.DateTime        as string | undefined
  const dateTime = dto ?? dtd

  if (dto && dtd && dto !== dtd) {
    const toMs = (s: string) => {
      // EXIF dates: "YYYY:MM:DD HH:MM:SS"
      const parts = s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      return new Date(parts).getTime()
    }
    const delta = Math.abs(toMs(dto) - toMs(dtd))
    if (delta > 60_000) {
      dateTimeInconsistency = true
      flags.push('datetime_mismatch')
      // Weight by how large the discrepancy is (up to 20 points)
      score += Math.min(20, Math.round(Math.log10(delta / 60_000 + 1) * 12))
    }
  }

  // ── Future date check (implausible timestamp) ──
  if (dateTime) {
    const parsed = new Date(dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'))
    if (!isNaN(parsed.getTime()) && parsed > new Date()) {
      flags.push('future_date'); score += 10
    }
  }

  // ── Missing camera make/model ──
  if (!raw.Make && !raw.Model) {
    flags.push('no_camera_make'); score += 8
  }

  // ── Completely missing EXIF ──
  if (Object.keys(raw).length === 0 || (Object.keys(raw).length === 1 && raw.gps === undefined)) {
    score = Math.max(score, file.type === 'image/jpeg' ? 18 : 5)
    flags.push('no_exif_data')
  }

  // ── Estimate JPEG quality from EXIF (if available) ──
  // Some EXIF implementations store the quality setting
  if (typeof raw.Quality === 'number') estimatedJpegQuality = raw.Quality as number

  return {
    score:                clamp(score, 0, 100),
    raw, flags, software, dateTime,
    gpsPresent, editSoftwareDetected, dateTimeInconsistency,
    isSuspectedScreenshot, estimatedJpegQuality,
  }
}

// ── Stage 2·S6: Chroma Channel Analysis ──────────────────────────────────────

/**
 * AI-generated images (especially diffusion models) have characteristic
 * colour properties:
 *
 * 1. Very high inter-channel correlation (R≈G≈B scaled versions of each other)
 *    because diffusion models generate colour through learned correlations
 *    rather than physical optics.  Threshold: R-G Pearson > 0.92 is suspicious.
 *
 * 2. Platykurtic saturation histogram: AI images tend to have mid-range saturation
 *    uniformly distributed, whereas real photos have peaks near 0 (neutral tones)
 *    and a long tail toward high saturation.
 *
 * 3. Low saturation entropy: AI images sometimes have unusually narrow saturation
 *    distributions.
 *
 * 4. Abnormal channel kurtosis: natural images have slightly positive kurtosis
 *    due to the prevalence of uniform patches.  Very negative kurtosis (< −1)
 *    can indicate synthetic generation.
 */
function runChromaAnalysis(wi: WorkingImage): ChromaAnalysis {
  const { rgba, w, h } = wi
  const n  = w * h
  const R  = extractChannel(rgba, n, 0)
  const G  = extractChannel(rgba, n, 1)
  const B  = extractChannel(rgba, n, 2)
  const sat = saturationMap(rgba, n)

  // Subsample for performance (every 4th pixel)
  const step = 4
  const Rs: number[] = [], Gs: number[] = [], Bs: number[] = []
  for (let i = 0; i < n; i += step) { Rs.push(R[i]); Gs.push(G[i]); Bs.push(B[i]) }
  const Rf = new Float32Array(Rs), Gf = new Float32Array(Gs), Bf = new Float32Array(Bs)

  const rgCorrelation = pearsonR(Rf, Gf)
  const rbCorrelation = pearsonR(Rf, Bf)
  const gbCorrelation = pearsonR(Gf, Bf)
  const avgCorrelation = (rgCorrelation + rbCorrelation + gbCorrelation) / 3

  // Channel kurtosis
  const rStat = computeStats(Rf)
  const gStat = computeStats(Gf)
  const bStat = computeStats(Bf)
  const channelKurt = (rStat.kurtosis + gStat.kurtosis + bStat.kurtosis) / 3

  // Saturation entropy
  const satHist  = histogram(sat, 32, 0, 1)
  const satEntropy = entropy(satHist)

  // Score computation:
  //   High avg correlation (> 0.90) → suspicious
  //   Very negative kurtosis (< −1.5) → suspicious
  //   Low saturation entropy (< 3.0) → suspicious
  let score = 0
  if (avgCorrelation > 0.90) score += Math.round((avgCorrelation - 0.90) * 600)
  if (channelKurt < -1.5)    score += Math.round(Math.abs(channelKurt + 1.5) * 18)
  if (satEntropy < 3.0)      score += Math.round((3.0 - satEntropy) * 15)
  score = clamp(score, 0, 100)

  return { rgCorrelation, rbCorrelation, gbCorrelation, avgCorrelation, satEntropy, channelKurt, score }
}

// ── Stage 2·S7: Document Pixel Analysis (for high-luminance PNGs) ────────────

/**
 * Detects vector-rendered or design-tool documents (Canva, Illustrator exports)
 * vs. authentic scanned documents.
 *
 * Three sub-signals:
 *   1. Noise floor — background pixel σ: authentic scan σ≈2–8, Canva export σ≈0–0.5
 *   2. Edge sharpness — sub-pixel-sharp edges (1px) → vector; natural edges 3–5px wide
 *   3. Bimodal tightness — histogram peak width (FWHM): tight → vector, broad → scan
 *
 * Only meaningful for document-like PNGs (high mean luminance, text present).
 */
function runDocumentPixelAnalysis(wi: WorkingImage): DocPixelAnalysis {
  const { lum, rgba, w, h } = wi
  const n = w * h

  // ── 1. Noise floor in background regions (lum > 0.85) ──────────────────────
  const BG_THRESHOLD = 0.85
  const PATCH_SIZE   = 16
  const patchSigmas: number[] = []

  for (let py = 0; py + PATCH_SIZE <= h; py += PATCH_SIZE) {
    for (let px = 0; px + PATCH_SIZE <= w; px += PATCH_SIZE) {
      // Check if patch is background (mean lum > BG_THRESHOLD)
      let patchMean = 0
      for (let y = py; y < py + PATCH_SIZE; y++) {
        for (let x = px; x < px + PATCH_SIZE; x++) {
          patchMean += lum[y * w + x]
        }
      }
      patchMean /= (PATCH_SIZE * PATCH_SIZE)
      if (patchMean < BG_THRESHOLD) continue

      // Compute σ of 8-bit values in background patch
      let sum = 0, sumSq = 0, cnt = 0
      for (let y = py; y < py + PATCH_SIZE; y++) {
        for (let x = px; x < px + PATCH_SIZE; x++) {
          const idx = y * w + x
          const v = Math.round(lum[idx] * 255)  // 8-bit
          sum += v; sumSq += v * v; cnt++
        }
      }
      if (cnt < 4) continue
      const mean = sum / cnt
      const sigma = Math.sqrt(Math.max(0, sumSq / cnt - mean * mean))
      patchSigmas.push(sigma)
    }
  }

  // Normalise: authentic scan σ ≈ 5–15, Canva σ ≈ 0–0.5
  // Score: high when σ is very low (vector/synthetic)
  let noiseFloorScore = 0
  if (patchSigmas.length > 0) {
    const medianSigma = patchSigmas.slice().sort((a, b) => a - b)[Math.floor(patchSigmas.length / 2)]
    // 0 = authentic (σ≥5), 100 = synthetic (σ≈0)
    noiseFloorScore = clamp(Math.round((1 - Math.min(1, medianSigma / 5)) * 100), 0, 100)
  }

  // ── 2. Edge sharpness: measure transition width at strong Sobel edges ────────
  // We measure the width (in pixels) of luminance transitions at detected edges.
  // Vector/Canva: 1px-wide transitions (mathematically sharp)
  // Authentic scan: 3–5px wide due to optics + paper texture
  const SOBEL_THRESH = 0.15
  const transitionWidths: number[] = []

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x
      const gx = lum[idx + 1] - lum[idx - 1]
      const gy = lum[(y + 1) * w + x] - lum[(y - 1) * w + x]
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag < SOBEL_THRESH) continue

      // Measure transition width horizontally
      let width = 1
      const lo = lum[idx - 1], hi = lum[idx + 1]
      if (Math.abs(hi - lo) > 0.1) {
        // Count how many pixels span the transition (max scan window ±3)
        for (let dx = 2; dx <= 3; dx++) {
          const prev = x - dx >= 0 ? lum[y * w + x - dx] : lo
          const next = x + dx < w  ? lum[y * w + x + dx] : hi
          if (Math.abs(next - prev) > Math.abs(hi - lo) * 0.9) width = dx * 2
        }
      }
      transitionWidths.push(width)
    }
  }

  // 1px-sharp edges → vector; 3–5px → natural
  let edgeSharpScore = 0
  if (transitionWidths.length > 20) {
    const sharpCount = transitionWidths.filter(tw => tw <= 1).length
    const sharpRatio = sharpCount / transitionWidths.length
    edgeSharpScore = clamp(Math.round(sharpRatio * 100), 0, 100)
  }

  // ── 3. Bimodal tightness — pixel histogram peak analysis ──────────────────
  // Build a 256-bin luminance histogram (8-bit values)
  const hist = new Float32Array(256)
  for (let i = 0; i < n; i++) {
    hist[Math.round(lum[i] * 255)]++
  }
  // Find two main peaks (background ≈ 220-255, text ≈ 0-50)
  // Background peak: max in 200-255 range
  let bgPeakIdx = 200, bgPeakVal = 0
  for (let i = 200; i < 256; i++) {
    if (hist[i] > bgPeakVal) { bgPeakVal = hist[i]; bgPeakIdx = i }
  }

  // Measure FWHM of background peak (Canva: std ≈ 0-3, Scan: std ≈ 8-20)
  const halfBg = bgPeakVal / 2
  let bgLo = bgPeakIdx, bgHi = bgPeakIdx
  while (bgLo > 150 && hist[bgLo] > halfBg) bgLo--
  while (bgHi < 256 && hist[bgHi] > halfBg) bgHi++
  const bgFWHM = Math.max(1, bgHi - bgLo)

  // Tight peak (FWHM ≤ 5) → Canva/vector; broad peak (≥ 20) → authentic scan
  const bimodalScore = clamp(Math.round((1 - Math.min(1, bgFWHM / 20)) * 100), 0, 100)

  // ── Combined score ──────────────────────────────────────────────────────────
  const score = clamp(Math.round(
    noiseFloorScore * 0.45 +
    edgeSharpScore  * 0.25 +
    bimodalScore    * 0.30
  ), 0, 100)

  return { noiseFloorScore, edgeSharpScore, bimodalScore, score }
}

// ── Stage 3: False-Positive Prevention ───────────────────────────────────────

interface ContextFlags {
  isScreenshot:       boolean   // true only for ACTUAL screenshots (not document PNGs)
  isDocumentPng:      boolean   // white-background PNG with text (invoice, ID, etc.)
  isActualScreenshot: boolean   // UI screenshot (not a document PNG)
  isLowQualityJpeg:   boolean   // estimated quality < 70
  isUniformColor:     boolean   // near-solid-color image (charts, icons)
  dominantLuma:       number    // mean luminance (useful for white-document detection)
}

function detectContext(wi: WorkingImage, exif: EXIFResult): ContextFlags {
  const { lum, rgba, w, h } = wi
  const n = w * h

  // Low-quality JPEG detection (cannot reliably detect from pixels alone;
  // use EXIF estimate if available, else default to unknown=false)
  const jpegQuality   = exif.estimatedJpegQuality ?? 0
  const isLowQualityJpeg = jpegQuality > 0 && jpegQuality < 70

  // Uniform-colour detection: if the standard deviation of luminance is very low,
  // the image is near-solid (icon, chart background, screencap of blank page)
  const lumStat       = computeStats(lum)
  const isUniformColor = lumStat.std < 0.06

  // lumStat is already computed for isUniformColor
  const isDocumentPng = wi.isPng
    && lumStat.mean > 0.72        // mostly white background
    && lumStat.std  > 0.08        // has text (bimodal, not uniform)

  // Actual screenshot: UI screenshot cue in EXIF OR isPng that is NOT a document
  const isActualScreenshot = (wi.isPng || (exif.isSuspectedScreenshot ?? false))
    && !isDocumentPng

  // Legacy compat field
  const isScreenshot = isActualScreenshot

  return {
    isScreenshot,
    isDocumentPng,
    isActualScreenshot,
    isLowQualityJpeg,
    isUniformColor,
    dominantLuma: lumStat.mean,
  }
}

/**
 * Adjust raw signal scores based on benign explanations.
 * Returns the adjusted scores.
 */
function applyContextAdjustments(
  ela:   MultiQualityELA,
  dct:   DCTAnalysis,
  noise: NoiseResidualAnalysis,
  edge:  EdgeAnalysis,
  exif:  EXIFResult,
  chroma: ChromaAnalysis,
  ctx:   ContextFlags,
): {
  elaScore:    number
  dctScore:    number
  noiseScore:  number
  edgeScore:   number
  exifScore:   number
  chromaScore: number
} {
  let elaScore    = ela.score
  let dctScore    = dct.score
  let noiseScore  = noise.score
  let edgeScore   = edge.score
  let exifScore   = exif.score
  let chromaScore = chroma.score

  // Only suppress for ACTUAL UI screenshots (not document PNGs)
  if (ctx.isActualScreenshot) {
    elaScore   = Math.min(elaScore, 20)
    noiseScore = Math.min(noiseScore, 25)
    // NEVER cap EXIF when edit software (Canva, Photoshop) is explicitly detected
    if (!exif.editSoftwareDetected) {
      exifScore = Math.min(exifScore, 15)
    }
  }

  // Low-quality JPEG: ELA thresholds should be relaxed (multiple re-saves expected)
  if (ctx.isLowQualityJpeg) {
    elaScore = Math.max(0, elaScore - 20)
    dctScore = Math.max(0, dctScore - 15)   // double-JPEG expected for low-q originals
  }

  // Near-uniform colour (icon, chart): exempt from edge and chroma analysis
  if (ctx.isUniformColor) {
    edgeScore   = Math.min(edgeScore, 15)
    chromaScore = Math.min(chromaScore, 20)
    noiseScore  = Math.min(noiseScore, 20)
  }

  // Very high exif score but rest are clean: limit exif contribution
  // (some legitimate professional cameras/RAW converters trigger software detection)
  if (exifScore > 50 && elaScore < 20 && noiseScore < 20 && dctScore < 20) {
    exifScore = Math.round(exifScore * 0.6)
  }

  return { elaScore, dctScore, noiseScore, edgeScore, exifScore, chromaScore }
}

// ── Stage 4: Bayesian Combination ────────────────────────────────────────────

/**
 * Calibrated Gaussian likelihood models for each signal.
 *
 * (μa, σa) = (mean, std) when image is AUTHENTIC
 * (μm, σm) = (mean, std) when image is MANIPULATED / SYNTHETIC
 *
 * These are hand-calibrated from expected signal distributions.
 * Conservative choices (wide std) prevent single-signal false positives.
 */
const SIGNAL_MODELS = {
  ela:      { μa: 18,  σa: 12,  μm: 55,  σm: 22 },
  dct:      { μa: 12,  σa: 10,  μm: 45,  σm: 22 },
  noise:    { μa: 18,  σa: 13,  μm: 55,  σm: 22 },
  edge:     { μa: 22,  σa: 14,  μm: 52,  σm: 22 },
  exif:     { μa: 10,  σa:  8,  μm: 42,  σm: 25 },
  chroma:   { μa: 14,  σa: 12,  μm: 52,  σm: 22 },
  docPixel: { μa:  8,  σa:  7,  μm: 60,  σm: 25 },
}

interface BayesianVerdict {
  manipulationProb:   number   // 0–1
  totalLLR:           number
  signalLLRs:         Record<string, number>
  signalsAboveThresh: number
  confidenceLevel:    number
  riskScore:          number
  riskLevel:          RiskLevel
}

function runBayesianCombiner(scores: {
  elaScore:       number
  dctScore:       number
  noiseScore:     number
  edgeScore:      number
  exifScore:      number
  chromaScore:    number
  docPixelScore?: number
}): BayesianVerdict {
  const { elaScore, dctScore, noiseScore, edgeScore, exifScore, chromaScore, docPixelScore } = scores

  // Compute per-signal log-likelihood ratios
  const llrEla    = gaussianLLR(elaScore,    SIGNAL_MODELS.ela.μa,    SIGNAL_MODELS.ela.σa,    SIGNAL_MODELS.ela.μm,    SIGNAL_MODELS.ela.σm)
  const llrDct    = gaussianLLR(dctScore,    SIGNAL_MODELS.dct.μa,    SIGNAL_MODELS.dct.σa,    SIGNAL_MODELS.dct.μm,    SIGNAL_MODELS.dct.σm)
  const llrNoise  = gaussianLLR(noiseScore,  SIGNAL_MODELS.noise.μa,  SIGNAL_MODELS.noise.σa,  SIGNAL_MODELS.noise.μm,  SIGNAL_MODELS.noise.σm)
  const llrEdge   = gaussianLLR(edgeScore,   SIGNAL_MODELS.edge.μa,   SIGNAL_MODELS.edge.σa,   SIGNAL_MODELS.edge.μm,   SIGNAL_MODELS.edge.σm)
  const llrExif   = gaussianLLR(exifScore,   SIGNAL_MODELS.exif.μa,   SIGNAL_MODELS.exif.σa,   SIGNAL_MODELS.exif.μm,   SIGNAL_MODELS.exif.σm)
  const llrChroma = gaussianLLR(chromaScore, SIGNAL_MODELS.chroma.μa, SIGNAL_MODELS.chroma.σa, SIGNAL_MODELS.chroma.μm, SIGNAL_MODELS.chroma.σm)

  // Add docPixel if present
  const llrDocPixel = docPixelScore !== undefined
    ? gaussianLLR(docPixelScore, SIGNAL_MODELS.docPixel.μa, SIGNAL_MODELS.docPixel.σa, SIGNAL_MODELS.docPixel.μm, SIGNAL_MODELS.docPixel.σm)
    : 0

  const signalLLRs = { ela: llrEla, dct: llrDct, noise: llrNoise, edge: llrEdge, exif: llrExif, chroma: llrChroma,
    ...(docPixelScore !== undefined ? { docPixel: llrDocPixel } : {})
  }
  const totalLLR   = llrEla + llrDct + llrNoise + llrEdge + llrExif + llrChroma + llrDocPixel

  // Count signals that individually point toward manipulation (LLR > 0)
  const signalsAboveThresh = Object.values(signalLLRs).filter(v => v > 0.3).length

  // Confidence: how many signals agree with the majority verdict
  const manipulationProb = bayesianPosterior(totalLLR)
  const verdictIsManip   = manipulationProb > 0.5

  const totalSignals = docPixelScore !== undefined ? 7 : 6
  let agreingCount = 0
  for (const [, llr] of Object.entries(signalLLRs)) {
    const signalSaysManip = llr > 0
    if (signalSaysManip === verdictIsManip) agreingCount++
  }
  const confidenceLevel = clamp01(agreingCount / totalSignals)

  // ── False-positive gate ──────────────────────────────────────────────────
  // Even if Bayesian posterior is high, we require at least 2 signals
  // with positive LLR AND total LLR > 0.5 before producing suspicious/high_risk.
  // This prevents a single noisy signal from triggering a false positive.
  const effectiveProb =
    signalsAboveThresh >= 2 && totalLLR > 0.5
      ? manipulationProb
      : Math.min(manipulationProb, 0.38)  // cap below suspicious threshold

  // ── Map posterior to risk score 0–100 ─────────────────────────────────────
  // Use a non-linear mapping that compresses the midrange to avoid
  // spurious "suspicious" verdicts: below 30 % → max score 29.
  const riskScore =
    effectiveProb >= 0.65 ? clamp(Math.round(65 + (effectiveProb - 0.65) * 100), 65, 100) :
    effectiveProb >= 0.40 ? clamp(Math.round(30 + (effectiveProb - 0.40) * 140), 30, 64)  :
    clamp(Math.round(effectiveProb * 75), 0, 29)

  const riskLevel: RiskLevel =
    riskScore >= 65 ? 'high_risk'  :
    riskScore >= 30 ? 'suspicious' : 'clean'

  return {
    manipulationProb: effectiveProb, totalLLR, signalLLRs,
    signalsAboveThresh, confidenceLevel, riskScore, riskLevel,
  }
}

// ── Stage 5: Alert generation ─────────────────────────────────────────────────

function buildAlerts(
  ela:    MultiQualityELA,
  dct:    DCTAnalysis,
  noise:  NoiseResidualAnalysis,
  edge:   EdgeAnalysis,
  exif:   EXIFResult,
  chroma: ChromaAnalysis,
  adj:    ReturnType<typeof applyContextAdjustments>,
  bayes:  BayesianVerdict,
  ctx:    ContextFlags,
): ForensicAlert[] {
  const alerts: ForensicAlert[] = []

  // ── ELA alerts ──
  if (ela.aiSignature) {
    alerts.push({
      code: 'ela_ai_signature', label: 'Sin historial de compresión JPEG (imagen sintética o render vectorial)',
      detail: 'La curva ELA multi-calidad es plana y próxima a cero en todos los niveles de compresión. Imágenes generadas por IA (Stable Diffusion, Midjourney, DALL-E) o exportadas desde herramientas vectoriales (Canva, Illustrator) muestran este patrón al no haber sido nunca comprimidas como JPEG.',
      severity: ctx.isDocumentPng ? 'medium' : 'high', module: 'ela',
    })
  } else if (adj.elaScore >= 60) {
    alerts.push({
      code: 'ela_high', label: 'Alta probabilidad de manipulación local',
      detail: `El análisis ELA multi-calidad (${ela.qualities.join('/')}% JPEG) detectó inconsistencias en el historial de compresión. Violaciones de monotonicidad: ${ela.monotonicViolations}/${ela.qualities.length - 1}. ELA residual a q=92: ${ela.highQualityResidue.toFixed(1)}.`,
      severity: 'high', module: 'ela',
    })
  } else if (adj.elaScore >= 35) {
    alerts.push({
      code: 'ela_medium', label: 'Artefactos de compresión anómalos',
      detail: 'Se detectaron regiones con historial de compresión inconsistente con el resto de la imagen. Posible retoque localizado.',
      severity: 'medium', module: 'ela',
    })
  }

  // Monotonicity violation (separate from overall score)
  if (ela.monotonicViolations >= 2 && !ela.aiSignature && !ctx.isActualScreenshot) {
    alerts.push({
      code: 'ela_nonmonotonic', label: 'Curva ELA no monótona',
      detail: `La variación del error de compresión entre calidades JPEG no sigue el patrón esperado en una imagen auténtica. ${ela.monotonicViolations} inversiones detectadas en la curva ELA.`,
      severity: 'medium', module: 'ela',
    })
  }

  // ── DCT alerts ──
  if (adj.dctScore >= 50) {
    alerts.push({
      code: 'dct_double_jpeg', label: 'Indicios de doble compresión JPEG',
      detail: `Los coeficientes DC de los bloques 8×8 muestran patrones periódicos en el histograma (índice de periodicidad: ${dct.dcGapScore}), consistentes con una doble compresión JPEG a distintas calidades. Las imágenes manipuladas suelen pasar por este proceso.`,
      severity: dct.dcGapScore >= 65 ? 'high' : 'medium', module: 'dct',
    })
  }

  // ── Noise / PRNU alerts ──
  if (noise.residualCorrelation < 0.03 && !ctx.isScreenshot && !ctx.isUniformColor) {
    alerts.push({
      code: 'noise_ai_residual', label: 'Residuo de ruido con firma sintética',
      detail: `La correlación inter-regional del residuo de denoising es ${noise.residualCorrelation.toFixed(3)} (esperado > 0.10 en fotografías reales). Las imágenes de IA generativa no presentan huella PRNU de sensor.`,
      severity: 'high', module: 'noise',
    })
  }
  if (noise.correlationVariance > 0.05 && !ctx.isScreenshot) {
    alerts.push({
      code: 'noise_splice_residual', label: 'Inconsistencia en ruido entre regiones',
      detail: 'La varianza de la correlación del residuo de ruido entre regiones es elevada, lo que puede indicar que distintas partes de la imagen provienen de fuentes diferentes (imagen compuesta/montaje).',
      severity: 'medium', module: 'noise',
    })
  }
  if (noise.waveletConsistency < 0.30 && !ctx.isScreenshot && !ctx.isUniformColor) {
    alerts.push({
      code: 'noise_wavelet', label: 'Subbanda wavelet HH anómalamente uniforme',
      detail: `La energía en la subbanda de detalle diagonal (Haar HH) es inusualmente uniforme entre regiones (consistencia: ${noise.waveletConsistency.toFixed(2)}). En imágenes reales la textura de alta frecuencia varía según el contenido.`,
      severity: 'medium', module: 'noise',
    })
  }

  // ── Edge alerts ──
  if (adj.edgeScore >= 55) {
    alerts.push({
      code: 'edge_discontinuity', label: 'Discontinuidad estadística en bordes',
      detail: `La divergencia KL entre histogramas de dirección de gradiente en regiones adyacentes es elevada (${edge.directionKL.toFixed(3)}). Este patrón puede indicar regiones de distinto origen visual (splice/composición).`,
      severity: 'medium', module: 'edge',
    })
  }

  // ── EXIF alerts ──
  if (exif.editSoftwareDetected) {
    alerts.push({
      code: 'exif_edit_software', label: 'Software de edición detectado en metadatos',
      detail: `Los metadatos EXIF registran uso de: ${exif.software}. Evidencia directa de procesamiento post-captura.`,
      severity: 'high', module: 'exif',
    })
  }
  if (exif.dateTimeInconsistency) {
    alerts.push({
      code: 'exif_date_mismatch', label: 'Inconsistencia de fechas EXIF',
      detail: 'La fecha de captura original difiere de la fecha de modificación del archivo. La imagen fue editada y re-guardada.',
      severity: 'medium', module: 'exif',
    })
  }
  if (exif.flags.includes('future_date')) {
    alerts.push({
      code: 'exif_future_date', label: 'Fecha EXIF en el futuro',
      detail: 'El timestamp EXIF indica una fecha futura, lo que es técnicamente imposible. Los metadatos pueden haber sido manipulados.',
      severity: 'high', module: 'exif',
    })
  }
  if (exif.flags.includes('no_exif_data') && !ctx.isScreenshot) {
    alerts.push({
      code: 'exif_missing', label: 'Sin metadatos EXIF',
      detail: 'La imagen JPEG no contiene metadatos de cámara. Los dispositivos móviles y cámaras siempre generan EXIF. Posible imagen sintética, editada o screenshot renombrado.',
      severity: 'low', module: 'exif',
    })
  }

  // ── Chroma alerts ──
  if (adj.chromaScore >= 45) {
    const detail = chroma.avgCorrelation > 0.90
      ? `La correlación inter-canal R-G-B es anómalamente alta (${chroma.avgCorrelation.toFixed(3)} vs. esperado < 0.88 en fotografías). Los modelos de difusión generan canales de color correlacionados artificialmente.`
      : `La distribución de saturación y curtosis de canales (${chroma.channelKurt.toFixed(2)}) difiere del perfil estadístico de imágenes fotográficas reales.`
    alerts.push({
      code: 'chroma_ai_signature', label: 'Firma cromática de imagen sintética',
      detail, severity: chroma.avgCorrelation > 0.93 ? 'high' : 'medium', module: 'chroma',
    })
  }

  // ── Meta alert: high-confidence verdict ──
  if (bayes.riskScore >= 65 && bayes.signalsAboveThresh >= 3) {
    alerts.push({
      code: 'meta_convergence', label: 'Múltiples señales forenses convergentes',
      detail: `${bayes.signalsAboveThresh} señales independientes apuntan a manipulación (probabilidad bayesiana: ${(bayes.manipulationProb * 100).toFixed(1)}%). La convergencia de señales independientes aumenta significativamente la fiabilidad del veredicto.`,
      severity: 'high', module: 'meta',
    })
  }

  return alerts
}

// ── Thumbnail helper ──────────────────────────────────────────────────────────

function makeThumbnail(img: HTMLImageElement, maxW = 320): string {
  const scale = Math.min(1, maxW / img.naturalWidth)
  const w = Math.round(img.naturalWidth  * scale)
  const h = Math.round(img.naturalHeight * scale)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.7)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function analyzeImage(file: File): Promise<ForensicsReport> {
  const t0 = performance.now()

  const dataUrl = await fileToDataURL(file)
  const img     = await loadImage(dataUrl)

  // Stage 1: Preprocessing
  const wi        = await prepareWorkingImage(img, file)
  const thumbnail = makeThumbnail(img)

  // Stage 2: Signal extraction (ELA is async; rest are sync)
  const [elaResult, exifResult] = await Promise.all([
    runMultiQualityELA(wi),
    runEXIF(file),
  ])

  // Sync signals
  const dctResult    = runDCTAnalysis(wi)
  const noiseResult  = runNoiseResidualAnalysis(wi)
  const edgeResult   = runEdgeAnalysis(wi)
  const chromaResult = runChromaAnalysis(wi)

  // Stage 3: Context detection & false-positive prevention
  const ctx        = detectContext(wi, exifResult)
  const adjusted   = applyContextAdjustments(
    elaResult, dctResult, noiseResult, edgeResult, exifResult, chromaResult, ctx
  )

  // S7: Document pixel analysis (after context, before combiner)
  const docPixelResult = ctx.isDocumentPng ? runDocumentPixelAnalysis(wi) : null

  // Stage 4: Bayesian combination (Veritas)
  const bayes = runBayesianCombiner({
    ...adjusted,
    docPixelScore: docPixelResult?.score,
  })

  // Stage 5: Alerts
  const alerts = buildAlerts(
    elaResult, dctResult, noiseResult, edgeResult, exifResult, chromaResult,
    adjusted, bayes, ctx
  )

  // Assemble backward-compatible report
  const noiseCompat: NoiseResult = {
    score:               adjusted.noiseScore,
    laplacianVariance:   noiseResult.residualCorrelation * 100,
    uniformityScore:     1 - noiseResult.waveletConsistency,
    blockVarianceStd:    Math.sqrt(noiseResult.correlationVariance),
    residualCorrelation: noiseResult.residualCorrelation,
    waveletConsistency:  noiseResult.waveletConsistency,
  }

  const elaCompat: ELAResult = {
    score:              adjusted.elaScore,
    heatmapDataUrl:     elaResult.heatmapDataUrl,
    maxDiff:            elaResult.maxDiff,
    meanDiff:           elaResult.meanDiff,
    suspiciousRegions:  elaResult.suspiciousRegions,
    curveMonotonicity:  elaResult.curveMonotonicity,
    highQualityResidue: elaResult.highQualityResidue,
    aiSignature:        elaResult.aiSignature,
  }

  return {
    elaScore:   adjusted.elaScore,
    exifScore:  adjusted.exifScore,
    noiseScore: adjusted.noiseScore,
    riskScore:  bayes.riskScore,
    riskLevel:  bayes.riskLevel,
    ela:        elaCompat,
    exif:       exifResult,
    noise:      noiseCompat,
    alerts,
    thumbnail,
    analysisMs: Math.round(performance.now() - t0),
    // v3 fields
    dctScore:           adjusted.dctScore,
    edgeScore:          adjusted.edgeScore,
    chromaScore:        adjusted.chromaScore,
    manipulationProb:   bayes.manipulationProb,
    confidenceLevel:    bayes.confidenceLevel,
    signalsAboveThresh: bayes.signalsAboveThresh,
    docPixelScore:      docPixelResult?.score,
  }
}

// ── Utility exports (backward-compatible) ────────────────────────────────────

export function riskLevelColor(level: RiskLevel): string {
  return level === 'high_risk'  ? '#ff4444'
       : level === 'suspicious' ? '#ffaa00'
       : '#00ff9d'
}

export function riskLevelLabel(level: RiskLevel): string {
  return level === 'high_risk'  ? 'Alto Riesgo'
       : level === 'suspicious' ? 'Sospechoso'
       : 'Limpio'
}
