/**
 * docForensicsCnn.ts — DocForensics CNN Inference
 *
 * MobileNetV3-Small ONNX model for:
 *   1. Document type classification (8 classes)
 *   2. Manipulation score (sigmoid → 0–100)
 *
 * Model: s3://deep-check-models/docforensics/model.onnx
 * Runtime: onnxruntime-node (same pattern as existing BiLSTM model)
 *
 * Gracefully degrades to score=0 when model is not available
 * (cold start, S3 unavailable, model not yet trained).
 */

import sharp from 'sharp'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import https from 'https'

// ── Types ──────────────────────────────────────────────────────────────────────

export type DocumentClass =
  | 'invoice'
  | 'id_card'
  | 'passport'
  | 'certificate'
  | 'payslip'
  | 'media_photo'
  | 'screenshot'
  | 'other'

export const DOCUMENT_CLASSES: DocumentClass[] = [
  'invoice', 'id_card', 'passport', 'certificate',
  'payslip', 'media_photo', 'screenshot', 'other',
]

export interface CnnResult {
  documentType:      DocumentClass
  documentTypeProb:  number    // 0–1 confidence for the predicted class
  manipulationScore: number    // 0–100 (sigmoid output × 100)
  score:             number    // alias of manipulationScore
  allProbs:          Record<DocumentClass, number>
  analysisMs:        number
  modelAvailable:    boolean
}

// ── ONNX model cache ───────────────────────────────────────────────────────────

let _ort: typeof import('onnxruntime-node') | null = null
let _session: import('onnxruntime-node').InferenceSession | null = null
let _modelLoadAttempted = false

async function getOrt(): Promise<typeof import('onnxruntime-node') | null> {
  if (_ort !== null) return _ort
  try {
    _ort = await import('onnxruntime-node')
    return _ort
  } catch {
    return null
  }
}

/**
 * Download model from S3 (via HTTPS, no AWS SDK needed for public bucket access).
 * Returns local file path or null on failure.
 */
async function downloadModel(modelUrl: string, localPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const file = fs.createWriteStream(localPath)
    const req  = https.get(modelUrl, res => {
      if (res.statusCode !== 200) { resolve(false); return }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(true) })
    })
    req.on('error', () => { resolve(false) })
    req.setTimeout(15000, () => { req.destroy(); resolve(false) })
  })
}

async function loadModel(): Promise<import('onnxruntime-node').InferenceSession | null> {
  if (_session) return _session
  if (_modelLoadAttempted) return null
  _modelLoadAttempted = true

  const ort = await getOrt()
  if (!ort) return null

  try {
    // Check for local model path (Lambda deployment: /tmp/model.onnx)
    const localPaths = [
      process.env.DOC_FORENSICS_MODEL_PATH,
      '/tmp/docforensics_model.onnx',
      path.join(process.cwd(), 'models', 'docforensics', 'model.onnx'),
    ].filter(Boolean) as string[]

    for (const p of localPaths) {
      if (fs.existsSync(p)) {
        _session = await ort.InferenceSession.create(p)
        console.log('[docForensicsCnn] Loaded model from', p)
        return _session
      }
    }

    // Try to download from S3
    const modelUrl = process.env.DOC_FORENSICS_MODEL_URL
      ?? 'https://deep-check-models.s3.eu-west-1.amazonaws.com/docforensics/model.onnx'
    const tmpPath  = path.join(os.tmpdir(), 'docforensics_model.onnx')

    console.log('[docForensicsCnn] Downloading model from', modelUrl)
    const ok = await downloadModel(modelUrl, tmpPath)
    if (!ok) {
      console.warn('[docForensicsCnn] Model download failed')
      return null
    }

    _session = await ort.InferenceSession.create(tmpPath)
    console.log('[docForensicsCnn] Model loaded from S3')
    return _session
  } catch (err: unknown) {
    console.warn('[docForensicsCnn] Model load error:', (err as Error).message)
    return null
  }
}

// ── Image preprocessing ────────────────────────────────────────────────────────

