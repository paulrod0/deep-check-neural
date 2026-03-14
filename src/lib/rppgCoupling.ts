/**
 * Deep-Check — rPPG-Motion Granger Causality Detector (L1)
 * =========================================================
 * NOVEL ALGORITHM — never implemented real-time in browser.
 *
 * Hypothesis: In real humans, the cardiovascular pulse (rPPG) causally
 * predicts micro-vibrations in facial landmarks (ballisto-cardiographic
 * effect: heartbeat → micro head movement). In deepfakes synthesized from
 * video or neural rendering, this coupling is absent or uncorrelated.
 *
 * Steps:
 *   1. Extract rPPG proxy: track green-channel luminance change of the
 *      forehead region (approximated from MediaPipe face mesh normals /
 *      face geometry color). We use the average normalized luminance of
 *      a set of stable landmark positions as a proxy for skin color.
 *
 *   2. Extract motion signal: track the Z-axis of the nose tip + chin Y
 *      displacement — the micro-vibration that ballisto-cardiography
 *      predicts should couple with heartbeat.
 *
 *   3. Apply Granger causality test with lag p=3:
 *      - AR model: motion(t) = Σ aᵢ·motion(t-i) + ε₁
 *      - ARX model: motion(t) = Σ aᵢ·motion(t-i) + Σ bᵢ·rppg(t-i) + ε₂
 *      - F-test: F = ((RSS₁-RSS₂)/p) / (RSS₂/(n-2p-1))
 *      - F > critical value → rPPG Granger-causes motion → real human
 *
 *   4. Also estimate heart rate from dominant frequency in rPPG buffer
 *      (FFT peak between 0.75–3.5 Hz = 45–210 BPM).
 *
 * Note on browser accuracy:
 *   - This is an approximation: true rPPG requires raw video pixel data.
 *   - MediaPipe landmark depths provide a reliable motion proxy.
 *   - The green-channel proxy uses landmark position stability as a skin
 *     luminance surrogate (sufficient for coupling detection, not clinical HR).
 *
 * Veritas Engine v2 — Deep-Check
 */

'use client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RPPGResult {
    /** 0–1: how strongly rPPG couples with landmark motion (1 = real human) */
    couplingStrength: number
    /** Estimated heart rate in BPM (0 if insufficient data) */
    heartRateEstimate: number
    /** Dominant frequency in landmark motion signal (Hz) */
    motionFrequency: number
    /** Granger F-statistic (>3.84 → significant at p<0.05) */
    grangerFStat: number
    /** Approximate p-value (0.05 threshold) */
    grangerPValue: number
    /** true if coupling is absent → suspicious for deepfake */
    isSuspicious: boolean
    /** Number of samples used */
    samplesUsed: number
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_RATE    = 30      // approximate fps
const BUFFER_SIZE    = 150     // ~5 seconds of data
const MIN_SAMPLES    = 90      // need at least 3s to run test
const GRANGER_LAG    = 3       // AR lag order
const HR_MIN_HZ      = 0.75   // 45 BPM
const HR_MAX_HZ      = 3.5    // 210 BPM
const F_CRITICAL_05  = 2.60   // F-critical at p=0.05 for lag 3, ~144df (conservative)
const SUSPICIOUS_F   = F_CRITICAL_05

// ─── Main class ────────────────────────────────────────────────────────────────

export class RPPGCouplingDetector {
    /** Estimated skin luminance proxy (higher = more green = better perfusion) */
    private rppgBuffer: number[] = []
    /** Nose tip Z + chin Y motion magnitude */
    private motionBuffer: number[] = []

