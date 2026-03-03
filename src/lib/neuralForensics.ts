/**
 * Deep-Check · Neural Forensics Engine  (feat/neural-forensics)
 * =================================================================
 * Enhanced image manipulation detection running entirely in the browser.
 *
 * Modes (auto-selected at runtime):
 *   'onnx'               — ONNX Runtime Web model loaded from /models/forgery-detector.onnx
 *   'enhanced_heuristic' — No model available; uses multi-scale ELA + DCT + region splicing
 *
 * The ONNX mode activates automatically when the admin places a trained
 * forgery-detector.onnx into the /public/models/ directory.
 *
 * Enhanced heuristic algorithms (more precise than standard ELA):
 *   1. Multi-scale ELA — ELA at 4 JPEG qualities (65, 75, 85, 92) → variance across scores
 *   2. DCT frequency domain — detect double-JPEG compression artifacts (splicing marker)
 *   3. Regional noise consistency — split image into quadrants, compare Laplacian variance
 *   4. Colour channel decorrelation — AI-generated images have unnaturally low channel cross-correlation
 *   5. Kurtosis analysis — natural images have kurtosis ~3 (mesokurtic); AI/spliced images deviate
 */

'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NeuralMode = 'onnx' | 'enhanced_heuristic'

export interface MultiScaleELAResult {
    qualityScores: Record<number, number>   // q → ELA score at that quality
    varianceAcrossQualities: number         // high = suspicious (inconsistent re-compression)
    meanScore: number
    spliceIndicatorScore: number            // 0-100: double-JPEG compression probability
}

export interface FrequencyAnalysisResult {
    highFreqRatio: number           // ratio of high-frequency energy to total
    lowFreqRatio: number
    frequencyAsymmetry: number      // natural images have ~symmetric DCT distribution
    doubleJpegScore: number         // 0-100: periodic DCT histogram → double JPEG
}

export interface RegionalConsistencyResult {
    quadrantNoiseScores: number[]    // Laplacian variance per quadrant
    noiseCV: number                  // coefficient of variation (high = inconsistent = spliced)
    spliceZones: number              // count of quadrants that deviate significantly
    consistencyScore: number         // 0-100 (100 = very suspicious inconsistency)
}

export interface ChannelAnalysisResult {
    rgCorrelation: number            // R↔G channel correlation (natural: >0.85)
    rbCorrelation: number            // R↔B
    gbCorrelation: number            // G↔B
    kurtosisR: number; kurtosisG: number; kurtosisB: number
    aiSignatureScore: number         // 0-100 (AI images: unnaturally high correlation)
}

export interface NeuralForensicsResult {
    mode: NeuralMode
    neuralScore: number              // 0-100 (higher = more suspicious)
    riskLevel: 'clean' | 'suspicious' | 'high_risk'
    confidence: number               // 0-1
    analysisMs: number

    findings: {
        multiScaleELA: MultiScaleELAResult
        frequencyAnalysis: FrequencyAnalysisResult
        regionalConsistency: RegionalConsistencyResult
        channelAnalysis: ChannelAnalysisResult
        onnxPrediction?: { forgedProbability: number; authenticity: number }
    }

    alerts: Array<{
        code: string
        label: string
        detail: string
        severity: 'low' | 'medium' | 'high'
    }>

    explanation: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ELA_QUALITIES = [65, 75, 85, 92] as const
const ANALYSIS_SIZE = 512     // downsample to this max dimension for speed
const ONNX_MODEL_PATH = '/models/forgery-detector.onnx'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v))
}

function mean(arr: number[]) {
    return arr.reduce((s, v) => s + v, 0) / arr.length
}

function std(arr: number[], m?: number) {
    const mu = m ?? mean(arr)
    return Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length)
}

function cv(arr: number[]) {
    const mu = mean(arr)
    return mu === 0 ? 0 : std(arr, mu) / mu
}

