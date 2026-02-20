/**
 * Deep-Check · Biometric Feature Extractor
 * ==========================================
 * Converts raw session data (flight times, hold times, etc.) into a
 * normalised Float32Array of 18 features ready for ONNX inference.
 *
 * Feature order MUST match the training script (generate_and_train.py).
 */

// ─── Feature names (must match training script order) ─────────────────────────

export const FEATURE_NAMES = [
    'flight_mean', 'flight_std', 'hold_mean', 'hold_std',
    'flight_skewness', 'flight_kurtosis', 'flight_entropy', 'hold_entropy',
    'periodicity_score', 'velocity_gradient', 'fatigue_rate', 'rhythm_consistency',
    'impossible_fast_ratio', 'digram_cv_mean',
    'backspace_latency_std', 'backspace_count_ratio',
    'burst_count_per_100k', 'session_wpm',
] as const

export type FeatureName = typeof FEATURE_NAMES[number]
export const N_FEATURES = FEATURE_NAMES.length  // 18

// ─── Raw session data (collected in CodeEditor.tsx) ──────────────────────────

export interface RawSessionData {
    flightTimes:        number[]   // ms — inter-key flight times (filtered 10-2000ms)
    holdTimes:          number[]   // ms — key hold durations (filtered 10-500ms)
    backspaceTimes:     number[]   // ms — latency from prev char to backspace
    totalKeystrokes:    number     // all key events
    totalBackspaces:    number
    burstCount:         number     // number of burst windows detected
    digrams:            Record<string, number[]>  // digram pair → flight time array
    sessionDurationMs:  number
}

export interface FeatureVector {
    raw:        Record<FeatureName, number>
    normalised: Float32Array
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
    if (arr.length === 0) return 0
    return arr.reduce((a, b) => a + b, 0) / arr.length
}

function std(arr: number[], m?: number): number {
    if (arr.length < 2) return 0
    const mu = m ?? mean(arr)
    return Math.sqrt(arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length)
}

function skewness(arr: number[]): number {
    if (arr.length < 3) return 0
    const mu = mean(arr)
    const s  = std(arr, mu)
    if (s === 0) return 0
    const n = arr.length
    return arr.reduce((a, b) => a + ((b - mu) / s) ** 3, 0) / n
}

function kurtosisExcess(arr: number[]): number {
    if (arr.length < 4) return 0
    const mu = mean(arr)
    const s  = std(arr, mu)
    if (s === 0) return 0
    const n = arr.length
    return arr.reduce((a, b) => a + ((b - mu) / s) ** 4, 0) / n - 3
}

function shannonEntropy(arr: number[]): number {
    if (arr.length === 0) return 0
    const min = Math.min(...arr), max = Math.max(...arr)
    const B = 10
    const bw = (max - min) / B || 1
    const counts = new Array(B).fill(0)
    arr.forEach(v => { const i = Math.min(B - 1, Math.floor((v - min) / bw)); counts[i]++ })
    return counts.reduce((e, c) => {
        if (c === 0) return e
        const p = c / arr.length
        return e - p * Math.log2(p)
    }, 0)
}

/** Dominant spectral power as % (0-100) — simplified DFT over flight windows */
function periodicityScore(arr: number[]): number {
    if (arr.length < 8) return 0
    const N = Math.min(64, arr.length)
    const slice = arr.slice(-N)
    const mu = mean(slice)
    const centred = slice.map(v => v - mu)
    let maxPow = 0, totalPow = 0
    for (let k = 1; k < N / 2; k++) {
        let re = 0, im = 0
        for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * k * n / N
            re += centred[n] * Math.cos(angle)
            im += centred[n] * Math.sin(angle)
        }
        const pow = re * re + im * im
        totalPow += pow
        if (pow > maxPow) maxPow = pow
    }
    return totalPow === 0 ? 0 : (maxPow / totalPow) * 100
}

/** Ratio of first-half mean vs second-half mean (acceleration / deceleration) */
function velocityGradient(arr: number[]): number {
    if (arr.length < 10) return 0
    const mid  = Math.floor(arr.length / 2)
    const mF   = mean(arr.slice(0, mid))
    const mS   = mean(arr.slice(mid))
    if (mF === 0) return 0
    return (mS - mF) / mF   // positive = slowing down, negative = speeding up
}

