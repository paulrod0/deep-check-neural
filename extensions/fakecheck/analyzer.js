/**
 * FakeCheck — Image Analyzer
 * ============================
 * Client-side image analysis module. Provides:
 *   1. Canvas-based preprocessing (resize, normalize, CHW layout)
 *   2. ONNX Runtime inference (when model is bundled)
 *   3. Heuristic fallback analysis (always available)
 *
 * ONNX Contract (matches Deep-Check's deepfake_pixel_v1.onnx):
 *   Input:  "face_image" [batch, 3, 224, 224] float32 (ImageNet normalized)
 *   Output: "logit" [batch] float32 (sigmoid -> P(fake))
 *   Opset:  17
 */

'use strict';

const FakeCheckAnalyzer = (() => {
  // ── Constants ──────────────────────────────────────────────────────────────

  const INPUT_SIZE = 224;

  // ImageNet normalization parameters
  const IMAGENET_MEAN = [0.485, 0.456, 0.406];
  const IMAGENET_STD = [0.229, 0.224, 0.225];

  // Deep-Check cloud API
  const API_ENDPOINT = 'https://deep-check-two.vercel.app/api/v1/analyze';

  // ── Preprocessing ──────────────────────────────────────────────────────────

  /**
   * Loads a base64 image string into an HTMLImageElement.
   * @param {string} base64 - Base64-encoded image (data URI or raw)
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(base64) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    });
  }

  /**
   * Preprocesses an image for ONNX inference:
   *   1. Resize to 224x224 (bilinear)
   *   2. Convert to float32 [0, 1]
   *   3. ImageNet normalize per channel
   *   4. Rearrange to CHW layout
   *
   * @param {HTMLImageElement} img
   * @returns {Float32Array} Tensor data [1, 3, 224, 224]
   */
  function preprocessForONNX(img) {
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const pixels = imageData.data;

    // CHW layout: [C, H, W] with ImageNet normalization
    const tensorSize = 3 * INPUT_SIZE * INPUT_SIZE;
    const tensor = new Float32Array(tensorSize);

    for (let y = 0; y < INPUT_SIZE; y++) {
      for (let x = 0; x < INPUT_SIZE; x++) {
        const srcIdx = (y * INPUT_SIZE + x) * 4;
        const dstIdx = y * INPUT_SIZE + x;

        // R channel
        tensor[0 * INPUT_SIZE * INPUT_SIZE + dstIdx] =
          (pixels[srcIdx] / 255.0 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        // G channel
        tensor[1 * INPUT_SIZE * INPUT_SIZE + dstIdx] =
          (pixels[srcIdx + 1] / 255.0 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        // B channel
        tensor[2 * INPUT_SIZE * INPUT_SIZE + dstIdx] =
          (pixels[srcIdx + 2] / 255.0 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
      }
    }

    return tensor;
  }

  /**
   * Extracts raw pixel data for heuristic analysis (HWC uint8).
   * @param {HTMLImageElement} img
   * @returns {{ pixels: Uint8ClampedArray, width: number, height: number }}
   */
  function extractPixels(img) {
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    return {
      pixels: imageData.data,
      width: INPUT_SIZE,
      height: INPUT_SIZE,
    };
  }

  // ── Heuristic Analysis ─────────────────────────────────────────────────────

  /**
   * Multi-feature heuristic analysis for AI-generated image detection.
   * Runs entirely client-side using canvas pixel data.
   *
   * Features:
   *   1. Inter-channel correlation (AI images have unnaturally high R/G/B correlation)
   *   2. Edge density via Sobel operator (AI images tend to be smoother)
   *   3. Excess kurtosis per channel (AI images are often platykurtic)
   *   4. Quadrant noise consistency (AI images have uniform noise)
   *   5. Saturation variance (AI images have more uniform saturation)
   *
   * @param {Uint8ClampedArray} pixels - RGBA pixel data
   * @param {number} width
   * @param {number} height
   * @returns {Object} Analysis result
   */
  function heuristicAnalysis(pixels, width, height) {
    const n = width * height;

    // --- Feature 1: Channel cross-correlation ---
    let sumR = 0, sumG = 0, sumB = 0;
    let sumRG = 0, sumRB = 0, sumGB = 0;
    let sumR2 = 0, sumG2 = 0, sumB2 = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      sumR += r; sumG += g; sumB += b;
      sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
      sumRG += r * g; sumRB += r * b; sumGB += g * b;
    }

    const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
    const stdR = Math.sqrt(Math.max(0, sumR2 / n - meanR * meanR));
    const stdG = Math.sqrt(Math.max(0, sumG2 / n - meanG * meanG));
    const stdB = Math.sqrt(Math.max(0, sumB2 / n - meanB * meanB));

    const corrRG = (stdR > 0 && stdG > 0)
      ? (sumRG / n - meanR * meanG) / (stdR * stdG) : 0;
    const corrRB = (stdR > 0 && stdB > 0)
      ? (sumRB / n - meanR * meanB) / (stdR * stdB) : 0;
    const corrGB = (stdG > 0 && stdB > 0)
      ? (sumGB / n - meanG * meanB) / (stdG * stdB) : 0;

    const avgCorr = (corrRG + corrRB + corrGB) / 3;
    const corrScore = avgCorr > 0.96 ? 25 : avgCorr > 0.93 ? 40 : avgCorr > 0.88 ? 65 : 80;

    // --- Feature 2: Edge density (Sobel-like) ---
    let edgeEnergy = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const grayC = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
        const grayL = pixels[((y) * width + (x - 1)) * 4] * 0.299 +
                      pixels[((y) * width + (x - 1)) * 4 + 1] * 0.587 +
                      pixels[((y) * width + (x - 1)) * 4 + 2] * 0.114;
        const grayRt = pixels[((y) * width + (x + 1)) * 4] * 0.299 +
                       pixels[((y) * width + (x + 1)) * 4 + 1] * 0.587 +
                       pixels[((y) * width + (x + 1)) * 4 + 2] * 0.114;
        const grayT = pixels[((y - 1) * width + x) * 4] * 0.299 +
                      pixels[((y - 1) * width + x) * 4 + 1] * 0.587 +
                      pixels[((y - 1) * width + x) * 4 + 2] * 0.114;
        const grayBo = pixels[((y + 1) * width + x) * 4] * 0.299 +
                       pixels[((y + 1) * width + x) * 4 + 1] * 0.587 +
                       pixels[((y + 1) * width + x) * 4 + 2] * 0.114;

        const gx = grayRt - grayL;
        const gy = grayBo - grayT;
        edgeEnergy += Math.sqrt(gx * gx + gy * gy);
      }
    }

    const avgEdge = edgeEnergy / ((width - 2) * (height - 2));
    const edgeScore = avgEdge < 8 ? 30 : avgEdge < 15 ? 50 : avgEdge < 25 ? 70 : 85;

    // --- Feature 3: Excess kurtosis per channel ---
    let sumR4 = 0, sumG4 = 0, sumB4 = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = pixels[i] - meanR;
      const dg = pixels[i + 1] - meanG;
      const db = pixels[i + 2] - meanB;
      sumR4 += dr * dr * dr * dr;
      sumG4 += dg * dg * dg * dg;
      sumB4 += db * db * db * db;
    }

    const kurtR = stdR > 0 ? (sumR4 / n) / (stdR ** 4) - 3 : 0;
    const kurtG = stdG > 0 ? (sumG4 / n) / (stdG ** 4) - 3 : 0;
    const kurtB = stdB > 0 ? (sumB4 / n) / (stdB ** 4) - 3 : 0;
    const avgKurt = (kurtR + kurtG + kurtB) / 3;
    const kurtScore = avgKurt < -1 ? 35 : avgKurt < 0 ? 55 : avgKurt < 2 ? 70 : 80;

    // --- Feature 4: Quadrant noise consistency ---
    function quadrantNoise(startX, startY, qSize) {
      let sum = 0, sum2 = 0, count = 0;
      for (let y = startY; y < startY + qSize && y < height - 1; y++) {
        for (let x = startX; x < startX + qSize && x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
          const grayR2 = pixels[(y * width + x + 1) * 4] * 0.299 +
                         pixels[(y * width + x + 1) * 4 + 1] * 0.587 +
                         pixels[(y * width + x + 1) * 4 + 2] * 0.114;
          const diff = gray - grayR2;
          sum += diff;
          sum2 += diff * diff;
          count++;
        }
      }
      if (count === 0) return 0;
      const mean = sum / count;
      return Math.sqrt(Math.max(0, sum2 / count - mean * mean));
    }

    const half = Math.floor(width / 2);
    const q1 = quadrantNoise(0, 0, half);
    const q2 = quadrantNoise(half, 0, half);
    const q3 = quadrantNoise(0, half, half);
    const q4 = quadrantNoise(half, half, half);

    const qMean = (q1 + q2 + q3 + q4) / 4;
    const qStd = Math.sqrt(((q1 - qMean) ** 2 + (q2 - qMean) ** 2 +
                             (q3 - qMean) ** 2 + (q4 - qMean) ** 2) / 4);
    const noiseCV = qMean > 0 ? qStd / qMean : 0;
    const noiseScore = noiseCV < 0.05 ? 40 : noiseCV < 0.15 ? 55 : noiseCV < 0.30 ? 70 : 80;

    // --- Feature 5: Saturation variance ---
    let satSum = 0, satSum2 = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      satSum += sat;
      satSum2 += sat * sat;
    }
    const satMean = satSum / n;
    const satStd = Math.sqrt(Math.max(0, satSum2 / n - satMean * satMean));
    const satScore = satStd < 0.08 ? 35 : satStd < 0.15 ? 50 : satStd < 0.25 ? 70 : 82;

    // --- Weighted ensemble ---
    const weights = { corr: 0.25, edge: 0.20, kurt: 0.15, noise: 0.20, sat: 0.20 };
    const rawScore = (
      corrScore * weights.corr +
      edgeScore * weights.edge +
      kurtScore * weights.kurt +
      noiseScore * weights.noise +
      satScore * weights.sat
    );

    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      score,
      confidence: score > 80 || score < 30 ? 'high' : 'medium',
      details: {
        channelCorrelation: { value: avgCorr.toFixed(3), partialScore: corrScore },
        edgeDensity: { value: avgEdge.toFixed(2), partialScore: edgeScore },
        kurtosis: { value: avgKurt.toFixed(2), partialScore: kurtScore },
        noiseConsistency: { value: noiseCV.toFixed(3), partialScore: noiseScore },
        saturationVariance: { value: satStd.toFixed(3), partialScore: satScore },
      },
    };
  }

  // ── ONNX Inference (stub for bundled model) ────────────────────────────────

  /**
   * Attempts ONNX Runtime inference if the library and model are available.
   * Returns null if ONNX is not loaded (falls back to heuristics).
   *
   * @param {Float32Array} tensorData - Preprocessed [1, 3, 224, 224] tensor
   * @returns {Promise<number|null>} P(fake) or null
   */
  async function tryONNXInference(tensorData) {
    // Check if ONNX Runtime is available (would need to be loaded separately)
    if (typeof ort === 'undefined') return null;

    try {
      const session = await ort.InferenceSession.create(
        chrome.runtime.getURL('models/deepfake_pixel_v1.onnx')
      );

      const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const results = await session.run({ face_image: inputTensor });
      const logit = results.logit.data[0];

      // Sigmoid to get P(fake)
      const pFake = 1.0 / (1.0 + Math.exp(-logit));
      return pFake;
    } catch {
      return null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Analyzes an image for AI-generation indicators.
   *
   * Pipeline:
   *   1. Try ONNX model (most accurate)
   *   2. Try Deep-Check cloud API
   *   3. Fall back to local heuristics (always works)
   *
   * @param {string} base64 - Base64-encoded image
   * @returns {Promise<Object>} Analysis result with score, verdict, confidence
   */
  async function analyze(base64) {
    const t0 = performance.now();

    const img = await loadImage(base64);
    const { pixels, width, height } = extractPixels(img);

    let result;

    // Strategy 1: Try ONNX inference
    const tensorData = preprocessForONNX(img);
    const pFake = await tryONNXInference(tensorData);

    if (pFake !== null) {
      const realScore = Math.round((1 - pFake) * 100);
      result = {
        score: realScore,
        verdict: classifyScore(realScore),
        confidence: pFake > 0.9 || pFake < 0.1 ? 'high' : 'medium',
        source: 'onnx',
      };
    } else {
      // Strategy 2: Cloud API (handled by background.js)
      // Strategy 3: Local heuristics
      const heuristic = heuristicAnalysis(pixels, width, height);
      result = {
        score: heuristic.score,
        verdict: classifyScore(heuristic.score),
        confidence: heuristic.confidence,
        source: 'local_heuristic',
        details: heuristic.details,
      };
    }

    result.inferenceMs = Math.round(performance.now() - t0);
    return result;
  }

  /**
   * Classifies a "realness" score (0-100) into a verdict.
   */
  function classifyScore(score) {
    if (score >= 70) return 'likely_real';
    if (score >= 40) return 'uncertain';
    return 'likely_ai';
  }

  return {
    analyze,
    preprocessForONNX,
    extractPixels,
    heuristicAnalysis,
    classifyScore,
    INPUT_SIZE,
    IMAGENET_MEAN,
    IMAGENET_STD,
  };
})();

// Export for use in popup.js and background.js
if (typeof globalThis !== 'undefined') {
  globalThis.FakeCheckAnalyzer = FakeCheckAnalyzer;
}