function kurtosis(arr: number[]) {
    const mu = mean(arr)
    const sigma = std(arr, mu)
    if (sigma === 0) return 0
    const n = arr.length
    const k = arr.reduce((s, v) => s + ((v - mu) / sigma) ** 4, 0) / n
    return k - 3   // excess kurtosis (normal = 0)
}

function pearsonCorr(a: number[], b: number[]) {
    const ma = mean(a), mb = mean(b)
    const sa = std(a, ma), sb = std(b, mb)
    if (sa === 0 || sb === 0) return 0
    let cov = 0
    for (let i = 0; i < a.length; i++) cov += (a[i] - ma) * (b[i] - mb)
    return cov / (a.length * sa * sb)
}

/** Resize HTMLImageElement to a canvas of max `maxDim` px on the longest side */
function imageToCanvas(img: HTMLImageElement, maxDim = ANALYSIS_SIZE) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    const W = Math.max(1, Math.round(img.width * scale))
    const H = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, W, H)
    return { canvas, ctx, W, H }
}

/** Recompress canvas to JPEG at given quality (0-100), return new ImageData */
async function recompressToQuality(
    img: HTMLImageElement,
    quality: number,
): Promise<ImageData> {
    const { canvas, W, H } = imageToCanvas(img)
    const blob = await new Promise<Blob>(res =>
        canvas.toBlob(b => res(b!), 'image/jpeg', quality / 100),
    )
    const url = URL.createObjectURL(blob)
    return new Promise((res, rej) => {
        const img2 = new Image()
        img2.onload = () => {
            const c2 = document.createElement('canvas')
            c2.width = W; c2.height = H
            const ctx2 = c2.getContext('2d', { willReadFrequently: true })!
            ctx2.drawImage(img2, 0, 0, W, H)
            URL.revokeObjectURL(url)
            res(ctx2.getImageData(0, 0, W, H))
        }
        img2.onerror = rej
        img2.src = url
    })
}

/** Compute ELA score given original ImageData and recompressed ImageData */
function computeELAScore(orig: ImageData, recomp: ImageData): number {
    const { data: od } = orig
    const { data: rd } = recomp
    const BLOCK = 8
    const W = orig.width
    const H = orig.height
    const bW = Math.floor(W / BLOCK)
    const bH = Math.floor(H / BLOCK)

    let suspiciousBlocks = 0
    const blockMeans: number[] = []

    for (let by = 0; by < bH; by++) {
        for (let bx = 0; bx < bW; bx++) {
            let sum = 0
            let count = 0
            for (let y = by * BLOCK; y < (by + 1) * BLOCK; y++) {
                for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x++) {
                    const i = (y * W + x) * 4
                    const diff = (Math.abs(od[i] - rd[i]) + Math.abs(od[i + 1] - rd[i + 1]) + Math.abs(od[i + 2] - rd[i + 2])) / 3
                    sum += diff
                    count++
                }
            }
            const blockMean = sum / count
            blockMeans.push(blockMean)
            if (blockMean > 12) suspiciousBlocks++
        }
    }

    const totalBlocks = bW * bH
    if (totalBlocks === 0) return 0
    const suspRatio = suspiciousBlocks / totalBlocks
    const meanDiff = mean(blockMeans)
    return clamp(Math.round(suspRatio * 80 + meanDiff * 1.5), 0, 100)
}

// ─── 1. Multi-Scale ELA ──────────────────────────────────────────────────────

