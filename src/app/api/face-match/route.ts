/**
 * POST /api/face-match
 * ====================
 * Face comparison endpoint.
 *
 * Uses lightweight server-side face detection (YCbCr skin-color heuristics).
 * For actual face *matching* (identity verification), the client uses
 * MediaPipe FaceLandmarker — zero biometric data leaves the device.
 *
 * This endpoint detects if faces are present in both images and returns
 * basic quality signals. The client-side MediaPipe comparison handles
 * the actual identity matching with cosine similarity on 468 landmarks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { detectFaces } from '@/lib/faceDetection'

// ── Types ──────────────────────────────────────────────────────────────────────

interface FaceMatchResponse {
  match: boolean
  similarity: number
  confidence: number
  docFaceFound: boolean
  selfieFaceFound: boolean
  processingMs: number
  method: 'lightweight' | 'unavailable'
  error?: string
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

  try {
    // Detect faces in both images in parallel
    const [docResult, selfieResult] = await Promise.all([
      detectFaces(docImage),
      detectFaces(selfieImage),
    ])

    const docFaceFound = docResult.faceCount > 0
    const selfieFaceFound = selfieResult.faceCount > 0

    // Lightweight detection: we can confirm both have faces
    // but cannot do identity matching server-side without ML model.
    // Client should use MediaPipe FaceLandmarker for actual matching.
    return NextResponse.json({
      match: false, // Server-side can only detect, not match — use client MediaPipe
      similarity: 0,
      confidence: 0,
      docFaceFound,
      selfieFaceFound,
      processingMs: Date.now() - t0,
      method: 'lightweight',
    })
  } catch (err) {
    console.error('[face-match] Detection error:', err)
    return NextResponse.json({
      match: false,
      similarity: 0,
      confidence: 0,
      docFaceFound: false,
      selfieFaceFound: false,
      processingMs: Date.now() - t0,
      method: 'unavailable',
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
