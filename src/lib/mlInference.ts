/**
 * Deep-Check · ONNX ML Inference (client-side)
 * =============================================
 * Loads biometric-fraud-detector.onnx via onnxruntime-web and runs
 * inference to classify typing sessions as human vs bot.
 *
 * Uses lazy loading so the model is only fetched when needed.
 * Safe to call from client components — never runs server-side.
 */

'use client'

import { FEATURE_NAMES, N_FEATURES, normaliseFeatures } from './biometricFeatures'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScalerParams {
    features: string[]
    mean:     number[]
    std:      number[]
}

export interface MLInferenceResult {
    botProbability:  number   // 0.0 – 1.0  (>0.5 = likely bot)
    humanProbability: number  // 1 - botProbability
    aiScore:         number   // 0 – 100 (higher = more suspicious)
    confidence:      'high' | 'medium' | 'low'
    dominant:        'bot' | 'human'
    features:        Record<string, number>  // raw feature values for display
}

// ─── Module-level singletons (lazily initialised) ─────────────────────────────

let session: any = null
let scalerParams: ScalerParams | null = null
let loadPromise: Promise<void> | null = null

const MODEL_URL  = '/models/biometric-fraud-detector.onnx'
const SCALER_URL = '/models/feature_scaler.json'

// ─── Loader ───────────────────────────────────────────────────────────────────

async function ensureLoaded(): Promise<void> {
    if (session && scalerParams) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
        // Dynamic import so onnxruntime-web is only bundled client-side
        const ort = await import('onnxruntime-web')

        // Configure WASM paths (served from Next.js public dir)
        ort.env.wasm.wasmPaths = '/'

        // Load scaler parameters
        const scalerResp = await fetch(SCALER_URL)
        scalerParams = await scalerResp.json() as ScalerParams

        // Create inference session
        session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        })

        console.debug('[DeepCheck ML] Model loaded. Inputs:', session.inputNames, 'Outputs:', session.outputNames)
    })()

    return loadPromise
}

// ─── Main inference function ──────────────────────────────────────────────────

/**
 * Run the biometric fraud detector on a raw feature vector.
 * @param rawFeatures Float32Array of 18 raw (un-normalised) feature values
 *                    in the order defined by FEATURE_NAMES
 * @returns MLInferenceResult with probability and interpreted scores
 */
export async function runBotDetection(
    rawFeatures: Float32Array
): Promise<MLInferenceResult> {
    await ensureLoaded()

    if (!session || !scalerParams) {
        throw new Error('[DeepCheck ML] Model not loaded')
    }

    const ort = await import('onnxruntime-web')

    // Normalise features using scaler params from training
    const normalised = normaliseFeatures(rawFeatures, scalerParams.mean, scalerParams.std)

    // Create input tensor: shape [1, 18]
    const inputTensor = new ort.Tensor('float32', normalised, [1, N_FEATURES])
    const inputName = session.inputNames[0]

    // Run inference
    const results = await session.run({ [inputName]: inputTensor })

    // Extract probability output
    // onnxmltools-exported XGBoost models output a sequence of maps: [{0: p_human, 1: p_bot}]
    let botProb = 0.5
    const outputNames = session.outputNames as string[]

    for (const outName of outputNames) {
        const out = results[outName]
        if (!out) continue

        // Sequence of maps — typical onnxmltools XGBoost output
        const outData = out.data as unknown
        if (Array.isArray(outData) && outData.length > 0) {
            const entry = outData[0] as Record<string | number, number>
            const p = entry[1] ?? entry['1']
            if (p !== undefined) { botProb = Number(p); break }
        }

        // Dense tensor [1, 2]: [p_human, p_bot]
        if (out.dims && out.dims.length === 2 && Number(out.dims[1]) === 2) {
            const d = out.data as Float32Array
            botProb = d[1]; break
        }

        // Single probability value
        if (out.dims && Number(out.dims[0]) === 1) {
            const d = out.data as Float32Array
            botProb = d[0]; break
        }
    }

    // Clamp to [0,1]
    botProb = Math.max(0, Math.min(1, botProb))

    const humanProb = 1 - botProb
    const aiScore   = Math.round(botProb * 100)

    const confidence: MLInferenceResult['confidence'] =
        Math.abs(botProb - 0.5) > 0.35 ? 'high' :
        Math.abs(botProb - 0.5) > 0.15 ? 'medium' : 'low'

    // Build feature map for display
    const featureMap: Record<string, number> = {}
    FEATURE_NAMES.forEach((name, i) => {
        featureMap[name] = parseFloat(rawFeatures[i].toFixed(3))
    })

    return {
        botProbability:   botProb,
        humanProbability: humanProb,
        aiScore,
        confidence,
        dominant: botProb >= 0.5 ? 'bot' : 'human',
        features: featureMap,
    }
}

/**
 * Warmup the model silently (call on component mount so first inference is fast).
 * Uses a zero-vector — result is discarded.
 */
export async function warmupModel(): Promise<void> {
    try {
        await ensureLoaded()
        const zeros = new Float32Array(N_FEATURES)
        await runBotDetection(zeros)
        console.debug('[DeepCheck ML] Model warmed up')
    } catch {
        // Non-fatal: if warmup fails, inference will still work (just with cold start latency)
    }
}

/**
 * Check if WebAssembly is available and the model can be loaded.
 */
export function isMLAvailable(): boolean {
    if (typeof window === 'undefined') return false
    return typeof WebAssembly !== 'undefined'
}