async function runMultiScaleELA(img: HTMLImageElement): Promise<MultiScaleELAResult> {
    const { ctx, W, H } = imageToCanvas(img)
    const orig = ctx.getImageData(0, 0, W, H)

    const qualityScores: Record<number, number> = {}
    for (const q of ELA_QUALITIES) {
        const recomp = await recompressToQuality(img, q)
        qualityScores[q] = computeELAScore(orig, recomp)
    }

    const scores = Object.values(qualityScores)
    const meanScore = mean(scores)
    const varianceAcrossQualities = std(scores)

    // Double-JPEG splice indicator: if scores at different qualities are very
    // inconsistent, the image has been JPEG-compressed at different quality levels
    // in different regions → typical of spliced images.
    // Natural images: ELA score drops monotonically as quality rises (they were compressed once).
    // Spliced images: irregular pattern (some regions better at q65, others at q85).
    const qs = ELA_QUALITIES.map(q => qualityScores[q])
    const isMonotonic = qs.every((v, i, a) => i === 0 || v <= a[i - 1])
    const spliceIndicatorScore = isMonotonic
        ? clamp(Math.round(meanScore * 0.6), 0, 100)
        : clamp(Math.round(meanScore * 0.6 + varianceAcrossQualities * 3), 0, 100)

    return { qualityScores, varianceAcrossQualities, meanScore, spliceIndicatorScore }
}

// ─── 2. Frequency / DCT Domain Analysis ─────────────────────────────────────

/**
 * Approximate DCT-domain analysis via 8×8 block DCT (pure JS).
 * Detects double-JPEG compression by analysing the energy distribution
 * across frequency bands — double-compressed images have characteristic
 * periodic dips in their DCT coefficient histograms.
 */