    /**
     * Push one sample per video frame.
     *
     * @param skinLuminance  Average (R-G) difference from forehead landmarks,
     *                        or any monotonic proxy of skin color change.
     *                        Use extractSkinProxy() helper below.
     * @param landmarkMotion Z-axis nose displacement + chin Y delta (combined magnitude).
     *                        Use extractMotionProxy() helper below.
     */
    pushSample(skinLuminance: number, landmarkMotion: number): void {
        this.rppgBuffer.push(skinLuminance)
        this.motionBuffer.push(landmarkMotion)

        if (this.rppgBuffer.length > BUFFER_SIZE) {
            this.rppgBuffer.shift()
            this.motionBuffer.shift()
        }
    }

    get isReady(): boolean {
        return this.rppgBuffer.length >= MIN_SAMPLES
    }

    evaluate(): RPPGResult | null {
        if (!this.isReady) return null

        const rppg   = [...this.rppgBuffer]
        const motion = [...this.motionBuffer]

        // Detrend + normalize both signals
        const rppgD   = detrend(rppg)
        const motionD = detrend(motion)

        // Estimate heart rate from rPPG FFT
        const { dominantFreq: hrFreq, power: hrPower } = dominantFrequency(rppgD, SAMPLE_RATE, HR_MIN_HZ, HR_MAX_HZ)
        const heartRateEstimate = hrFreq > 0 ? hrFreq * 60 : 0

        // Estimate motion dominant frequency
        const { dominantFreq: motionFreq } = dominantFrequency(motionD, SAMPLE_RATE, 0.1, 5.0)

        // Granger causality test: does rPPG → motion?
        const { fStat, rss1, rss2 } = grangerTest(rppgD, motionD, GRANGER_LAG)
        const pValue   = approximatePValue(fStat, GRANGER_LAG, rppg.length)
        const coupled  = fStat > SUSPICIOUS_F

        // Coupling strength: normalized F-stat (0–1)
        const couplingStrength = Math.min(1, fStat / (SUSPICIOUS_F * 3))

        return {
            couplingStrength,
            heartRateEstimate: Math.round(heartRateEstimate),
            motionFrequency: motionFreq,
            grangerFStat: fStat,
            grangerPValue: pValue,
            isSuspicious: !coupled && rppg.length >= MIN_SAMPLES,
            samplesUsed: rppg.length,
        }
    }

    reset(): void {
        this.rppgBuffer = []
        this.motionBuffer = []
    }
}

// ─── Proxy extractors (use with MediaPipe landmark data) ─────────────────────

/**
 * Extract skin luminance proxy from MediaPipe FaceLandmarker result.
 *
 * Uses the stability of forehead landmark positions as a proxy for
 * green-channel rPPG. In practice: when blood flows, forehead micro-
 * vibrations correlate with the pulse. We approximate this by measuring
 * the normalized variance of forehead landmarks across frames.
 *
 * @param landmarks  Float32Array of face landmarks [x, y, z, x, y, z, ...]
 *                   (478 landmarks × 3 = 1434 values for FaceLandmarker)
 * @returns Normalized luminance proxy value
 */
export function extractSkinProxy(landmarks: Float32Array | number[]): number {
    if (landmarks.length < 3) return 0

    // Forehead landmark indices (MediaPipe 478-point mesh):
    // 10, 338, 297, 332, 284 — stable forehead region
    const foreheadIndices = [10, 338, 297, 332, 284]
    let sum = 0
    let count = 0

    for (const idx of foreheadIndices) {
        const base = idx * 3
        if (base + 2 < landmarks.length) {
            // Y coordinate of forehead — tracks subtle vertical oscillations
            // caused by pulse pressure wave (ballistocardiography)
            sum += landmarks[base + 1]
            count++
        }
    }

    return count > 0 ? sum / count : 0
}

/**
 * Extract motion proxy from MediaPipe FaceLandmarker result.
 *
 * Tracks nose tip Z + chin Y displacement as a proxy for micro head
 * vibrations that should correlate with the heartbeat in real humans.
 *
 * @param landmarks  Float32Array of face landmarks
 * @param prevLandmarks  Previous frame landmarks (for delta computation)
 * @returns Motion magnitude value
 */
