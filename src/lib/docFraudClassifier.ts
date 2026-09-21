/**
 * docFraudClassifier.ts — ML-based Document Fraud Classification (Layer 10)
 * ===========================================================================
 * EfficientNet-B4 ONNX model trained on IDNet-2025 (837K+ synthetic identity
 * documents from 20 countries) for binary classification: genuine vs tampered.
 *
 * Architecture:
 *   Input:  380×380 RGB image (ImageNet normalized, NCHW)
 *   Model:  EfficientNet-B4 → Dropout → Linear(1792,512) → ReLU → Linear(512,1)
 *   Output: Logit → sigmoid → P(tampered) ∈ [0,1]
 *
 * The model file is loaded from:
 *   1. process.env.DOC_FRAUD_MODEL_PATH (custom path)
 *   2. public/models/efficientnet_doc_fraud.onnx (Next.js static)
 *   3. ml/models/efficientnet_doc_fraud.onnx (local training output)
 *
 * Gracefully degrades to score=0 when model is not available (not yet trained).
 * This means the pipeline works identically before and after training — the ML
 * layer simply adds a new signal when the model becomes available.
 *
 * Training:
 *   pip install -r ml/requirements.txt
 *   python ml/download_datasets.py --idnet --subset 20 --splits
 *   python ml/train_efficientnet.py --epochs 25
 */

import sharp from 'sharp'
import * as fs from 'fs'
import * as path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DocFraudResult {
  /** 0–100 probability of document being tampered (0 = genuine, 100 = clearly tampered) */
  fraudScore:        number
  /** Raw sigmoid probability [0,1] */
  fraudProbability:  number
  /** Platt-calibrated probability (if calibration available) */
  calibratedProb:    number
  /** Classification label */
  label:             'genuine' | 'suspicious' | 'tampered'
  /** Confidence in the classification [0,100] */
  confidence:        number
  /** Model version string */
  modelVersion:      string
  /** Whether the ONNX model was available for inference */
  modelAvailable:    boolean
  /** Inference time in ms */
  analysisMs:        number
}

interface ModelMetadata {
  model:          string
  img_size:       number
  test_auc:       number
  test_accuracy:  number
  test_f1:        number
  threshold:      number
  calibration:    { method: string; coef: number; intercept: number }
}

// ── ONNX Session Cache ────────────────────────────────────────────────────────

let _ort: typeof import('onnxruntime-node') | null = null
let _session: import('onnxruntime-node').InferenceSession | null = null
let _modelMeta: ModelMetadata | null = null
let _loadAttempted = false

async function getOrt(): Promise<typeof import('onnxruntime-node') | null> {
  if (_ort !== null) return _ort
  try {
    _ort = await import('onnxruntime-node')
    return _ort
  } catch {
    return null
  }
}

async function loadModel(): Promise<import('onnxruntime-node').InferenceSession | null> {
  if (_session) return _session
  if (_loadAttempted) return null
  _loadAttempted = true

  const ort = await getOrt()
  if (!ort) return null

  const cwd = process.cwd()
  const searchPaths = [
    process.env.DOC_FRAUD_MODEL_PATH,
    path.join(cwd, 'public', 'models', 'efficientnet_doc_fraud.onnx'),
    path.join(cwd, 'ml', 'models', 'efficientnet_doc_fraud.onnx'),
    '/tmp/efficientnet_doc_fraud.onnx',
  ].filter(Boolean) as string[]

  for (const modelPath of searchPaths) {
    try {
      if (fs.existsSync(modelPath)) {
        _session = await ort.InferenceSession.create(modelPath, {
          executionProviders: ['cpu'],
        })
        console.log(`[docFraudClassifier] Model loaded from ${modelPath}`)

        // Try loading metadata
        const metaPath = modelPath.replace('.onnx', '_metadata.json')
        if (fs.existsSync(metaPath)) {
          const raw = fs.readFileSync(metaPath, 'utf-8')
          _modelMeta = JSON.parse(raw) as ModelMetadata
          console.log(`[docFraudClassifier] Metadata: AUC=${_modelMeta.test_auc}, F1=${_modelMeta.test_f1}`)
        }

        return _session
      }
    } catch (err) {
      console.warn(`[docFraudClassifier] Failed to load from ${modelPath}:`, (err as Error).message)
    }
  }

  console.warn('[docFraudClassifier] No model found — ML fraud scoring disabled')
  console.warn('[docFraudClassifier] Train: python ml/train_efficientnet.py')
  return null
}

// ── Image Preprocessing ───────────────────────────────────────────────────────

/**
 * Resize image to 380×380, normalize to ImageNet stats, return NCHW Float32Array.
 */