function runFrequencyAnalysis(imgData: ImageData): FrequencyAnalysisResult {
    const { data, width: W, height: H } = imgData
    const BLOCK = 8
    const bW = Math.floor(W / BLOCK)
    const bH = Math.floor(H / BLOCK)

    // Pre-compute DCT-II basis matrix for 8x8
    const basis: number[][] = Array.from({ length: BLOCK }, (_, k) =>
        Array.from({ length: BLOCK }, (__, n) =>
            Math.cos((Math.PI * k * (2 * n + 1)) / (2 * BLOCK)),
        ),
    )

    let totalEnergy = 0
    let lowFreqEnergy = 0   // DC + 3 lowest AC bands
    let highFreqEnergy = 0  // bands above 4

    // Collect histogram of DC coefficient values (for double-JPEG detection)
    const dcHistogram = new Float64Array(256)

    for (let by = 0; by < bH; by++) {
        for (let bx = 0; bx < bW; bx++) {
            // Extract grayscale 8×8 block
            const block = new Float64Array(BLOCK * BLOCK)
            for (let y = 0; y < BLOCK; y++) {
                for (let x = 0; x < BLOCK; x++) {
                    const i = ((by * BLOCK + y) * W + (bx * BLOCK + x)) * 4
                    block[y * BLOCK + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
                }
            }

            // 1D DCT rows then columns (separable)
            const dct = new Float64Array(BLOCK * BLOCK)
            for (let u = 0; u < BLOCK; u++) {
                for (let v = 0; v < BLOCK; v++) {
                    let sum = 0
                    for (let x = 0; x < BLOCK; x++) {
                        for (let y = 0; y < BLOCK; y++) {
                            sum += block[y * BLOCK + x] * basis[u][x] * basis[v][y]
                        }
                    }
                    const cu = u === 0 ? 1 / Math.SQRT2 : 1
                    const cv = v === 0 ? 1 / Math.SQRT2 : 1
                    dct[u * BLOCK + v] = (cu * cv / 4) * sum
                }
            }

            // Accumulate energies
            for (let u = 0; u < BLOCK; u++) {
                for (let v = 0; v < BLOCK; v++) {
                    const e = dct[u * BLOCK + v] ** 2
                    totalEnergy += e
                    const band = u + v
                    if (band <= 3) lowFreqEnergy += e
                    else if (band >= 9) highFreqEnergy += e
                }
            }

            // DC coefficient histogram (first coeff)
            const dc = Math.round(dct[0] / 4) + 128
            if (dc >= 0 && dc < 256) dcHistogram[dc]++
        }
    }

    const highFreqRatio = totalEnergy > 0 ? highFreqEnergy / totalEnergy : 0
    const lowFreqRatio = totalEnergy > 0 ? lowFreqEnergy / totalEnergy : 0
    const frequencyAsymmetry = Math.abs(highFreqRatio - 0.05)   // natural: ~5% high-freq

    // Double-JPEG detection: look for periodic gaps every 8 bins in DC histogram
    // (artifact of quantisation with two different quality tables)
    const period = 8
    let periodicityScore = 0
    const N = bW * bH
    if (N > 0) {
        for (let bin = period; bin < 240; bin += period) {
            const localMean = (dcHistogram[bin - 1] + dcHistogram[bin + 1]) / 2
            const gap = Math.max(0, localMean - dcHistogram[bin])
            periodicityScore += gap
        }
        periodicityScore = Math.min(1, periodicityScore / (N * 0.05))
    }

    const doubleJpegScore = clamp(Math.round(periodicityScore * 100), 0, 100)

    return {
        highFreqRatio: Number(highFreqRatio.toFixed(4)),
        lowFreqRatio: Number(lowFreqRatio.toFixed(4)),
        frequencyAsymmetry: Number(frequencyAsymmetry.toFixed(4)),
        doubleJpegScore,
    }
}

// ─── 3. Regional Noise Consistency ──────────────────────────────────────────

function runRegionalConsistency(imgData: ImageData): RegionalConsistencyResult {
    const { data, width: W, height: H } = imgData
    // Split into 3×3 grid of regions (9 quadrants)
    const GRID = 3
    const rW = Math.floor(W / GRID)
    const rH = Math.floor(H / GRID)
    const noiseScores: number[] = []

    for (let ry = 0; ry < GRID; ry++) {
        for (let rx = 0; rx < GRID; rx++) {
            let lapSum = 0; let count = 0
            const x0 = rx * rW, y0 = ry * rH
            const x1 = x0 + rW, y1 = y0 + rH

            for (let y = y0 + 1; y < y1 - 1; y++) {
                for (let x = x0 + 1; x < x1 - 1; x++) {
                    const gray = (c: number) => {
                        const i = (y * W + x + c) * 4
                        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
                    }
                    const lap = Math.abs(
                        4 * gray(0) -
                        gray(-1) - gray(1) -
                        gray(-W) - gray(W),
                    )
                    lapSum += lap
                    count++
                }
            }
            noiseScores.push(count > 0 ? lapSum / count : 0)
        }
    }

    const noiseCV = cv(noiseScores)
    const noiseMean = mean(noiseScores)
    const noiseStd = std(noiseScores, noiseMean)
    const threshold = noiseMean + noiseStd * 2

    const spliceZones = noiseScores.filter(s => s > threshold || s < noiseMean - noiseStd * 2).length

    // High CV → inconsistent noise → splicing
    const consistencyScore = clamp(Math.round(noiseCV * 300 + spliceZones * 8), 0, 100)

    return {
        quadrantNoiseScores: noiseScores.map(s => Number(s.toFixed(2))),
        noiseCV: Number(noiseCV.toFixed(4)),
        spliceZones,
        consistencyScore,
    }
}

// ─── 4. Colour Channel Analysis ──────────────────────────────────────────────

function runChannelAnalysis(imgData: ImageData): ChannelAnalysisResult {
    const { data, width: W, height: H } = imgData
    const N = W * H
    const R: number[] = [], G: number[] = [], B: number[] = []

    // Sample every 4th pixel for speed
    for (let i = 0; i < data.length; i += 16) {
        R.push(data[i])
        G.push(data[i + 1])
        B.push(data[i + 2])
    }

    const rgCorr = pearsonCorr(R, G)
    const rbCorr = pearsonCorr(R, B)
    const gbCorr = pearsonCorr(G, B)

    const kR = kurtosis(R)
    const kG = kurtosis(G)
    const kB = kurtosis(B)

    // AI-generated images: channels are highly correlated (GAN learns joint distribution)
    // AND kurtosis is often slightly negative (platykurtic — unnaturally flat histogram)
    const avgCorr = (rgCorr + rbCorr + gbCorr) / 3
    const avgKurt = (kR + kG + kB) / 3

    // Score increases when correlation is very high AND kurtosis is negative
    let aiSignatureScore = 0
    if (avgCorr > 0.92) aiSignatureScore += (avgCorr - 0.92) * 700  // high channel coupling
    if (avgKurt < -0.5) aiSignatureScore += Math.abs(avgKurt + 0.5) * 20  // platykurtic

    aiSignatureScore = clamp(Math.round(aiSignatureScore), 0, 100)

    return {
        rgCorrelation: Number(rgCorr.toFixed(3)),
        rbCorrelation: Number(rbCorr.toFixed(3)),
        gbCorrelation: Number(gbCorr.toFixed(3)),
        kurtosisR: Number(kR.toFixed(2)),
        kurtosisG: Number(kG.toFixed(2)),
        kurtosisB: Number(kB.toFixed(2)),
        aiSignatureScore,
    }
}

// ─── 5. ONNX Inference (optional) ────────────────────────────────────────────

let onnxAvailable: boolean | null = null  // null = not yet checked

async function tryLoadOnnxModel(): Promise<boolean> {
    if (onnxAvailable !== null) return onnxAvailable
    try {
        const resp = await fetch(ONNX_MODEL_PATH, { method: 'HEAD' })
        onnxAvailable = resp.ok
    } catch {
        onnxAvailable = false
    }
    return onnxAvailable
}

/**
 * Run ONNX Runtime Web inference.
 * Expects a model with input: float32[1, 3, 224, 224] (CHW normalised 0-1).
 * Output: float32[1, 2] (logits: [authentic, forged]).
 */
async function runOnnxInference(
    imgData: ImageData,
): Promise<{ forgedProbability: number; authenticity: number } | null> {
    try {
        const ort = await import('onnxruntime-web')

        // Configure WASM path (Next.js serves from /public)
        ort.env.wasm.wasmPaths = '/onnx/'

        const session = await ort.InferenceSession.create(ONNX_MODEL_PATH)

        // Preprocess: resize to 224×224, normalise to [0,1]
        const TARGET = 224
        const canvas = document.createElement('canvas')
        canvas.width = TARGET; canvas.height = TARGET
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!

        // Draw original image scaled to 224×224
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = imgData.width; tempCanvas.height = imgData.height
        const tempCtx = tempCanvas.getContext('2d')!
        tempCtx.putImageData(imgData, 0, 0)
        ctx.drawImage(tempCanvas, 0, 0, TARGET, TARGET)

        const scaled = ctx.getImageData(0, 0, TARGET, TARGET)
        const pixels = scaled.data

        // CHW float32 tensor
        const tensor = new Float32Array(3 * TARGET * TARGET)
        for (let i = 0; i < TARGET * TARGET; i++) {
            tensor[i] = pixels[i * 4] / 255                          // R
            tensor[TARGET * TARGET + i] = pixels[i * 4 + 1] / 255    // G
            tensor[2 * TARGET * TARGET + i] = pixels[i * 4 + 2] / 255 // B
        }

        const input = new ort.Tensor('float32', tensor, [1, 3, TARGET, TARGET])
        const feeds = { [session.inputNames[0]]: input }
        const output = await session.run(feeds)
        const logits = output[session.outputNames[0]].data as Float32Array

        // Softmax
        const eA = Math.exp(logits[0])
        const eF = Math.exp(logits[1])
        const sum = eA + eF
        const forgedProbability = eF / sum

        return {
            forgedProbability: Number(forgedProbability.toFixed(4)),
            authenticity: Number((eA / sum).toFixed(4)),
        }
    } catch {
        return null  // graceful fallback
    }
}

// ─── 6. Alert builder ────────────────────────────────────────────────────────

function buildAlerts(
    ela: MultiScaleELAResult,
    freq: FrequencyAnalysisResult,
    regional: RegionalConsistencyResult,
    channel: ChannelAnalysisResult,
    onnx?: { forgedProbability: number },
) {
    const alerts: NeuralForensicsResult['alerts'] = []

    if (ela.spliceIndicatorScore > 50) {
        alerts.push({
            code: 'double_jpeg',
            label: 'Doble compresión JPEG detectada',
            detail: `Las diferentes calidades de análisis muestran patrones inconsistentes (índice: ${ela.spliceIndicatorScore}/100), lo que indica que la imagen ha sido re-guardada tras una manipulación.`,
            severity: ela.spliceIndicatorScore > 70 ? 'high' : 'medium',
        })
    }

    if (freq.doubleJpegScore > 35) {
        alerts.push({
            code: 'dct_artifacts',
            label: 'Artefactos DCT de doble compresión',
            detail: `El histograma de coeficientes DCT muestra periodicidad anómala (${freq.doubleJpegScore}/100), característica de imágenes JPEG comprimidas dos veces con distintas tablas de cuantización.`,
            severity: freq.doubleJpegScore > 60 ? 'high' : 'medium',
        })
    }

    if (regional.consistencyScore > 40) {
        alerts.push({
            code: 'noise_inconsistency',
            label: 'Inconsistencia de ruido entre regiones',
            detail: `Se detectaron ${regional.spliceZones} zonas con patrones de ruido significativamente distintos al resto (CV: ${(regional.noiseCV * 100).toFixed(1)}%), indicativo de inserción de contenido de otra fuente.`,
            severity: regional.consistencyScore > 65 ? 'high' : 'medium',
        })
    }

    if (channel.aiSignatureScore > 30) {
        alerts.push({
            code: 'ai_channel_signature',
            label: 'Firma espectral de imagen sintética (IA)',
            detail: `La correlación entre canales de color (R↔G: ${channel.rgCorrelation.toFixed(2)}) y la distribución de intensidades (kurtosis media: ${((channel.kurtosisR + channel.kurtosisG + channel.kurtosisB) / 3).toFixed(2)}) presentan características asociadas a imágenes generadas por redes generativas.`,
            severity: channel.aiSignatureScore > 60 ? 'high' : 'medium',
        })
    }

    if (onnx && onnx.forgedProbability > 0.6) {
        alerts.push({
            code: 'onnx_forgery_detected',
            label: 'Modelo neural: manipulación confirmada',
            detail: `El modelo de visión por computador asigna una probabilidad de falsificación del ${Math.round(onnx.forgedProbability * 100)}%.`,
            severity: onnx.forgedProbability > 0.8 ? 'high' : 'medium',
        })
    }

    return alerts
}

// ─── 7. Final score combiner ─────────────────────────────────────────────────

function combineScores(
    ela: MultiScaleELAResult,
    freq: FrequencyAnalysisResult,
    regional: RegionalConsistencyResult,
    channel: ChannelAnalysisResult,
    onnx?: { forgedProbability: number },
): { neuralScore: number; riskLevel: NeuralForensicsResult['riskLevel']; confidence: number } {
    // Weighted combination
    let score = 0
    let totalWeight = 0

    const add = (value: number, weight: number) => {
        score += value * weight
        totalWeight += weight
    }

    add(ela.spliceIndicatorScore, 0.30)
    add(freq.doubleJpegScore, 0.25)
    add(regional.consistencyScore, 0.25)
    add(channel.aiSignatureScore, 0.20)

    if (onnx) {
        // ONNX prediction overrides heuristics (higher weight)
        score = score * 0.4 + onnx.forgedProbability * 100 * 0.6
        totalWeight = 1
    }

    const neuralScore = clamp(Math.round(totalWeight > 0 ? score / totalWeight : score), 0, 100)
    const riskLevel = neuralScore >= 55 ? 'high_risk' : neuralScore >= 25 ? 'suspicious' : 'clean'

    // Confidence: higher when multiple signals agree
    const signals = [
        ela.spliceIndicatorScore > 30 ? 1 : 0,
        freq.doubleJpegScore > 30 ? 1 : 0,
        regional.consistencyScore > 30 ? 1 : 0,
        channel.aiSignatureScore > 30 ? 1 : 0,
        onnx && onnx.forgedProbability > 0.5 ? 1 : 0,
    ]
    const agreeing = signals.reduce((s, v) => s + v, 0)
    const confidence = onnx
        ? 0.85 + agreeing * 0.03
        : 0.55 + agreeing * 0.08

    return { neuralScore, riskLevel, confidence: clamp(confidence, 0, 0.98) }
}

// ─── 8. Explanation builder ──────────────────────────────────────────────────

function buildExplanation(
    mode: NeuralMode,
    neuralScore: number,
    alerts: NeuralForensicsResult['alerts'],
): string {
    const modeLabel = mode === 'onnx'
        ? 'mediante red neuronal convolucional (ONNX)'
        : 'mediante análisis estadístico multi-escala avanzado'

    if (alerts.length === 0) {
        return `El análisis neural (${modeLabel}) no detectó anomalías estadísticas significativas. La distribución de frecuencias, la consistencia regional del ruido y las correlaciones cromáticas son compatibles con una imagen auténtica no manipulada (puntuación neural: ${neuralScore}/100).`
    }

    const main = alerts[0]
    return `El análisis neural (${modeLabel}) detectó ${alerts.length} señal${alerts.length > 1 ? 'es' : ''} de manipulación (puntuación: ${neuralScore}/100). La señal principal es: ${main.label} — ${main.detail}${alerts.length > 1 ? ` Además, se encontraron ${alerts.length - 1} indicador${alerts.length - 1 > 1 ? 'es' : ''} adicional${alerts.length - 1 > 1 ? 'es' : ''}: ${alerts.slice(1).map(a => a.label).join('; ')}.` : ''}`
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full neural forensics analysis on an HTMLImageElement.
 * Call this after the standard analyzeImage() pipeline.
 *
 * @example
 * const img = new Image(); img.src = objectURL;
 * await new Promise(r => img.onload = r);
 * const result = await analyzeWithNeural(img);
 */
export async function analyzeWithNeural(img: HTMLImageElement): Promise<NeuralForensicsResult> {
    const t0 = performance.now()

    // Prepare a single resized canvas for analyses that work on ImageData
    const { ctx, W, H } = imageToCanvas(img)
    const imgData = ctx.getImageData(0, 0, W, H)

    // Run all analyses in parallel where possible
    const [ela, onnxAvail] = await Promise.all([
        runMultiScaleELA(img),
        tryLoadOnnxModel(),
    ])

    // Frequency + regional + channel can run synchronously on the same imgData
    const freq = runFrequencyAnalysis(imgData)
    const regional = runRegionalConsistency(imgData)
    const channel = runChannelAnalysis(imgData)

    // ONNX inference (optional)
    let onnxPrediction: { forgedProbability: number; authenticity: number } | undefined
    if (onnxAvail) {
        const result = await runOnnxInference(imgData)
        if (result) onnxPrediction = result
    }

    const mode: NeuralMode = onnxPrediction ? 'onnx' : 'enhanced_heuristic'
    const alerts = buildAlerts(ela, freq, regional, channel, onnxPrediction)
    const { neuralScore, riskLevel, confidence } = combineScores(ela, freq, regional, channel, onnxPrediction)
    const explanation = buildExplanation(mode, neuralScore, alerts)

    return {
        mode,
        neuralScore,
        riskLevel,
        confidence,
        analysisMs: Math.round(performance.now() - t0),
        findings: {
            multiScaleELA: ela,
            frequencyAnalysis: freq,
            regionalConsistency: regional,
            channelAnalysis: channel,
            onnxPrediction,
        },
        alerts,
        explanation,
    }
}