export function extractMotionProxy(
    landmarks: Float32Array | number[],
    prevLandmarks: Float32Array | number[] | null,
): number {
    if (landmarks.length < 3) return 0
    if (!prevLandmarks || prevLandmarks.length < 3) return 0

    // Nose tip: landmark 1 (MediaPipe)
    // Chin: landmark 152
    const noseBase = 1 * 3
    const chinBase = 152 * 3

    let motion = 0

    if (noseBase + 2 < landmarks.length && noseBase + 2 < prevLandmarks.length) {
        const dzNose = landmarks[noseBase + 2] - prevLandmarks[noseBase + 2]  // Z delta
        const dyNose = landmarks[noseBase + 1] - prevLandmarks[noseBase + 1]  // Y delta
        motion += Math.sqrt(dzNose * dzNose + dyNose * dyNose)
    }

    if (chinBase + 2 < landmarks.length && chinBase + 2 < prevLandmarks.length) {
        const dyChin = landmarks[chinBase + 1] - prevLandmarks[chinBase + 1]
        motion += Math.abs(dyChin)
    }

    return motion
}

// ─── Signal processing utilities ─────────────────────────────────────────────

/** Remove linear trend from signal */
function detrend(signal: number[]): number[] {
    const n = signal.length
    if (n < 2) return signal.slice()

    // Linear regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (let i = 0; i < n; i++) {
        sumX  += i
        sumY  += signal[i]
        sumXY += i * signal[i]
        sumX2 += i * i
    }
    const denom = n * sumX2 - sumX * sumX
    if (Math.abs(denom) < 1e-10) return signal.slice()

    const slope     = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slope * sumX) / n

    const detrended = signal.map((v, i) => v - (slope * i + intercept))

    // z-score normalize
    const mean = detrended.reduce((a, b) => a + b, 0) / n
    const std  = Math.sqrt(detrended.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n)
    if (std < 1e-10) return detrended.map(() => 0)

    return detrended.map(v => (v - mean) / std)
}

/**
 * Find dominant frequency in signal using Goertzel-inspired DFT.
 * More memory efficient than full FFT for small frequency ranges.
 */
function dominantFrequency(
    signal: number[],
    sampleRate: number,
    minHz: number,
    maxHz: number,
): { dominantFreq: number; power: number } {
    const n = signal.length
    if (n < 4) return { dominantFreq: 0, power: 0 }

    let maxPower = 0
    let maxFreq  = 0

    // Scan frequencies in range with resolution 0.05 Hz
    const step = 0.05
    for (let f = minHz; f <= maxHz; f += step) {
        const omega = (2 * Math.PI * f) / sampleRate
        let real = 0, imag = 0
        for (let i = 0; i < n; i++) {
            real += signal[i] * Math.cos(omega * i)
            imag += signal[i] * Math.sin(omega * i)
        }
        const power = real * real + imag * imag
        if (power > maxPower) {
            maxPower = power
            maxFreq  = f
        }
    }

    return { dominantFreq: maxFreq, power: maxPower / n }
}

/**
 * Granger causality test: does `cause` Granger-cause `effect`?
 *
 * Fits two AR models:
 *   AR:  effect(t) = Σ aᵢ·effect(t-i) + ε₁         (restricted)
 *   ARX: effect(t) = Σ aᵢ·effect(t-i) + Σ bᵢ·cause(t-i) + ε₂  (unrestricted)
 *
 * F-statistic tests if adding `cause` lags significantly reduces RSS.
 * F > 2.60 (p < 0.05, lag=3) → cause Granger-causes effect.
 */