/** Linear regression slope (ms per keystroke) */
function fatigueRate(arr: number[]): number {
    if (arr.length < 10) return 0
    const n = arr.length
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    for (let i = 0; i < n; i++) {
        sumX  += i
        sumY  += arr[i]
        sumXY += i * arr[i]
        sumXX += i * i
    }
    const denom = n * sumXX - sumX * sumX
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

/** Std of per-window-of-20 means — measures rhythm variability */
function rhythmConsistency(arr: number[]): number {
    if (arr.length < 20) return 0
    const windows: number[] = []
    for (let i = 0; i + 20 <= arr.length; i += 10) {
        windows.push(mean(arr.slice(i, i + 20)))
    }
    return std(windows)
}

/** Fraction of flight times below 12ms (neuromotor minimum) */
function impossibleFastRatio(arr: number[], raw: number[]): number {
    if (raw.length === 0) return 0
    return raw.filter(v => v > 0 && v < 12).length / raw.length
}

/** Mean coefficient of variation across digram pairs */
function digramCVMean(digrams: Record<string, number[]>): number {
    const entries = Object.values(digrams).filter(v => v.length >= 3)
    if (entries.length === 0) return 0.5   // default — no data
    const cvs = entries.map(v => {
        const mu = mean(v)
        if (mu === 0) return 0
        return std(v, mu) / mu
    })
    return mean(cvs)
}

// ─── Main extractor ────────────────────────────────────────────────────────────

export function extractFeatureVector(data: RawSessionData): FeatureVector {
    const { flightTimes, holdTimes, backspaceTimes, totalKeystrokes,
            totalBackspaces, burstCount, digrams, sessionDurationMs } = data

    const fMean  = mean(flightTimes)
    const fStd   = std(flightTimes, fMean)
    const hMean  = mean(holdTimes)
    const hStd   = std(holdTimes, hMean)

    // WPM: assume ~5 chars per word, session in minutes
    const sessionMinutes = sessionDurationMs / 60000
    const sessionWpm = sessionMinutes > 0
        ? (totalKeystrokes / 5) / sessionMinutes
        : 0

    const raw: Record<FeatureName, number> = {
        flight_mean:           fMean,
        flight_std:            fStd,
        hold_mean:             hMean,
        hold_std:              hStd,
        flight_skewness:       skewness(flightTimes),
        flight_kurtosis:       kurtosisExcess(flightTimes),
        flight_entropy:        shannonEntropy(flightTimes),
        hold_entropy:          shannonEntropy(holdTimes),
        periodicity_score:     periodicityScore(flightTimes),
        velocity_gradient:     velocityGradient(flightTimes),
        fatigue_rate:          fatigueRate(flightTimes),
        rhythm_consistency:    rhythmConsistency(flightTimes),
        impossible_fast_ratio: impossibleFastRatio(flightTimes, flightTimes),
        digram_cv_mean:        digramCVMean(digrams),
        backspace_latency_std: std(backspaceTimes),
        backspace_count_ratio: totalKeystrokes > 0 ? totalBackspaces / totalKeystrokes : 0,
        burst_count_per_100k:  totalKeystrokes > 0 ? (burstCount / totalKeystrokes) * 100000 : 0,
        session_wpm:           sessionWpm,
    }

    // Normalise using scaler params (loaded from public/models/feature_scaler.json)
    // At runtime these are injected from the JSON file — see mlInference.ts
    const normalised = new Float32Array(N_FEATURES)
    FEATURE_NAMES.forEach((name, i) => { normalised[i] = raw[name] })

    return { raw, normalised }
}

/**
 * Normalise a raw feature vector using mean/std from feature_scaler.json.
 * Call this AFTER loading the scaler params.
 */
export function normaliseFeatures(
    raw: Float32Array,
    scalerMean: number[],
    scalerStd:  number[]
): Float32Array {
    const out = new Float32Array(N_FEATURES)
    for (let i = 0; i < N_FEATURES; i++) {
        const s = scalerStd[i] || 1
        out[i] = (raw[i] - scalerMean[i]) / s
    }
    return out
}
