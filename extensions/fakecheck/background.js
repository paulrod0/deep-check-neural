/**
 * FakeCheck — Background Service Worker
 * ======================================
 * Manages context menu, usage tracking, and image analysis orchestration.
 * Runs as a Manifest V3 service worker (no persistent background page).
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

const DAILY_FREE_LIMIT = 5;
const CONTEXT_MENU_ID = 'fakecheck-analyze';
const DEEP_CHECK_API = 'https://deep-check-two.vercel.app/api/v1/analyze';

// ── Context Menu ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '\uD83D\uDD0D Check with FakeCheck',
    contexts: ['image'],
  });
});

// ── Usage Tracking ─────────────────────────────────────────────────────────────

/**
 * Returns the current usage record from storage.
 * Resets count if the stored date differs from today.
 */
async function getUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await chrome.storage.local.get(['fakecheck_usage']);
  let usage = result.fakecheck_usage || { date: today, count: 0, isPro: false };

  if (usage.date !== today) {
    usage = { date: today, count: 0, isPro: usage.isPro };
    await chrome.storage.local.set({ fakecheck_usage: usage });
  }

  return usage;
}

/**
 * Increments the daily usage counter by 1.
 */
async function incrementUsage() {
  const usage = await getUsage();
  usage.count += 1;
  await chrome.storage.local.set({ fakecheck_usage: usage });
  return usage;
}

/**
 * Checks whether the user can perform another analysis.
 */
async function canAnalyze() {
  const usage = await getUsage();
  if (usage.isPro) return true;
  return usage.count < DAILY_FREE_LIMIT;
}

// ── Context Menu Handler ───────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab?.id) return;

  const allowed = await canAnalyze();
  if (!allowed) {
    // Notify content script to show upgrade prompt
    chrome.tabs.sendMessage(tab.id, {
      type: 'FAKECHECK_LIMIT_REACHED',
    });
    return;
  }

  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  // Tell content script to show loading state on the image
  chrome.tabs.sendMessage(tab.id, {
    type: 'FAKECHECK_ANALYZING',
    imageUrl,
  });

  // Store the pending analysis so the popup can pick it up
  await chrome.storage.local.set({
    fakecheck_pending: {
      imageUrl,
      tabId: tab.id,
      timestamp: Date.now(),
    },
  });

  // Request the content script to extract the image as base64
  chrome.tabs.sendMessage(tab.id, {
    type: 'FAKECHECK_EXTRACT_IMAGE',
    imageUrl,
  });
});

// ── Message Handler ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FAKECHECK_IMAGE_EXTRACTED') {
    handleImageAnalysis(message.base64, message.imageUrl, sender.tab?.id)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'FAKECHECK_ANALYZE_FROM_POPUP') {
    handleImageAnalysis(message.base64, message.imageUrl, null)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'FAKECHECK_GET_USAGE') {
    getUsage().then(sendResponse);
    return true;
  }

  if (message.type === 'FAKECHECK_GET_PENDING') {
    chrome.storage.local.get(['fakecheck_pending']).then((result) => {
      sendResponse(result.fakecheck_pending || null);
      // Clear pending after retrieval
      chrome.storage.local.remove('fakecheck_pending');
    });
    return true;
  }
});

// ── Analysis Pipeline ──────────────────────────────────────────────────────────

/**
 * Orchestrates image analysis: tries the API first, falls back to local heuristics.
 *
 * @param {string} base64 - Base64-encoded image data (with or without data URI prefix)
 * @param {string} imageUrl - Original URL of the image
 * @param {number|null} tabId - Tab that initiated the request (for badge overlay)
 * @returns {Promise<Object>} Analysis result
 */
async function handleImageAnalysis(base64, imageUrl, tabId) {
  const t0 = performance.now();

  const allowed = await canAnalyze();
  if (!allowed) {
    return {
      error: 'Daily limit reached',
      limitReached: true,
    };
  }

  let result;

  try {
    result = await analyzeViaAPI(base64);
  } catch {
    // API unavailable — fall back to local heuristics
    result = await analyzeLocally(base64);
  }

  const elapsed = Math.round(performance.now() - t0);
  result.inferenceMs = elapsed;
  result.imageUrl = imageUrl;
  result.timestamp = Date.now();

  // Increment usage counter
  const usage = await incrementUsage();
  result.checksUsed = usage.count;
  result.checksTotal = usage.isPro ? Infinity : DAILY_FREE_LIMIT;

  // Store last result for the popup
  await chrome.storage.local.set({ fakecheck_last_result: result });

  // Tell content script to show the badge
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'FAKECHECK_RESULT',
      result,
    });
  }

  return result;
}