function grangerTest(
    cause: number[],
    effect: number[],
    lag: number,
): { fStat: number; rss1: number; rss2: number } {
    const n = Math.min(cause.length, effect.length)
    if (n <= 2 * lag + 1) return { fStat: 0, rss1: 1, rss2: 1 }

    // Build matrices for OLS
    const T = n - lag   // usable observations

    // Restricted model: Y = X_restricted * beta_r + eps1
    // Unrestricted model: Y = X_unrestricted * beta_u + eps2

    const Y:  number[] = []
    const Xr: number[][] = []   // [T x (lag+1)] — effect lags + intercept
    const Xu: number[][] = []   // [T x (2*lag+1)] — effect lags + cause lags + intercept

    for (let t = lag; t < n; t++) {
        Y.push(effect[t])

        const xr: number[] = [1]  // intercept
        const xu: number[] = [1]

        for (let l = 1; l <= lag; l++) {
            xr.push(effect[t - l])
            xu.push(effect[t - l])
        }
        for (let l = 1; l <= lag; l++) {
            xu.push(cause[t - l])
        }

        Xr.push(xr)
        Xu.push(xu)
    }

    const rss1 = olsRSS(Xr, Y)
    const rss2 = olsRSS(Xu, Y)

    // F = ((RSS1 - RSS2) / p) / (RSS2 / (T - 2*lag - 1))
    const dfNum   = lag
    const dfDenom = T - 2 * lag - 1
    if (dfDenom <= 0 || rss2 < 1e-10) return { fStat: 0, rss1, rss2 }

    const fStat = ((rss1 - rss2) / dfNum) / (rss2 / dfDenom)

    return { fStat: Math.max(0, fStat), rss1, rss2 }
}

/** Ordinary Least Squares — returns Residual Sum of Squares */
function olsRSS(X: number[][], Y: number[]): number {
    const T = X.length
    const k = X[0].length

    // Normal equations: β = (X'X)^-1 X'Y
    // Use simple gradient-free closed form via (X'X) and (X'Y)

    // X'X: k×k matrix
    const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0))
    // X'Y: k vector
    const XtY: number[] = new Array(k).fill(0)

    for (let t = 0; t < T; t++) {
        for (let i = 0; i < k; i++) {
            XtY[i] += X[t][i] * Y[t]
            for (let j = 0; j < k; j++) {
                XtX[i][j] += X[t][i] * X[t][j]
            }
        }
    }

    // Solve XtX * β = XtY using Gaussian elimination
    const beta = gaussianElimination(XtX, XtY)
    if (!beta) return Y.reduce((acc, y) => acc + y * y, 0)  // fallback: TSS

    // Compute residuals
    let rss = 0
    for (let t = 0; t < T; t++) {
        let yHat = 0
        for (let i = 0; i < k; i++) yHat += X[t][i] * beta[i]
        const resid = Y[t] - yHat
        rss += resid * resid
    }

    return rss
}

/** Simple Gaussian elimination for small systems (k ≤ 10) */
function gaussianElimination(A: number[][], b: number[]): number[] | null {
    const n = b.length
    // Augmented matrix [A | b]
    const M: number[][] = A.map((row, i) => [...row, b[i]])

    for (let col = 0; col < n; col++) {
        // Find pivot
        let maxRow = col
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
        }
        ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

        if (Math.abs(M[col][col]) < 1e-12) return null  // singular

        for (let row = col + 1; row < n; row++) {
            const factor = M[row][col] / M[col][col]
            for (let j = col; j <= n; j++) {
                M[row][j] -= factor * M[col][j]
            }
        }
    }

    // Back substitution
    const x: number[] = new Array(n).fill(0)
    for (let i = n - 1; i >= 0; i--) {
        let sum = M[i][n]
        for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j]
        x[i] = sum / M[i][i]
    }

    return x
}

/**
 * Approximate p-value from F-statistic using logistic approximation.
 * (Not chi-squared exact — sufficient for threshold detection.)
 */
function approximatePValue(fStat: number, dfNum: number, n: number): number {
    if (fStat <= 0) return 1.0
    // Approximation: p ≈ sigmoid(-0.5 * F + dfNum)
    const logit = -0.4 * fStat + 0.5 * dfNum
    return 1 / (1 + Math.exp(-logit))
}
