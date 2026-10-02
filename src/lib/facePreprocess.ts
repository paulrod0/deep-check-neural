/**
 * Shared face preprocessing for all Deep-Check products.
 *
 * Pipeline: detect face → crop → normalize brightness → ImageNet tensor
 *
 * Works on both uploaded images and webcam captures.
 * Uses FaceDetector API (Chrome desktop) → skin-tone heuristic → center crop fallback.
 */

const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD  = [0.229, 0.224, 0.225]
const TARGET_SIZE   = 224

interface FaceBox { x: number; y: number; width: number; height: number }

// ─── Face detection with fallbacks ──────────────────────────────────────────

async function detectFaceInCanvas(canvas: HTMLCanvasElement): Promise<FaceBox | null> {
  // Strategy 1: Browser FaceDetector API (Chrome 70+ desktop)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FD = (window as any).FaceDetector
    if (FD) {
      const detector = new FD({ maxDetectedFaces: 1 })
      const faces = await detector.detect(canvas)
      if (faces.length > 0) {
        const bb = faces[0].boundingBox
        return { x: bb.x, y: bb.y, width: bb.width, height: bb.height }
      }
    }
  } catch { /* not available */ }

  // Strategy 2: Skin-tone heuristic (works on ALL browsers/mobile)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      const w = canvas.width
      const h = canvas.height
      const step = Math.max(2, Math.floor(Math.min(w, h) / 200)) // adaptive step
      const imgData = ctx.getImageData(0, 0, w, h)
      const px = imgData.data

      // Track skin pixels per grid cell for density-based detection
      const gridSize = 16
      const cellW = Math.ceil(w / gridSize)
      const cellH = Math.ceil(h / gridSize)
      const grid = new Uint32Array(gridSize * gridSize)

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4
          const r = px[idx], g = px[idx + 1], b = px[idx + 2]

          // Skin detection (works for diverse skin tones)
          // YCbCr-inspired rules in RGB space
          const maxC = Math.max(r, g, b)
          const minC = Math.min(r, g, b)
          const isSkin = r > 60 && g > 20 && b > 10 &&
                         (maxC - minC) > 12 &&
                         r > g && r > b &&
                         Math.abs(r - g) > 10 &&
                         r < 250 && g < 250 // exclude pure white

          if (isSkin) {
            const gx = Math.min(gridSize - 1, Math.floor(x / cellW))
            const gy = Math.min(gridSize - 1, Math.floor(y / cellH))
            grid[gy * gridSize + gx]++
          }
        }
      }

      // Find the densest cluster of skin (likely the face, not hands/arms)
      let bestScore = 0
      let bestGx = gridSize / 2, bestGy = gridSize / 3 // default: upper center

      for (let gy = 0; gy < gridSize - 2; gy++) {
        for (let gx = 0; gx < gridSize - 2; gx++) {
          // Sum 3x3 neighborhood
          let score = 0
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 3; dx++) {
              score += grid[(gy + dy) * gridSize + (gx + dx)]
            }
          }
          if (score > bestScore) {
            bestScore = score
            bestGx = gx + 1 // center of 3x3
            bestGy = gy + 1
          }
        }
      }

      if (bestScore > 5) {
        // Estimate face region from the densest skin cluster
        // Face is roughly 1/4 to 1/3 of image width for a typical portrait
        const faceSizeEstimate = Math.min(w, h) * 0.35
        const cx = (bestGx + 0.5) * cellW
        const cy = (bestGy + 0.5) * cellH
        return {
          x: Math.max(0, cx - faceSizeEstimate / 2),
          y: Math.max(0, cy - faceSizeEstimate / 2),
          width: Math.min(w - Math.max(0, cx - faceSizeEstimate / 2), faceSizeEstimate),
          height: Math.min(h - Math.max(0, cy - faceSizeEstimate / 2), faceSizeEstimate),
        }
      }
    }
  } catch { /* skin detection failed */ }

  return null // will use smart center crop
}

// ─── Brightness normalization (gamma correction) ────────────────────────────

function normalizeBrightness(pixels: Uint8ClampedArray, numPixels: number): void {
  let totalLum = 0
  for (let i = 0; i < numPixels; i++) {
    totalLum += 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]
  }
  const avgLum = totalLum / numPixels

  const TARGET_LUM = 128
  if (avgLum < 110 && avgLum > 5) {
    const gamma = Math.log(TARGET_LUM / 255) / Math.log(avgLum / 255)
    const lut = new Uint8Array(256)
    for (let v = 0; v < 256; v++) {
      lut[v] = Math.min(255, Math.round(255 * Math.pow(v / 255, gamma)))
    }
    for (let i = 0; i < numPixels; i++) {
      pixels[i * 4]     = lut[pixels[i * 4]]
      pixels[i * 4 + 1] = lut[pixels[i * 4 + 1]]
      pixels[i * 4 + 2] = lut[pixels[i * 4 + 2]]
    }
  }
}

// ─── Main preprocessing: image → face-cropped ImageNet tensor ───────────────

/**
 * Preprocess an image for the deepfake detection model:
 * 1. Detect face region (FaceDetector → skin heuristic → center crop)
 * 2. Crop to face with padding
 * 3. Normalize brightness
 * 4. Resize to 224×224
 * 5. Convert to CHW float32 ImageNet-normalized tensor
 */
