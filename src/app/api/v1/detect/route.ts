/**
 * POST /api/v1/detect — AI-Generated Image Detection API
 * =======================================================
 *
 * Detects whether a face/image is AI-generated or real using
 * server-side ONNX inference (EfficientNet-B4 + Frequency Analysis).
 *
 * Authentication: Bearer token
 *   Authorization: Bearer dc_live_xxxxx
 *
 * Request body:
 *   {
 *     "image": "base64-encoded-image",   // Required
 *     "cropFace": true,                   // Optional (default: true)
 *     "webhookUrl": "https://..."         // Optional async callback
 *   }
 *
 * Batch mode:
 *   {
 *     "images": ["base64-1", "base64-2", ...],  // Up to 10
 *     "cropFace": true
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "authenticityScore": 92,
 *       "verdict": "real",
 *       "confidence": "high",
 *       "pFake": 0.1234,
 *       "modelVersion": "v3-efficientnet-b4",
 *       "processingMs": 245
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, initDb } from '@/lib/db'
import { detectDeepfake, getModelInfo, type DetectionResult } from '@/lib/onnxServerInference'

// ── CORS ────────────────────────────────────────────────────────────────────

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  return res
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

// ── Auth helper ─────────────────────────────────────────────────────────────

async function authenticate(req: NextRequest) {
  const apiKey = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!apiKey) {
    return { error: 'Missing API key. Use header: Authorization: Bearer dc_live_...' }
  }
  await initDb()
  const keyRecord = await validateApiKey(apiKey)
  if (!keyRecord) {
    return { error: 'Invalid or inactive API key' }
  }
  return { keyRecord }
}

// ── GET: Model info + health check ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if ('error' in auth) {
    return cors(NextResponse.json({ success: false, error: auth.error }, { status: 401 }))
  }

  try {
    const info = await getModelInfo()
    return cors(NextResponse.json({
      success: true,
      data: {
        status: info.available ? 'ready' : 'model_not_found',
        model: info,
        api: {
          version: 'v1',
          endpoints: {
            detect: 'POST /api/v1/detect',
            info: 'GET /api/v1/detect',
          },
          limits: {
            maxImageSize: '10MB',
            maxBatchSize: 10,
            supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
          },
        },
      },
    }))
  } catch (err) {
    return cors(NextResponse.json({
      success: false,
      error: `Model info error: ${(err as Error).message}`,
    }, { status: 500 }))
  }
}

// ── POST: Detect deepfake ───────────────────────────────────────────────────

interface DetectRequest {
  image?: string
  images?: string[]
  cropFace?: boolean
  webhookUrl?: string
  externalRef?: string
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if ('error' in auth) {
    return cors(NextResponse.json({ success: false, error: auth.error }, { status: 401 }))
  }

  // Parse body
  let body: DetectRequest
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    ))
  }

  const cropFace = body.cropFace !== false // default true

  // ── Batch mode ──────────────────────────────────────────────────────────

  if (body.images && Array.isArray(body.images)) {
    if (body.images.length === 0) {
      return cors(NextResponse.json(
        { success: false, error: 'At least one image required' },
        { status: 400 }
      ))
    }
    if (body.images.length > 10) {
      return cors(NextResponse.json(
        { success: false, error: 'Maximum 10 images per batch' },
        { status: 400 }
      ))
    }

    const t0 = Date.now()
    const results: (DetectionResult & { index: number; error?: string })[] = []

    for (let i = 0; i < body.images.length; i++) {
      try {
        const result = await detectDeepfake(body.images[i], { cropFace })
        results.push({ ...result, index: i })
      } catch (err) {
        results.push({
          index: i,
          pFake: -1,
          authenticityScore: -1,
          verdict: 'suspicious' as const,
          confidence: 'low' as const,
          modelVersion: 'error',
          processingMs: 0,
          error: (err as Error).message,
        })
      }
    }

    const validResults = results.filter(r => !r.error)
    const avgScore = validResults.length > 0
      ? Math.round(validResults.reduce((s, r) => s + r.authenticityScore, 0) / validResults.length)
      : 0

    // Webhook
    if (body.webhookUrl) {
      const payload = {
        event: 'batch_detection_complete',
        results,
        summary: { avgScore, total: results.length, errors: results.length - validResults.length },
        completedAt: new Date().toISOString(),
        externalRef: body.externalRef,
      }
      fetch(body.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }

    return cors(NextResponse.json({
      success: true,
      data: {
        results,
        summary: {
          totalImages: results.length,
          averageAuthenticityScore: avgScore,
          verdicts: {
            real: validResults.filter(r => r.verdict === 'real').length,
            suspicious: validResults.filter(r => r.verdict === 'suspicious').length,
            likely_fake: validResults.filter(r => r.verdict === 'likely_fake').length,
            fake: validResults.filter(r => r.verdict === 'fake').length,
          },
          errors: results.length - validResults.length,
          totalProcessingMs: Date.now() - t0,
        },
      },
    }))
  }

  // ── Single image mode ─────────────────────────────────────────────────

  if (!body.image) {
    return cors(NextResponse.json(
      { success: false, error: 'Missing "image" (base64) or "images" (array) field' },
      { status: 400 }
    ))
  }

  // Validate base64 size (~10MB limit)
  if (body.image.length > 14_000_000) {
    return cors(NextResponse.json(
      { success: false, error: 'Image too large. Maximum 10MB.' },
      { status: 413 }
    ))
  }

  try {
    const result = await detectDeepfake(body.image, { cropFace })

    // Webhook
    if (body.webhookUrl) {
      fetch(body.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'detection_complete',
          result,
          completedAt: new Date().toISOString(),
          externalRef: body.externalRef,
        }),
      }).catch(() => {})
    }

    return cors(NextResponse.json({
      success: true,
      data: result,
    }))
  } catch (err) {
    const message = (err as Error).message
    console.error('[v1/detect] Error:', message)

    return cors(NextResponse.json({
      success: false,
      error: message.includes('Model not found')
        ? 'Detection model not available. Contact support.'
        : `Detection failed: ${message}`,
    }, { status: 500 }))
  }
}
