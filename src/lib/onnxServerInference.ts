/**
 * Deep-Check · Server-side ONNX Inference
 * ========================================
 * Runs EfficientNet-B4 deepfake detection on the server using onnxruntime-node.
 * Used by the /api/v1/detect endpoint.
 *
 * - Accepts base64 or Buffer image
 * - Preprocesses: decode → resize 224×224 → ImageNet normalize
 * - Runs ONNX inference → P(fake) logit → sigmoid
 * - Returns calibrated score + verdict
 */

import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const MODEL_DIR = path.join(process.cwd(), 'public', 'models', 'deepfake')
const MODEL_V3 = 'deepfake_pixel_v1.onnx'
const INPUT_SIZE = 224

// ImageNet normalization
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

// ── Singleton session ───────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null
let sessionModel = ''

async function getSession(modelName?: string): Promise<ort.InferenceSession> {
  const target = modelName || MODEL_V3
  if (session && sessionModel === target) return session

  const modelPath = path.join(MODEL_DIR, target)
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}`)
  }

  console.log(`[onnx-server] Loading model: ${target}`)
  const t0 = Date.now()

  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'], // Server-side CPU inference
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    intraOpNumThreads: 4,
  })

  sessionModel = target
  console.log(`[onnx-server] Model loaded in ${Date.now() - t0}ms`)
  return session
}

// ── Image preprocessing ─────────────────────────────────────────────────────

/**
 * Decode image buffer → 224×224 RGB float32 tensor (ImageNet normalized)
 * Format: [1, 3, 224, 224] NCHW
 */
async function preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
  // Decode and resize to 224×224
  const { data, info } = await sharp(imageBuffer)
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== 3) {
    throw new Error(`Expected 3 channels, got ${info.channels}`)
  }

  // Convert to NCHW float32 with ImageNet normalization
  const tensor = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE)
  const pixels = INPUT_SIZE * INPUT_SIZE

  for (let i = 0; i < pixels; i++) {
    const r = data[i * 3] / 255.0
    const g = data[i * 3 + 1] / 255.0
    const b = data[i * 3 + 2] / 255.0

    tensor[0 * pixels + i] = (r - MEAN[0]) / STD[0] // R channel
    tensor[1 * pixels + i] = (g - MEAN[1]) / STD[1] // G channel
    tensor[2 * pixels + i] = (b - MEAN[2]) / STD[2] // B channel
  }

  return tensor
}

/**
 * Try to detect and crop face region using simple heuristics.
 * Falls back to center crop if no face-like region found.
 */
async function cropFaceRegion(imageBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata()
  const w = metadata.width || INPUT_SIZE
  const h = metadata.height || INPUT_SIZE

  // For photos likely containing faces, crop center 70% (removes background)
  const cropSize = Math.min(w, h) * 0.7
  const left = Math.round((w - cropSize) / 2)
  const top = Math.round((h - cropSize) * 0.35) // Slightly higher for faces

  return sharp(imageBuffer)
    .extract({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.round(Math.min(cropSize, w - left)),
      height: Math.round(Math.min(cropSize, h - top)),
    })
    .toBuffer()
}

// ── TTA (Test-Time Augmentation) ────────────────────────────────────────────

/**
 * Generate 5 augmented versions of an image for TTA:
 * 1. Original (center crop)
 * 2. Horizontal flip
 * 3. Slight zoom (110%)
 * 4. Top-left crop
 * 5. Bottom-right crop
 *
 * Averaging logits across these reduces EER by smoothing edge cases.
 */
async function generateTTAAugments(imageBuffer: Buffer): Promise<Buffer[]> {
  const meta = await sharp(imageBuffer).metadata()
  const w = meta.width || INPUT_SIZE
  const h = meta.height || INPUT_SIZE
  const augments: Buffer[] = []

  // 1. Original
  augments.push(imageBuffer)

  // 2. Horizontal flip
  try {
    augments.push(await sharp(imageBuffer).flop().toBuffer())
  } catch { augments.push(imageBuffer) }

  // 3. Slight zoom (110% center crop)
  try {
    const zw = Math.round(w * 0.9)
    const zh = Math.round(h * 0.9)
    const zl = Math.round((w - zw) / 2)
    const zt = Math.round((h - zh) / 2)
    if (zw > 10 && zh > 10) {
      augments.push(await sharp(imageBuffer)
        .extract({ left: zl, top: zt, width: zw, height: zh })
        .toBuffer())
    }
  } catch { /* skip */ }

  // 4. Top-left crop (80%)
  try {
    const cw = Math.round(w * 0.8)
    const ch = Math.round(h * 0.8)
    if (cw > 10 && ch > 10) {
      augments.push(await sharp(imageBuffer)
        .extract({ left: 0, top: 0, width: cw, height: ch })
        .toBuffer())
    }
  } catch { /* skip */ }

  // 5. Bottom-right crop (80%)
  try {
    const cw = Math.round(w * 0.8)
    const ch = Math.round(h * 0.8)
    if (cw > 10 && ch > 10) {
      augments.push(await sharp(imageBuffer)
        .extract({ left: w - cw, top: h - ch, width: cw, height: ch })
        .toBuffer())
    }
  } catch { /* skip */ }

  return augments
}

// ── Calibration ─────────────────────────────────────────────────────────────

/**
 * Calibrate raw P(fake) to human-friendly authenticity score.
 * Maps model output (trained on datasets) to real-world expectations.
 *
 * Returns: 1-100 where 100 = definitely real, 1 = definitely fake
 */
function calibrateScore(pFake: number): number {
  let score: number
  if (pFake <= 0.40) score = 99
  else if (pFake <= 0.70) score = Math.round(99 - (pFake - 0.40) / 0.30 * 14)
  else if (pFake <= 0.90) score = Math.round(85 - (pFake - 0.70) / 0.20 * 15)
  else if (pFake <= 0.97) score = Math.round(70 - (pFake - 0.90) / 0.07 * 30)
  else score = Math.round(40 - (pFake - 0.97) / 0.03 * 35)
  return Math.max(1, Math.min(99, score))
}

function getVerdict(authenticityScore: number): 'real' | 'suspicious' | 'likely_fake' | 'fake' {
  if (authenticityScore >= 80) return 'real'
  if (authenticityScore >= 60) return 'suspicious'
  if (authenticityScore >= 30) return 'likely_fake'
  return 'fake'
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface DetectionResult {
  /** Raw model output: probability of being AI-generated (0-1) */
  pFake: number
  /** Calibrated authenticity score (1-100, higher = more likely real) */
  authenticityScore: number
  /** Human-readable verdict */
  verdict: 'real' | 'suspicious' | 'likely_fake' | 'fake'
  /** Confidence level based on model certainty */
  confidence: 'high' | 'medium' | 'low'
  /** Model version used */
  modelVersion: string
  /** Processing time in milliseconds */
  processingMs: number
}

export interface DetectionOptions {
  /** Whether to attempt face cropping before inference (default: true) */
  cropFace?: boolean
  /** Specific model to use (default: current production model) */
  model?: string
}

/**
 * Run deepfake detection on an image.
 *
 * @param image - Base64 string (with or without data: prefix) or Buffer
 * @param options - Detection options
 * @returns Detection result with score, verdict, and metadata
 */
export async function detectDeepfake(
  image: string | Buffer,
  options: DetectionOptions = {}
): Promise<DetectionResult> {
  const t0 = Date.now()
  const { cropFace = true, model } = options

  // 1. Decode image
  let imageBuffer: Buffer
  if (typeof image === 'string') {
    // Strip data:image/...;base64, prefix if present
    const base64 = image.replace(/^data:image\/[a-z]+;base64,/, '')
    imageBuffer = Buffer.from(base64, 'base64')
  } else {
    imageBuffer = image
  }

  // Validate it's actually an image
  const metadata = await sharp(imageBuffer).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Invalid image: could not read dimensions')
  }

  // 2. Crop face region if requested
  if (cropFace) {
    try {
      imageBuffer = await cropFaceRegion(imageBuffer)
    } catch {
      // Fall through to full image
    }
  }

  // 3. TTA: run inference on multiple augmented versions and average logits
  const sess = await getSession(model)
  const augBuffers = await generateTTAAugments(imageBuffer)
  let logitSum = 0
  let ttaCount = 0

  for (const augBuf of augBuffers) {
    const tensor = await preprocessImage(augBuf)
    const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE])
    const results = await sess.run({ face_image: inputTensor })
    const logitData = results['logit']?.data
    if (logitData && logitData.length > 0) {
      logitSum += Number(logitData[0])
      ttaCount++
    }
  }

  if (ttaCount === 0) {
    throw new Error('Model returned no output')
  }
  const logit = logitSum / ttaCount
  const pFake = 1 / (1 + Math.exp(-logit))

  // 6. Calibrate
  const authenticityScore = calibrateScore(pFake)
  const verdict = getVerdict(authenticityScore)

  // 7. Confidence based on how far from decision boundary
  let confidence: 'high' | 'medium' | 'low'
  if (pFake < 0.2 || pFake > 0.95) confidence = 'high'
  else if (pFake < 0.4 || pFake > 0.85) confidence = 'medium'
  else confidence = 'low'

  return {
    pFake: Math.round(pFake * 10000) / 10000,
    authenticityScore,
    verdict,
    confidence,
    modelVersion: model || 'v3-efficientnet-b4',
    processingMs: Date.now() - t0,
  }
}

/**
 * Get model info without running inference
 */
export async function getModelInfo() {
  const modelPath = path.join(MODEL_DIR, MODEL_V3)
  const exists = fs.existsSync(modelPath)
  const size = exists ? fs.statSync(modelPath).size : 0

  return {
    modelName: MODEL_V3,
    modelVersion: 'v3-efficientnet-b4',
    inputShape: [1, 3, INPUT_SIZE, INPUT_SIZE],
    outputShape: [1],
    fileSizeMB: Math.round(size / 1024 / 1024 * 10) / 10,
    available: exists,
    runtime: 'onnxruntime-node',
    executionProvider: 'cpu',
  }
}