async function preprocessImage(imageBase64: string, imgSize: number = 380): Promise<Float32Array | null> {
  try {
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const buf = Buffer.from(b64, 'base64')

    const { data } = await sharp(buf)
      .resize(imgSize, imgSize, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const MEAN = [0.485, 0.456, 0.406]
    const STD  = [0.229, 0.224, 0.225]
    const n    = imgSize * imgSize
    const tensor = new Float32Array(3 * n)

    for (let i = 0; i < n; i++) {
      const r = data[i * 3]     / 255
      const g = data[i * 3 + 1] / 255
      const b = data[i * 3 + 2] / 255
      tensor[i]         = (r - MEAN[0]) / STD[0]  // C=0 (R)
      tensor[n + i]     = (g - MEAN[1]) / STD[1]  // C=1 (G)
      tensor[2 * n + i] = (b - MEAN[2]) / STD[2]  // C=2 (B)
    }

    return tensor
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function plattCalibrate(logit: number, meta: ModelMetadata | null): number {
  if (!meta?.calibration) return sigmoid(logit)
  return sigmoid(meta.calibration.coef * logit + meta.calibration.intercept)
}

// ── Main Export ───────────────────────────────────────────────────────────────

const FALLBACK: DocFraudResult = {
  fraudScore:       0,
  fraudProbability: 0,
  calibratedProb:   0,
  label:            'genuine',
  confidence:       0,
  modelVersion:     'unavailable',
  modelAvailable:   false,
  analysisMs:       0,
}

/**
 * Run ML-based document fraud classification.
 *
 * Returns fraudScore 0–100 where:
 *   0–25:  genuine (high confidence)
 *   26–55: suspicious (needs manual review)
 *   56–100: tampered (high confidence)
 *
 * When the ONNX model is not available (not yet trained), returns
 * fraudScore=0, modelAvailable=false — the pipeline score is unaffected.
 */
export async function runDocFraudClassifier(imageBase64: string): Promise<DocFraudResult> {
  const t0 = Date.now()

  try {
    const session = await loadModel()
    if (!session) {
      return { ...FALLBACK, analysisMs: Date.now() - t0 }
    }

    const ort = await getOrt()
    if (!ort) {
      return { ...FALLBACK, analysisMs: Date.now() - t0 }
    }

    const imgSize = _modelMeta?.img_size ?? 380
    const tensor = await preprocessImage(imageBase64, imgSize)
    if (!tensor) {
      return { ...FALLBACK, analysisMs: Date.now() - t0 }
    }

    // Run inference
    const inputTensor = new ort.Tensor('float32', tensor, [1, 3, imgSize, imgSize])

    // Try common input names
    const inputNames = session.inputNames
    const feeds: Record<string, import('onnxruntime-node').Tensor> = {}
    feeds[inputNames[0] ?? 'input_image'] = inputTensor

    const results = await session.run(feeds)

    // Extract logit from output
    const outputKey = session.outputNames[0] ?? Object.keys(results)[0]
    const logit = (results[outputKey].data as Float32Array)[0]

    const fraudProbability = sigmoid(logit)
    const calibratedProb = plattCalibrate(logit, _modelMeta)
    const threshold = _modelMeta?.threshold ?? 0.5

    // Score: 0–100
    const fraudScore = Math.round(calibratedProb * 100)

    // Label
    let label: 'genuine' | 'suspicious' | 'tampered'
    if (calibratedProb < threshold * 0.5) {
      label = 'genuine'
    } else if (calibratedProb < threshold) {
      label = 'suspicious'
    } else {
      label = 'tampered'
    }

    // Confidence: how far from the decision boundary
    const confidence = Math.round(Math.abs(calibratedProb - threshold) * 2 * 100)

    const modelVersion = _modelMeta?.model ?? 'efficientnet_b4_idnet'

    console.log(
      `[docFraudClassifier] logit=${logit.toFixed(3)}, prob=${fraudProbability.toFixed(3)}, ` +
      `cal=${calibratedProb.toFixed(3)}, score=${fraudScore}, label=${label}, ` +
      `conf=${confidence}%, model=${modelVersion}, ${Date.now() - t0}ms`
    )

    return {
      fraudScore,
      fraudProbability: Math.round(fraudProbability * 10000) / 10000,
      calibratedProb:   Math.round(calibratedProb * 10000) / 10000,
      label,
      confidence:       Math.min(100, confidence),
      modelVersion,
      modelAvailable:   true,
      analysisMs:       Date.now() - t0,
    }
  } catch (err) {
    console.error('[docFraudClassifier] Inference error:', (err as Error).message)
    return { ...FALLBACK, analysisMs: Date.now() - t0 }
  }
}
