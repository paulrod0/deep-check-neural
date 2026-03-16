/**
 * faceDetection.ts — Lightweight Face Detection (Canvas-based)
 * =============================================================
 * Detects faces in document images using skin-color heuristics
 * on the pixel data. Does NOT use TensorFlow or any ML model.
 *
 * Why not face-api.js?
 *   @vladmandic/face-api depends on @tensorflow/tfjs-node which
 *   uses util.isNullOrUndefined (removed in Node.js 22+).
 *   This causes unhandled rejections that crash the server.
 *
 * This lightweight detector:
 *   1. Loads image via node-canvas (sharp for pixel access)
 *   2. Analyzes skin-tone pixel regions in YCbCr color space
 *   3. Uses connected component labeling to count face-like regions
 *   4. Returns face count + quality heuristics
 *
 * Accuracy: good enough for "face present/absent" detection on
 * ID documents and photos. Not a neural face detector.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface FaceDetectionResult {
  faceCount:           number
  faceQualityScore:    number    // 0–100
  hasSuspiciousQuality: boolean
  score:               number    // 0–100
  analysisMs:          number
  faceConfidence:      number    // 0–1
}

// ── Skin color detection in YCbCr space ─────────────────────────────────────

function isSkinPixel(r: number, g: number, b: number): boolean {
  // Convert RGB to YCbCr
  const y  = 0.299 * r + 0.587 * g + 0.114 * b
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b

  // YCbCr skin color thresholds (empirical, works for diverse skin tones)
  return y > 60 && cb > 77 && cb < 127 && cr > 133 && cr < 173
}

// ── Main detection function ─────────────────────────────────────────────────

export async function detectFaces(imageBase64: string): Promise<FaceDetectionResult> {
  const t0 = Date.now()

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp')

    // Convert base64 to raw pixel data
    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const imgBuffer = Buffer.from(b64, 'base64')

    // Resize to small working image for speed
    const WORK_SIZE = 200
    const { data, info } = await sharp(imgBuffer)
      .resize(WORK_SIZE, WORK_SIZE, { fit: 'inside' })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true })

    const w = info.width
    const h = info.height
    const pixels = new Uint8Array(data)

    // Count skin-tone pixels
    let skinPixels = 0
    const totalPixels = w * h

    // Also track largest skin-tone connected region (simplified)
    const skinMap = new Uint8Array(w * h)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const r = pixels[idx]
        const g = pixels[idx + 1]
        const b = pixels[idx + 2]

        if (isSkinPixel(r, g, b)) {
          skinPixels++
          skinMap[y * w + x] = 1
        }
      }
    }

    const skinRatio = skinPixels / totalPixels

    // Simple connected component analysis to find face-like blobs
    const visited = new Uint8Array(w * h)
    const blobs: number[] = []

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (skinMap[y * w + x] === 1 && visited[y * w + x] === 0) {
          // BFS to find connected region
          let size = 0
          const queue: [number, number][] = [[x, y]]
          visited[y * w + x] = 1

          while (queue.length > 0) {
            const [cx, cy] = queue.shift()!
            size++

            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx
              const ny = cy + dy
              if (nx >= 0 && nx < w && ny >= 0 && ny < h &&
                  skinMap[ny * w + nx] === 1 && visited[ny * w + nx] === 0) {
                visited[ny * w + nx] = 1
                queue.push([nx, ny])
              }
            }
          }

          blobs.push(size)
        }
      }
    }

    // Filter: face-like regions are > 1% of image area
    const minFaceSize = totalPixels * 0.01
    const faceBlobs = blobs.filter(s => s >= minFaceSize)
    const faceCount = Math.min(faceBlobs.length, 5) // Cap at 5

    // Quality heuristic
    let qualityScore = 0

    if (faceCount === 0 && skinRatio > 0.02) {
      // Some skin visible but no coherent face blob → low quality
      qualityScore += 15
    }

    if (faceCount > 0) {
      const largestBlob = Math.max(...faceBlobs)
      const blobRatio = largestBlob / totalPixels

      if (blobRatio > 0.5) qualityScore += 10  // Face fills most of image
      if (blobRatio < 0.02) qualityScore += 20 // Very small face
    }

    return {
      faceCount,
      faceQualityScore:    Math.min(100, qualityScore),
      hasSuspiciousQuality: qualityScore >= 40,
      score:               Math.min(100, qualityScore),
      analysisMs:          Date.now() - t0,
      faceConfidence:      faceCount > 0 ? 0.70 : 0,
    }
  } catch (err) {
    console.warn('[faceDetection] Detection failed:', err instanceof Error ? err.message : err)
    return {
      faceCount:            0,
      faceQualityScore:     0,
      hasSuspiciousQuality: false,
      score:                0,
      analysisMs:           Date.now() - t0,
      faceConfidence:       0,
    }
  }
}
