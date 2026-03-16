/**
 * POST /api/face-match
 * ====================
 * Neural face recognition using @vladmandic/face-api (server-side).
 *
 * Attempts to load face-api with Node.js canvas polyfill.
 * Falls back to { method: 'unavailable' } if models or dependencies are missing,
 * allowing the client to use its geometric MediaPipe fallback.
 *
 * Models expected in public/models/:
 *   - ssd_mobilenetv1_model-weights_manifest.json + shard(s)
 *   - face_landmark_68_model-weights_manifest.json + .bin
 *   - face_recognition_model-weights_manifest.json + .bin
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────────

interface FaceMatchResponse {
  match: boolean
  similarity: number
  confidence: number
  docFaceFound: boolean
  selfieFaceFound: boolean
  processingMs: number
  method: 'neural' | 'unavailable'
  error?: string
}

// ── Module-level model cache ───────────────────────────────────────────────────

let modelsLoaded = false
let modelsLoadFailed = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let faceapi: any = null

const MODELS_PATH = path.join(process.cwd(), 'public', 'models')
const MATCH_THRESHOLD = 0.55 // Standard face-api.js threshold: distance < 0.55 → match

// ── Model loader (lazy, cached) ────────────────────────────────────────────────

async function loadModels(): Promise<boolean> {
  if (modelsLoaded) return true
  if (modelsLoadFailed) return false

  try {
    // Dynamically require to avoid build-time failures when deps are absent.
    // face-api needs canvas for Node.js image handling.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fa = require('@vladmandic/face-api')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Canvas, Image, ImageData, createCanvas, loadImage } = require('canvas')

    // Monkey-patch browser APIs
    fa.env.monkeyPatch({
      Canvas: Canvas as never,
      Image: Image as never,
      ImageData: ImageData as never,
      createCanvasElement: () => createCanvas(0, 0) as never,
      createImageElement: () => new Image() as never,
    })

    // Store reference for later use
    faceapi = { fa, loadImage }

    // Load required nets
    await fa.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH)
    await fa.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH)
    await fa.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)

    modelsLoaded = true
    console.log('[face-match] Neural models loaded from', MODELS_PATH)
    return true
  } catch (err) {
    modelsLoadFailed = true
    console.warn('[face-match] Failed to load neural models — falling back to client-side:', err instanceof Error ? err.message : err)
    return false
  }
}

// ── Descriptor extraction ──────────────────────────────────────────────────────

async function getDescriptor(dataUrl: string): Promise<Float32Array | null> {
  if (!faceapi) return null

  const { fa, loadImage } = faceapi

  // Convert base64 data URL to buffer then to canvas Image
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  const img = await loadImage(buffer)

  const detection = await fa
    .detectSingleFace(img, new fa.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) return null
  return detection.descriptor as Float32Array
}

// ── Euclidean distance ─────────────────────────────────────────────────────────

function euclidean(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse<FaceMatchResponse>> {
  const t0 = Date.now()

  let docImage: string
  let selfieImage: string

  try {
    const body = await req.json()
    docImage = body.docImage
    selfieImage = body.selfieImage
    if (!docImage || !selfieImage) {
      return NextResponse.json(
        {
          match: false,
          similarity: 0,
          confidence: 0,
          docFaceFound: false,
          selfieFaceFound: false,
          processingMs: Date.now() - t0,
          method: 'unavailable',
          error: 'Missing docImage or selfieImage',
        },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json(
      {
        match: false,
        similarity: 0,
        confidence: 0,
        docFaceFound: false,
        selfieFaceFound: false,
        processingMs: Date.now() - t0,
        method: 'unavailable',
        error: 'Invalid JSON body',
      },
      { status: 400 }
    )
  }

  // Try to load models (lazy, cached)
  const ready = await loadModels()
  if (!ready) {
    return NextResponse.json({
      match: false,
      similarity: 0,
      confidence: 0,
      docFaceFound: false,
      selfieFaceFound: false,
      processingMs: Date.now() - t0,
      method: 'unavailable',
    })
  }

  try {
    // Extract descriptors in parallel
    const [docDesc, selfieDesc] = await Promise.all([
      getDescriptor(docImage),
      getDescriptor(selfieImage),
    ])

    const docFaceFound = docDesc !== null
    const selfieFaceFound = selfieDesc !== null

    if (!docFaceFound || !selfieFaceFound) {
      return NextResponse.json({
        match: false,
        similarity: 0,
        confidence: 0,
        docFaceFound,
        selfieFaceFound,
        processingMs: Date.now() - t0,
        method: 'neural',
      })
    }

    // Compute distance and similarity
    const distance = euclidean(docDesc!, selfieDesc!)
    // Clamp distance to [0, 2] range (theoretical max for unit vectors)
    const clampedDistance = Math.min(distance, 2)
    const similarity = 1 - clampedDistance / 2
    const match = distance < MATCH_THRESHOLD

    // Confidence: how far from the threshold (0–1 scale)
    // Near threshold → low confidence; far from threshold → high confidence
    const distFromThreshold = Math.abs(distance - MATCH_THRESHOLD)
    const confidence = Math.min(1, distFromThreshold / MATCH_THRESHOLD)

    return NextResponse.json({
      match,
      similarity: Math.round(similarity * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      docFaceFound,
      selfieFaceFound,
      processingMs: Date.now() - t0,
      method: 'neural',
    })
  } catch (err) {
    console.error('[face-match] Inference error:', err)
    return NextResponse.json({
      match: false,
      similarity: 0,
      confidence: 0,
      docFaceFound: false,
      selfieFaceFound: false,
      processingMs: Date.now() - t0,
      method: 'unavailable',
      error: err instanceof Error ? err.message : 'Unknown inference error',
    })
  }
}