export async function preprocessImageForModel(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): Promise<Float32Array> {
  // Draw source to canvas for processing
  const srcCanvas = document.createElement('canvas')
  if (source instanceof HTMLVideoElement) {
    srcCanvas.width = source.videoWidth || 640
    srcCanvas.height = source.videoHeight || 480
  } else if (source instanceof HTMLCanvasElement) {
    srcCanvas.width = source.width
    srcCanvas.height = source.height
  } else {
    srcCanvas.width = source.naturalWidth || source.width
    srcCanvas.height = source.naturalHeight || source.height
  }
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!
  srcCtx.drawImage(source, 0, 0, srcCanvas.width, srcCanvas.height)

  const w = srcCanvas.width
  const h = srcCanvas.height

  // Detect face
  const face = await detectFaceInCanvas(srcCanvas)

  let cropX: number, cropY: number, cropW: number, cropH: number

  if (face) {
    // Expand bounding box by 25% for context
    const pad = 0.25
    const padX = face.width * pad
    const padY = face.height * pad
    cropX = Math.max(0, Math.round(face.x - padX))
    cropY = Math.max(0, Math.round(face.y - padY))
    cropW = Math.min(w - cropX, Math.round(face.width + 2 * padX))
    cropH = Math.min(h - cropY, Math.round(face.height + 2 * padY))
  } else {
    // Smart center crop: assume face in upper-center ~50% of image
    const cropSize = Math.round(Math.min(w, h) * 0.55)
    cropX = Math.round((w - cropSize) / 2)
    cropY = Math.max(0, Math.round((h - cropSize) / 2 - h * 0.08))
    cropW = cropSize
    cropH = cropSize
  }

  // Make square
  const side = Math.max(cropW, cropH)
  const cx = cropX + cropW / 2
  const cy = cropY + cropH / 2
  cropX = Math.max(0, Math.round(cx - side / 2))
  cropY = Math.max(0, Math.round(cy - side / 2))
  cropW = Math.min(w - cropX, Math.round(side))
  cropH = Math.min(h - cropY, Math.round(side))

  // Resize to 224×224
  const resized = document.createElement('canvas')
  resized.width = TARGET_SIZE
  resized.height = TARGET_SIZE
  const rctx = resized.getContext('2d', { willReadFrequently: true })!
  rctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, TARGET_SIZE, TARGET_SIZE)
  const imgData = rctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE)
  const pixels = imgData.data
  const numPixels = TARGET_SIZE * TARGET_SIZE

  // Normalize brightness
  normalizeBrightness(pixels, numPixels)

  // Convert to CHW float32 ImageNet tensor
  const tensor = new Float32Array(3 * numPixels)
  for (let i = 0; i < numPixels; i++) {
    const r = pixels[i * 4] / 255
    const g = pixels[i * 4 + 1] / 255
    const b = pixels[i * 4 + 2] / 255
    tensor[i]                  = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
    tensor[numPixels + i]      = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
    tensor[2 * numPixels + i]  = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
  }
  return tensor
}

/**
 * Simple preprocess without face detection (for documents, listings, etc.)
 * Just resizes and normalizes.
 */
export function preprocessImageSimple(source: HTMLImageElement | HTMLCanvasElement): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  if (source instanceof HTMLCanvasElement) {
    ctx.drawImage(source, 0, 0, TARGET_SIZE, TARGET_SIZE)
  } else {
    ctx.drawImage(source, 0, 0, TARGET_SIZE, TARGET_SIZE)
  }

  const pixels = ctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE).data
  const numPixels = TARGET_SIZE * TARGET_SIZE

  normalizeBrightness(pixels, numPixels)

  const tensor = new Float32Array(3 * numPixels)
  for (let i = 0; i < numPixels; i++) {
    const r = pixels[i * 4] / 255
    const g = pixels[i * 4 + 1] / 255
    const b = pixels[i * 4 + 2] / 255
    tensor[i]                  = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
    tensor[numPixels + i]      = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
    tensor[2 * numPixels + i]  = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
  }
  return tensor
}

/**
 * Calibrate raw pFake score to human-friendly score.
 * Accounts for the SEVERE domain gap between training data and real-world photos.
 *
 * The model was trained on StyleGAN2/FFHQ — clean dataset images.
 * Real-world photos (phone cameras, social media compression, varied lighting)
 * routinely produce pFake values of 0.70–0.93 even for GENUINE photos.
 * Only pFake > 0.985 reliably indicates AI generation in the wild.
 *
 * Returns a score 1-99 where higher = more likely real/human.
 */
export function calibrateScore(pFake: number): number {
  let score: number
  if (pFake <= 0.50) {
    // Very confident real — low model output
    score = 99
  } else if (pFake <= 0.85) {
    // Domain gap zone — most real-world photos land here (0.60–0.85)
    // Map to 92–99: these are almost certainly real
    score = Math.round(99 - (pFake - 0.50) / 0.35 * 7)
  } else if (pFake <= 0.94) {
    // Upper domain gap — real photos with heavy compression/filters
    // Map to 80–92: very likely real, slight uncertainty
    score = Math.round(92 - (pFake - 0.85) / 0.09 * 12)
  } else if (pFake <= 0.985) {
    // Ambiguous zone — could be heavily processed real or good AI
    // Map to 35–80: moderate uncertainty
    score = Math.round(80 - (pFake - 0.94) / 0.045 * 45)
  } else {
    // Very high confidence AI — only the strongest signals
    // Map to 1–35: likely AI-generated
    score = Math.round(35 - (pFake - 0.985) / 0.015 * 34)
  }
  return Math.max(1, Math.min(99, score))
}

export { TARGET_SIZE, IMAGENET_MEAN, IMAGENET_STD }
