/**
 * Deep-Check - Deepfake Detection CNN Inference (client-side)
 * ===========================================================
 * Loads deepfake_detector.onnx via onnxruntime-web and runs
 * inference to classify live video feeds as:
 *   - real_human (0)
 *   - deepfake_video (1)
 *   - photo_replay (2)
 *
 * Input: Temporal buffer of MediaPipe FaceLandmarker outputs
 *        (52 blendshapes + 4 iris + 3 depth = 59 features x 90 frames)
 *
 * Uses lazy loading so the model is only fetched when needed.
 * Safe to call from client components - never runs server-side.
 *
 * Veritas Engine v5 - Deep-Check
 */

'use client'

// --- Types -------------------------------------------------------------------

export interface DeepfakeResult {
    /** Predicted class: 'real_human' | 'deepfake_video' | 'photo_replay' */
    prediction: 'real_human' | 'deepfake_video' | 'photo_replay'
    /** Per-class probabilities [0-1] */
    probabilities: {
        real_human: number
        deepfake_video: number
        photo_replay: number
    }
    /** Overall deepfake risk score 0-100 (higher = more suspicious) */
    riskScore: number
    /** Confidence in the prediction */
    confidence: 'high' | 'medium' | 'low'
    /** Number of frames in the input buffer */
    framesUsed: number
}

/** A single frame of MediaPipe FaceLandmarker output for the deepfake buffer */
export interface DeepfakeFrame {
    /** 52 blendshape scores (in standard MediaPipe order) */
    blendshapes: number[]
    /** Iris positions: [left_x, left_y, right_x, right_y] normalized [0,1] */
    iris: [number, number, number, number]
    /** Depth features: [nose_z, left_iris_z, right_iris_z] */
    depth: [number, number, number]
}

// --- Constants ---------------------------------------------------------------

const SEQ_LEN = 90          // Must match training script
const N_BLENDSHAPES = 52
const N_IRIS = 4
const N_DEPTH = 3
const N_FEATURES = N_BLENDSHAPES + N_IRIS + N_DEPTH  // 59

const CLASS_NAMES = ['real_human', 'deepfake_video', 'photo_replay'] as const

const MODEL_URL = '/models/deepfake/deepfake_detector.onnx'

// --- Module-level singletons (lazily initialised) ----------------------------

let session: import('onnxruntime-web').InferenceSession | null = null
let loadPromise: Promise<void> | null = null

// --- Loader ------------------------------------------------------------------

async function ensureLoaded(): Promise<void> {
    if (session) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
        const ort = await import('onnxruntime-web')
        ort.env.wasm.wasmPaths = '/'

        session = await ort.InferenceSession.create(MODEL_URL, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        })

        console.debug(
            '[DeepCheck Deepfake] Model loaded.',
            'Inputs:', session.inputNames,
            'Outputs:', session.outputNames
        )
    })()

    return loadPromise
}

// --- Frame Buffer ------------------------------------------------------------

/**
 * Circular buffer that accumulates MediaPipe frames for temporal analysis.
 * Call `pushFrame()` on each detection tick (~15fps).
 * Call `getSequence()` to get the [SEQ_LEN, N_FEATURES] tensor when ready.
 */
export class DeepfakeFrameBuffer {
    private buffer: DeepfakeFrame[] = []
    private readonly maxLen: number

    constructor(maxLen: number = SEQ_LEN) {
        this.maxLen = maxLen
    }

    /** Add a new frame to the buffer */
    pushFrame(frame: DeepfakeFrame): void {
        this.buffer.push(frame)
        if (this.buffer.length > this.maxLen) {
            this.buffer.shift()
        }
    }

    /** Whether the buffer has enough frames for inference */
    get isReady(): boolean {
        return this.buffer.length >= this.maxLen
    }

    /** Current number of frames */
    get length(): number {
        return this.buffer.length
    }

    /** Reset the buffer */
    clear(): void {
        this.buffer = []
    }

    /**
     * Convert buffer to Float32Array [SEQ_LEN, N_FEATURES].
     * If buffer has fewer than SEQ_LEN frames, pads with zeros at the start.
     */
    toTensor(): Float32Array {
        const tensor = new Float32Array(this.maxLen * N_FEATURES)
        const startIdx = Math.max(0, this.maxLen - this.buffer.length)

        for (let i = 0; i < this.buffer.length && i < this.maxLen; i++) {
            const frame = this.buffer[this.buffer.length - Math.min(this.buffer.length, this.maxLen) + i]
            const offset = (startIdx + i) * N_FEATURES

            // Blendshapes (52 values)
            for (let j = 0; j < N_BLENDSHAPES; j++) {
                tensor[offset + j] = frame.blendshapes[j] ?? 0
            }
            // Iris (4 values)
            for (let j = 0; j < N_IRIS; j++) {
                tensor[offset + N_BLENDSHAPES + j] = frame.iris[j] ?? 0.5
            }
            // Depth (3 values)
            for (let j = 0; j < N_DEPTH; j++) {
                tensor[offset + N_BLENDSHAPES + N_IRIS + j] = frame.depth[j] ?? 0
            }
        }

        return tensor
    }
}

// --- Inference ---------------------------------------------------------------

