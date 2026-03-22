/**
 * POST /api/deepfake
 * ==================
 * Server-side deepfake detection using EfficientNet-B4 ONNX model.
 *
 * Input:  { faceImageBase64: string, source?: 'interview' | 'document' }
 * Output: { score: number, label: 'real'|'fake', confidence: number,
 *            calibratedProb: number, modelVersion: string, analysisMs: number }
 *
 * The pixel-based model (deepfake_pixel_v1.onnx) runs server-side and
 * complements the client-side temporal blendshape model:
 *   - Pixel model:   detects visual/GAN artifacts in a single frame
 *   - Temporal model: detects behavioral anomalies over time (iris, blinks)
 *   - Combined verdict: Bayesian ensemble of both
 *
 * Model location: public/models/deepfake/deepfake_pixel_v1.onnx
 * Metadata:       public/models/deepfake/deepfake_pixel_v1_metadata.json
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelMetadata {
  model: string
  metrics: { test_auc: number; test_accuracy: number; test_eer: number }
  calibration: { method: string; coef: number; intercept: number }
  threshold: number
}

interface DeepfakeResult {
  score:          number    // 0–100 (higher = more likely fake)
  label:          'real' | 'fake'
  confidence:     number    // 0–100
  calibratedProb: number    // 0–1 (Platt-calibrated probability of being fake)
  rawLogit:       number
  modelVersion:   string
  analysisMs:     number
  modelAvailable: boolean
}

// ── ONNX runtime (server-side) ────────────────────────────────────────────────

// Lazy-load onnxruntime-node to avoid build errors when not installed
let ortSession: unknown = null
let modelMeta: ModelMetadata | null = null
let modelLoadAttempted = false

async function getOrtSession() {
  if (modelLoadAttempted) return ortSession
  modelLoadAttempted = true

  try {
    // Dynamic import — onnxruntime-node is optional (install: npm i onnxruntime-node)
    const ort = await import('onnxruntime-node')

    const modelPath = path.join(process.cwd(), 'public', 'models', 'deepfake', 'deepfake_pixel_v1.onnx')
    const metaPath  = path.join(process.cwd(), 'public', 'models', 'deepfake', 'deepfake_pixel_v1_metadata.json')

    if (!fs.existsSync(modelPath)) {
      console.warn('[deepfake] deepfake_pixel_v1.onnx not found — train it first with kaggle_deepfake_notebook.py')
      return null
    }

    ortSession = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],  // use 'cuda' if GPU server
    })

    if (fs.existsSync(metaPath)) {
      modelMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    }

    console.log('[deepfake] Pixel model loaded ✅')
    return ortSession
  } catch (e: unknown) {
    console.warn('[deepfake] onnxruntime-node not available:', (e as Error).message)
    return null
  }
}

// ── Image preprocessing ────────────────────────────────────────────────────────

const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD  = [0.229, 0.224, 0.225]

function base64ToFloat32Tensor(base64: string): Float32Array {
  // Node Buffer — strip data URL prefix if present
  const b64 = base64.includes(',') ? base64.split(',')[1] : base64
  const buf  = Buffer.from(b64, 'base64')

  // Decode PNG/JPEG using sharp if available, otherwise fallback
  // For MVP: caller should send already-decoded 224×224 pixel array
  // Format: base64 of raw Float32Array of shape [1, 3, 224, 224] in CHW order, ImageNet-normalized
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return floats
}

function rgbaToNormalized(pixels: Uint8Array, width: number, height: number): Float32Array {
  // RGBA flat array → Float32 CHW [1, 3, H, W] ImageNet-normalized
  const out = new Float32Array(3 * width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = pixels[i]   / 255.0
      const g = pixels[i+1] / 255.0
      const b = pixels[i+2] / 255.0
      const px = y * width + x
      out[0 * width * height + px] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
      out[1 * width * height + px] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
      out[2 * width * height + px] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
    }
  }
  return out
}

// ── Platt calibration ─────────────────────────────────────────────────────────

function plattCalibrate(logit: number, meta: ModelMetadata | null): number {
  if (!meta?.calibration) return sigmoid(logit)
  return sigmoid(meta.calibration.coef * logit + meta.calibration.intercept)
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now()

  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { faceImageBase64, pixelsRGBA, imageWidth, imageHeight } = body as {
    faceImageBase64?: string
    pixelsRGBA?: number[]
    imageWidth?:  number
    imageHeight?: number
  }

  const session = await getOrtSession()

  // ── Fallback: model not available yet (not trained)
  if (!session) {
    return NextResponse.json({
      score:          0,
      label:          'real',
      confidence:     0,
      calibratedProb: 0,
      rawLogit:       0,
      modelVersion:   'unavailable',
      analysisMs:     Date.now() - t0,
      modelAvailable: false,
      message:        'Pixel deepfake model not trained yet. Run kaggle_deepfake_notebook.py to train.',
    } satisfies DeepfakeResult & { message: string })
  }

  try {
    // Build tensor from input
    let inputTensor: Float32Array

    if (pixelsRGBA && imageWidth && imageHeight) {
      // Preferred: raw RGBA pixels from canvas (no server-side image decoding needed)
      inputTensor = rgbaToNormalized(new Uint8Array(pixelsRGBA), imageWidth, imageHeight)
    } else if (faceImageBase64) {
      // Fallback: pre-normalized CHW Float32 base64
      inputTensor = base64ToFloat32Tensor(faceImageBase64)
    } else {
      return NextResponse.json({ error: 'Provide pixelsRGBA or faceImageBase64' }, { status: 400 })
    }

    if (inputTensor.length !== 3 * 224 * 224) {
      return NextResponse.json({
        error: `Expected 3×224×224 = 150528 floats, got ${inputTensor.length}. ` +
               'Resize image to 224×224 before sending.'
      }, { status: 400 })
    }

    // Run inference
    const ort = await import('onnxruntime-node')
    const tensor = new ort.Tensor('float32', inputTensor, [1, 3, 224, 224])
    const inputName = (session as import('onnxruntime-node').InferenceSession).inputNames?.[0] ?? 'x'
    const feeds  = { [inputName]: tensor }
    const result = await (session as import('onnxruntime-node').InferenceSession).run(feeds)

    const outputName = (session as import('onnxruntime-node').InferenceSession).outputNames?.[0] ?? 'logit'
    const logit          = result[outputName].data[0] as number
    const calibratedProb = plattCalibrate(logit, modelMeta)
    const threshold      = modelMeta?.threshold ?? 0.5

    const isFake    = calibratedProb > threshold
    const score     = Math.round(calibratedProb * 100)
    const confidence = Math.round(Math.abs(calibratedProb - 0.5) * 2 * 100)  // 0 at boundary, 100 at extremes

    const deepfakeResult: DeepfakeResult = {
      score,
      label:          isFake ? 'fake' : 'real',
      confidence,
      calibratedProb: Math.round(calibratedProb * 10000) / 10000,
      rawLogit:       Math.round(logit * 1000) / 1000,
      modelVersion:   modelMeta?.model ?? 'deepfake_pixel_v1',
      analysisMs:     Date.now() - t0,
      modelAvailable: true,
    }

    return NextResponse.json(deepfakeResult)

  } catch (err: unknown) {
    console.error('[deepfake] Inference error:', (err as Error).message)
    return NextResponse.json({
      score: 0, label: 'real', confidence: 0,
      calibratedProb: 0, rawLogit: 0,
      modelVersion: 'error', analysisMs: Date.now() - t0,
      modelAvailable: false,
      error: (err as Error).message,
    }, { status: 500 })
  }
}
