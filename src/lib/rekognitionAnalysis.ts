/**
 * rekognitionAnalysis.ts — AWS Rekognition Integration
 *
 * Two use cases:
 *   1. ID documents (passport, DNI, id_card): face quality analysis
 *      - Low confidence → printed/screenshotted photo
 *      - Low sharpness  → photo-of-photo (printed and re-photographed)
 *      - Extreme pose   → suspicious
 *   2. Media images: content moderation labels for context
 */

import {
  RekognitionClient,
  DetectFacesCommand,
  DetectModerationLabelsCommand,
  Attribute,
  FaceDetail,
  ModerationLabel,
} from '@aws-sdk/client-rekognition'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RekognitionResult {
  faceCount:          number
  faceQualityScore:   number    // 0–100 (0 = no face or high quality, 100 = very suspicious quality)
  moderationLabels:   string[]  // detected moderation category names
  hasSuspiciousQuality: boolean
  score:              number    // 0–100 manipulation signal
  analysisMs:         number
}

// ── AWS client (lazy singleton) ────────────────────────────────────────────────

let _rekognitionClient: RekognitionClient | null = null

function getRekognitionClient(): RekognitionClient {
  if (!_rekognitionClient) {
    _rekognitionClient = new RekognitionClient({
      region: process.env.AWS_REGION ?? 'eu-west-1',
      credentials: process.env.AWS_ACCESS_KEY_ID ? {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      } : undefined,
    })
  }
  return _rekognitionClient
}

function base64ToUint8Array(base64: string): Uint8Array {
  const b64    = base64.includes(',') ? base64.split(',')[1] : base64
  const binary = Buffer.from(b64, 'base64')
  return new Uint8Array(binary)
}

// ── Face quality analysis ──────────────────────────────────────────────────────

/**
 * Evaluate face quality for ID document authenticity.
 *
 * A real ID document photo should have:
 *   - Confidence > 95% (recognisable human face)
 *   - Brightness: moderate (not too dark/bright like a screenshotted photo)
 *   - Sharpness > 50 (blurry photos suggest photo-of-photo)
 *   - Pose: near-frontal (roll/yaw/pitch within ±20°)
 *
 * Suspicious patterns:
 *   - Low confidence → heavily printed/screenshotted photo
 *   - Low sharpness (< 30) → photo printed and re-photographed
 *   - Extreme pose (> 30°) → head tilted unusually in a supposed ID scan
 */
function analyzeFaceQuality(faces: FaceDetail[]): { score: number; suspicious: boolean } {
  if (faces.length === 0) return { score: 0, suspicious: false }

  // For ID documents, we expect exactly 1 face
  const face      = faces[0]
  const quality   = face.Quality

  let score       = 0
  let suspicious  = false

  if (!quality) return { score: 0, suspicious: false }

  // Sharpness check: very low sharpness → printed-photo-of-photo
  if (quality.Sharpness !== undefined) {
    if (quality.Sharpness < 30) {
      score += 40
      suspicious = true
    } else if (quality.Sharpness < 50) {
      score += 20
    }
  }

  // Brightness check: extreme values suggest screenshotted/printed photo
  if (quality.Brightness !== undefined) {
    const b = quality.Brightness
    if (b < 20 || b > 90) {
      score += 20
      suspicious = true
    }
  }

  // Confidence check
  if (face.Confidence !== undefined && face.Confidence < 90) {
    score += 25
    suspicious = true
  }

  // Pose check
  if (face.Pose) {
    const roll  = Math.abs(face.Pose.Roll  ?? 0)
    const yaw   = Math.abs(face.Pose.Yaw   ?? 0)
    const pitch = Math.abs(face.Pose.Pitch ?? 0)
    if (roll > 30 || yaw > 30 || pitch > 25) {
      score += 15
    }
  }

  return { score: Math.min(100, score), suspicious }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runRekognitionAnalysis(
  imageBase64: string,
  documentType?: string,   // 'passport' | 'id_card' | 'media_photo' | etc.
): Promise<RekognitionResult> {
  const t0         = Date.now()
  const imageBytes = base64ToUint8Array(imageBase64)
  const client     = getRekognitionClient()

  const isIdDocument = ['passport', 'id_card', 'dnI', 'certificate', 'payslip']
    .some(t => (documentType ?? '').toLowerCase().includes(t))

  let faceCount           = 0
  let faceQualityScore    = 0
  let hasSuspiciousQuality = false
  let moderationLabels: string[] = []

  try {
    if (isIdDocument) {
      // Detect faces with quality attributes for ID documents
      const facesCmd = new DetectFacesCommand({
        Image:      { Bytes: imageBytes },
        Attributes: [Attribute.DEFAULT],
      })
      const facesResp = await client.send(facesCmd)
      const faces     = facesResp.FaceDetails ?? []
      faceCount       = faces.length

      if (faces.length > 0) {
        const { score, suspicious } = analyzeFaceQuality(faces)
        faceQualityScore     = score
        hasSuspiciousQuality = suspicious
      }
    }

    // Always run moderation labels (works for any image type)
    const modCmd = new DetectModerationLabelsCommand({
      Image:          { Bytes: imageBytes },
      MinConfidence:  60,
    })
    const modResp = await client.send(modCmd)
    moderationLabels = (modResp.ModerationLabels ?? [])
      .map((l: ModerationLabel) => l.Name ?? '')
      .filter(Boolean)
  } catch (err: unknown) {
    console.error('[rekognitionAnalysis] error:', (err as Error).message)
    // Return zero scores on error — don't fail the whole pipeline
    return {
      faceCount: 0, faceQualityScore: 0, moderationLabels: [],
      hasSuspiciousQuality: false, score: 0, analysisMs: Date.now() - t0,
    }
  }

  // Combined score: face quality anomalies → manipulation signal
  const score = Math.min(100, faceQualityScore)

  return {
    faceCount,
    faceQualityScore,
    moderationLabels,
    hasSuspiciousQuality,
    score,
    analysisMs: Date.now() - t0,
  }
}