/**
 * Run deepfake detection on a buffer of MediaPipe frames.
 *
 * @param buffer - DeepfakeFrameBuffer with accumulated frames
 * @returns DeepfakeResult with prediction and probabilities
 */
export async function runDeepfakeDetection(
    buffer: DeepfakeFrameBuffer
): Promise<DeepfakeResult> {
    await ensureLoaded()

    if (!session) {
        throw new Error('[DeepCheck Deepfake] Model not loaded')
    }

    const ort = await import('onnxruntime-web')

    // Build input tensor [1, SEQ_LEN, N_FEATURES]
    const tensorData = buffer.toTensor()
    const inputTensor = new ort.Tensor('float32', tensorData, [1, SEQ_LEN, N_FEATURES])
    const inputName = session.inputNames[0]

    // Run inference
    const results = await session.run({ [inputName]: inputTensor })

    // Extract logits from output
    const outputName = session.outputNames[0]
    const output = results[outputName]
    if (!output) {
        throw new Error('[DeepCheck Deepfake] No output from model')
    }

    const logits = output.data as Float32Array  // [1, 3]

    // Softmax to get probabilities
    const maxLogit = Math.max(logits[0], logits[1], logits[2])
    const expSum = Math.exp(logits[0] - maxLogit) +
                   Math.exp(logits[1] - maxLogit) +
                   Math.exp(logits[2] - maxLogit)
    const probs = [
        Math.exp(logits[0] - maxLogit) / expSum,
        Math.exp(logits[1] - maxLogit) / expSum,
        Math.exp(logits[2] - maxLogit) / expSum,
    ]

    // Find prediction
    const maxIdx = probs[0] >= probs[1] && probs[0] >= probs[2] ? 0
                 : probs[1] >= probs[2] ? 1 : 2
    const prediction = CLASS_NAMES[maxIdx]
    const maxProb = probs[maxIdx]

    // Risk score: probability of NOT being real_human (0-100)
    const riskScore = Math.round((1 - probs[0]) * 100)

    // Confidence
    const confidence: DeepfakeResult['confidence'] =
        maxProb > 0.85 ? 'high' :
        maxProb > 0.60 ? 'medium' : 'low'

    return {
        prediction,
        probabilities: {
            real_human: Math.round(probs[0] * 10000) / 10000,
            deepfake_video: Math.round(probs[1] * 10000) / 10000,
            photo_replay: Math.round(probs[2] * 10000) / 10000,
        },
        riskScore,
        confidence,
        framesUsed: buffer.length,
    }
}

/**
 * Warmup the deepfake detection model silently.
 * Call on component mount so first inference is fast.
 */
export async function warmupDeepfakeModel(): Promise<void> {
    try {
        await ensureLoaded()
        // Quick inference with zeros to warm JIT
        const buffer = new DeepfakeFrameBuffer()
        for (let i = 0; i < SEQ_LEN; i++) {
            buffer.pushFrame({
                blendshapes: new Array(N_BLENDSHAPES).fill(0),
                iris: [0.5, 0.5, 0.5, 0.5],
                depth: [0, 0, 0],
            })
        }
        await runDeepfakeDetection(buffer)
        console.debug('[DeepCheck Deepfake] Model warmed up')
    } catch {
        // Non-fatal: if warmup fails, inference will still work
    }
}

/**
 * Check if the deepfake model is available.
 */
export function isDeepfakeModelAvailable(): boolean {
    if (typeof window === 'undefined') return false
    return typeof WebAssembly !== 'undefined'
}

/**
 * Helper: Extract a DeepfakeFrame from MediaPipe FaceLandmarkerResult.
 *
 * Usage in VerificationCamera.tsx:
 *   const frame = extractDeepfakeFrame(result.faceBlendshapes[0].categories, result.faceLandmarks[0])
 *   buffer.pushFrame(frame)
 */
export function extractDeepfakeFrame(
    blendshapeCategories: Array<{ categoryName: string; score: number }>,
    landmarks: Array<{ x: number; y: number; z: number }>,
): DeepfakeFrame {
    // Standard MediaPipe blendshape order (52 values)
    const BLENDSHAPE_ORDER = [
        '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp',
        'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft',
        'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft',
        'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
        'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft',
        'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward',
        'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
        'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
        'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
        'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
        'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
        'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
        'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
    ]

    // Map blendshape categories to ordered array
    const bsMap = new Map(blendshapeCategories.map(c => [c.categoryName, c.score]))
    const blendshapes = BLENDSHAPE_ORDER.map(name => bsMap.get(name) ?? 0)

    // Iris positions (MediaPipe landmark indices)
    const leftIris = landmarks[468]   // left iris center
    const rightIris = landmarks[473]  // right iris center

    // Depth from key landmarks
    const noseTip = landmarks[1]
    const leftIrisLm = landmarks[468]
    const rightIrisLm = landmarks[473]

    return {
        blendshapes,
        iris: [
            leftIris?.x ?? 0.5,
            leftIris?.y ?? 0.5,
            rightIris?.x ?? 0.5,
            rightIris?.y ?? 0.5,
        ],
        depth: [
            noseTip?.z ?? 0,
            leftIrisLm?.z ?? 0,
            rightIrisLm?.z ?? 0,
        ],
    }
}