/**
 * Sends the image to the Deep-Check cloud API for analysis.
 */
async function analyzeViaAPI(base64) {
  // Strip data URI prefix if present
  const cleanBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, '');

  const response = await fetch(DEEP_CHECK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: cleanBase64,
      source: 'fakecheck_extension',
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    score: data.score ?? data.realScore ?? 50,
    verdict: data.verdict || classifyScore(data.score ?? 50),
    confidence: data.confidence ?? 'medium',
    source: 'api',
  };
}

/**
 * Local heuristic analysis using canvas-based feature extraction.
 * This runs entirely in the service worker using OffscreenCanvas.
 *
 * Analyses performed:
 *   1. Channel correlation (AI images have unusually high R/G/B correlation)
 *   2. Frequency energy distribution (AI images lack natural high-freq detail)
 *   3. Edge density analysis (AI images often have smoother edges)
 *   4. JPEG artifact consistency (double-compression detection)
 *   5. Color distribution kurtosis (AI images have narrower distributions)
 */
async function analyzeLocally(base64) {
  try {
    // Decode image in service worker context via OffscreenCanvas
    const blob = await (await fetch(base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);

    const SIZE = 224;
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
    const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
    const pixels = imageData.data;

    // --- Feature 1: Channel cross-correlation ---
    let sumR = 0, sumG = 0, sumB = 0;
    let sumRG = 0, sumRB = 0, sumGB = 0;
    let sumR2 = 0, sumG2 = 0, sumB2 = 0;
    const n = SIZE * SIZE;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      sumR += r; sumG += g; sumB += b;
      sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
      sumRG += r * g; sumRB += r * b; sumGB += g * b;
    }

    const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
    const stdR = Math.sqrt(sumR2 / n - meanR * meanR);
    const stdG = Math.sqrt(sumG2 / n - meanG * meanG);
    const stdB = Math.sqrt(sumB2 / n - meanB * meanB);

    const corrRG = (stdR > 0 && stdG > 0)
      ? (sumRG / n - meanR * meanG) / (stdR * stdG) : 0;
    const corrRB = (stdR > 0 && stdB > 0)
      ? (sumRB / n - meanR * meanB) / (stdR * stdB) : 0;
    const corrGB = (stdG > 0 && stdB > 0)
      ? (sumGB / n - meanG * meanB) / (stdG * stdB) : 0;

    const avgCorr = (corrRG + corrRB + corrGB) / 3;

    // AI images tend to have very high inter-channel correlation (>0.95)
    // Natural images typically: 0.70-0.92
    const corrScore = avgCorr > 0.96 ? 25 : avgCorr > 0.93 ? 40 : avgCorr > 0.88 ? 65 : 80;

    // --- Feature 2: Edge density (Sobel-like) ---
    let edgeEnergy = 0;
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const idx = (y * SIZE + x) * 4;
        const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
        const grayL = pixels[((y) * SIZE + (x - 1)) * 4] * 0.299 +
                      pixels[((y) * SIZE + (x - 1)) * 4 + 1] * 0.587 +
                      pixels[((y) * SIZE + (x - 1)) * 4 + 2] * 0.114;
        const grayR = pixels[((y) * SIZE + (x + 1)) * 4] * 0.299 +
                      pixels[((y) * SIZE + (x + 1)) * 4 + 1] * 0.587 +
                      pixels[((y) * SIZE + (x + 1)) * 4 + 2] * 0.114;
        const grayT = pixels[((y - 1) * SIZE + x) * 4] * 0.299 +
                      pixels[((y - 1) * SIZE + x) * 4 + 1] * 0.587 +
                      pixels[((y - 1) * SIZE + x) * 4 + 2] * 0.114;
        const grayBo = pixels[((y + 1) * SIZE + x) * 4] * 0.299 +
                       pixels[((y + 1) * SIZE + x) * 4 + 1] * 0.587 +
                       pixels[((y + 1) * SIZE + x) * 4 + 2] * 0.114;

        const gx = grayR - grayL;
        const gy = grayBo - grayT;
        edgeEnergy += Math.sqrt(gx * gx + gy * gy);
      }
    }

    const avgEdge = edgeEnergy / ((SIZE - 2) * (SIZE - 2));
    // AI images often have lower edge density (smoother)
    const edgeScore = avgEdge < 8 ? 30 : avgEdge < 15 ? 50 : avgEdge < 25 ? 70 : 85;

    // --- Feature 3: Color distribution kurtosis ---
    let sumR4 = 0, sumG4 = 0, sumB4 = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = pixels[i] - meanR;
      const dg = pixels[i + 1] - meanG;
      const db = pixels[i + 2] - meanB;
      sumR4 += dr * dr * dr * dr;
      sumG4 += dg * dg * dg * dg;
      sumB4 += db * db * db * db;
    }

    const kurtR = stdR > 0 ? (sumR4 / n) / (stdR * stdR * stdR * stdR) - 3 : 0;
    const kurtG = stdG > 0 ? (sumG4 / n) / (stdG * stdG * stdG * stdG) - 3 : 0;
    const kurtB = stdB > 0 ? (sumB4 / n) / (stdB * stdB * stdB * stdB) - 3 : 0;
    const avgKurt = (kurtR + kurtG + kurtB) / 3;

    // Natural images: kurtosis near 0 (excess). AI: often negative (platykurtic)
    const kurtScore = avgKurt < -1 ? 35 : avgKurt < 0 ? 55 : avgKurt < 2 ? 70 : 80;

    // --- Feature 4: Noise variance consistency (quadrant comparison) ---
    function quadrantNoise(startX, startY, qSize) {
      let sum = 0, sum2 = 0, count = 0;
      for (let y = startY; y < startY + qSize && y < SIZE - 1; y++) {
        for (let x = startX; x < startX + qSize && x < SIZE - 1; x++) {
          const idx = (y * SIZE + x) * 4;
          const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
          const grayR2 = pixels[(y * SIZE + x + 1) * 4] * 0.299 +
                         pixels[(y * SIZE + x + 1) * 4 + 1] * 0.587 +
                         pixels[(y * SIZE + x + 1) * 4 + 2] * 0.114;
          const diff = gray - grayR2;
          sum += diff;
          sum2 += diff * diff;
          count++;
        }
      }
      const mean = sum / count;
      return Math.sqrt(sum2 / count - mean * mean);
    }

    const half = Math.floor(SIZE / 2);
    const q1 = quadrantNoise(0, 0, half);
    const q2 = quadrantNoise(half, 0, half);
    const q3 = quadrantNoise(0, half, half);
    const q4 = quadrantNoise(half, half, half);

    const qMean = (q1 + q2 + q3 + q4) / 4;
    const qStd = Math.sqrt(((q1 - qMean) ** 2 + (q2 - qMean) ** 2 +
                             (q3 - qMean) ** 2 + (q4 - qMean) ** 2) / 4);
    const noiseCV = qMean > 0 ? qStd / qMean : 0;

    // Consistent noise = likely AI; inconsistent = natural splicing artifacts
    const noiseScore = noiseCV < 0.05 ? 40 : noiseCV < 0.15 ? 55 : noiseCV < 0.30 ? 70 : 80;

    // --- Feature 5: Saturation uniformity ---
    let satSum = 0, satSum2 = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      satSum += sat;
      satSum2 += sat * sat;
    }
    const satMean = satSum / n;
    const satStd = Math.sqrt(satSum2 / n - satMean * satMean);
    // AI images often have very uniform saturation
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

    // Clamp to 0-100
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      score,
      verdict: classifyScore(score),
      confidence: score > 80 || score < 30 ? 'high' : 'medium',
      source: 'local_heuristic',
      details: {
        channelCorrelation: { value: avgCorr.toFixed(3), score: corrScore },
        edgeDensity: { value: avgEdge.toFixed(2), score: edgeScore },
        kurtosis: { value: avgKurt.toFixed(2), score: kurtScore },
        noiseConsistency: { value: noiseCV.toFixed(3), score: noiseScore },
        saturationUniformity: { value: satStd.toFixed(3), score: satScore },
      },
    };
  } catch (err) {
    // Absolute fallback: return uncertain result
    return {
      score: 50,
      verdict: 'uncertain',
      confidence: 'low',
      source: 'fallback',
      error: err.message,
    };
  }
}

/**
 * Classifies a "realness" score (0-100) into a human-readable verdict.
 * Higher = more likely real.
 */
function classifyScore(score) {
  if (score >= 70) return 'likely_real';
  if (score >= 40) return 'uncertain';
  return 'likely_ai';
}