/**
 * Resize image to 224×224, normalise to ImageNet stats, return Float32Array.
 * Layout: NCHW (1 × 3 × 224 × 224), values normalised to mean=[0.485,0.456,0.406]
 * std=[0.229,0.224,0.225] as per ImageNet standard.
 */
async function preprocessImage(imageBase64: string): Promise<Float32Array | null> {
  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buf = Buffer.from(b64, 'base64')

    const { data } = await sharp(buf)
      .resize(224, 224)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const IMAGENET_MEAN = [0.485, 0.456, 0.406]
    const IMAGENET_STD  = [0.229, 0.224, 0.225]
    const n             = 224 * 224
    const tensor        = new Float32Array(3 * n)

    for (let i = 0; i < n; i++) {
      const r = data[i * 3]     / 255
      const g = data[i * 3 + 1] / 255
      const b = data[i * 3 + 2] / 255
      tensor[i]         = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]  // C=0 (R)
      tensor[n + i]     = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]  // C=1 (G)
      tensor[2 * n + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]  // C=2 (B)
    }

    return tensor
  } catch {
    return null
  }
}

// ── Softmax helper ─────────────────────────────────────────────────────────────

function softmax(logits: Float32Array): Float32Array {
  const maxLogit = Math.max(...logits)
  const exps     = logits.map(v => Math.exp(v - maxLogit))
  const sum      = exps.reduce((s, v) => s + v, 0)
  return new Float32Array(exps.map(v => v / sum))
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runDocForensicsCnn(imageBase64: string): Promise<CnnResult> {
  const t0 = Date.now()

  const FALLBACK: CnnResult = {
    documentType:      'other',
    documentTypeProb:  0,
    manipulationScore: 0,
    score:             0,
    allProbs:          Object.fromEntries(DOCUMENT_CLASSES.map(c => [c, 0])) as Record<DocumentClass, number>,
    analysisMs:        Date.now() - t0,
    modelAvailable:    false,
  }

  try {
    const session = await loadModel()
    if (!session) return FALLBACK

    const ort      = await getOrt()
    if (!ort)      return FALLBACK

    const tensor   = await preprocessImage(imageBase64)
    if (!tensor)   return FALLBACK

    // Run inference
    // Model outputs: 'doc_type_logits' (8 classes), 'manipulation_logit' (1 value)
    const inputTensor = new ort.Tensor('float32', tensor, [1, 3, 224, 224])
    const feeds: Record<string, import('onnxruntime-node').Tensor> = { input: inputTensor }
    const results = await session.run(feeds)

    // Extract outputs (try common output names)
    const logitsKey = Object.keys(results).find(k => k.includes('type') || k.includes('class') || k === 'output0')
    const manipKey  = Object.keys(results).find(k => k.includes('manip') || k.includes('score') || k === 'output1')

    let documentType: DocumentClass     = 'other'
    let documentTypeProb: number        = 0
    let manipulationScore: number       = 0
    let allProbs                        = Object.fromEntries(DOCUMENT_CLASSES.map(c => [c, 0])) as Record<DocumentClass, number>

    if (logitsKey && results[logitsKey]) {
      const raw    = results[logitsKey].data as Float32Array
      const probs  = softmax(raw)
      const maxIdx = probs.reduce((mi, v, i) => v > probs[mi] ? i : mi, 0)
      documentType     = DOCUMENT_CLASSES[maxIdx] ?? 'other'
      documentTypeProb = probs[maxIdx]
      DOCUMENT_CLASSES.forEach((c, i) => { allProbs[c] = probs[i] ?? 0 })
    }

    if (manipKey && results[manipKey]) {
      const raw = results[manipKey].data as Float32Array
      manipulationScore = Math.round(sigmoid(raw[0]) * 100)
    }

    return {
      documentType,
      documentTypeProb,
      manipulationScore,
      score: manipulationScore,
      allProbs,
      analysisMs: Date.now() - t0,
      modelAvailable: true,
    }
  } catch (err: unknown) {
    console.warn('[docForensicsCnn] inference error:', (err as Error).message)
    return { ...FALLBACK, analysisMs: Date.now() - t0 }
  }
}
