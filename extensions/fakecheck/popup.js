/**
 * FakeCheck — Popup Controller
 * ==============================
 * Manages the popup UI: file drop, URL input, analysis triggering,
 * result display with animated gauge, sharing, and usage tracking.
 */

'use strict';

(() => {
  // ── DOM References ─────────────────────────────────────────────────────────

  const views = {
    input: document.getElementById('view-input'),
    loading: document.getElementById('view-loading'),
    result: document.getElementById('view-result'),
    error: document.getElementById('view-error'),
    limit: document.getElementById('view-limit'),
  };

  const els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('file-input'),
    urlInput: document.getElementById('url-input'),
    btnCheckUrl: document.getElementById('btn-check-url'),
    gaugeFill: document.getElementById('gauge-fill'),
    gaugeScore: document.getElementById('gauge-score'),
    resultThumbnail: document.getElementById('result-thumbnail'),
    resultVerdict: document.getElementById('result-verdict'),
    metaConfidence: document.getElementById('meta-confidence'),
    metaInference: document.getElementById('meta-inference'),
    metaSource: document.getElementById('meta-source'),
    btnShare: document.getElementById('btn-share'),
    btnNewCheck: document.getElementById('btn-new-check'),
    btnErrorRetry: document.getElementById('btn-error-retry'),
    usageText: document.getElementById('usage-text'),
    usageFill: document.getElementById('usage-fill'),
    errorMessage: document.getElementById('error-message'),
  };

  // ── State ──────────────────────────────────────────────────────────────────

  let currentBase64 = null;
  let lastResult = null;

  // ── View Management ────────────────────────────────────────────────────────

  function showView(name) {
    Object.values(views).forEach((v) => v.classList.remove('active'));
    if (views[name]) views[name].classList.add('active');
  }

  // ── Usage Display ──────────────────────────────────────────────────────────

  async function updateUsage() {
    try {
      const usage = await sendMessage({ type: 'FAKECHECK_GET_USAGE' });
      if (!usage) return;

      const used = usage.count || 0;
      const total = usage.isPro ? 'unlimited' : 5;
      const remaining = usage.isPro ? 'unlimited' : Math.max(0, 5 - used);

      if (usage.isPro) {
        els.usageText.textContent = 'Pro plan \u2014 unlimited checks';
        els.usageFill.style.width = '100%';
        els.usageFill.className = 'usage-fill';
      } else {
        els.usageText.textContent = `${used} of ${total} free checks today`;
        const pct = Math.min(100, (used / 5) * 100);
        els.usageFill.style.width = `${pct}%`;

        if (pct >= 100) {
          els.usageFill.className = 'usage-fill danger';
        } else if (pct >= 60) {
          els.usageFill.className = 'usage-fill warning';
        } else {
          els.usageFill.className = 'usage-fill';
        }

        if (remaining === 0) {
          showView('limit');
          return false;
        }
      }

      return true;
    } catch {
      return true;
    }
  }

  // ── File Handling ──────────────────────────────────────────────────────────

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showError('Please provide a valid image file.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      showError('Image too large (max 20 MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      currentBase64 = e.target.result;
      analyzeImage(currentBase64);
    };
    reader.onerror = () => showError('Failed to read file.');
    reader.readAsDataURL(file);
  }

  // ── URL Handling ───────────────────────────────────────────────────────────

  async function handleUrl(url) {
    if (!url) return;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      showError('Please enter a valid URL.');
      return;
    }

    showView('loading');

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        showError('URL does not point to an image.');
        return;
      }

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);
      currentBase64 = base64;
      analyzeImage(base64, url);
    } catch (err) {
      showError(`Could not fetch image: ${err.message}`);
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  async function analyzeImage(base64, imageUrl) {
    showView('loading');

    try {
      const result = await sendMessage({
        type: 'FAKECHECK_ANALYZE_FROM_POPUP',
        base64,
        imageUrl: imageUrl || 'local_upload',
      });

      if (result && result.error) {
        if (result.limitReached) {
          showView('limit');
        } else {
          showError(result.error);
        }
        return;
      }

      lastResult = result;
      showResult(result, base64);
      updateUsage();
    } catch (err) {
      showError(`Analysis failed: ${err.message}`);
    }
  }

  // ── Result Display ─────────────────────────────────────────────────────────

  function showResult(result, base64) {
    showView('result');

    // Thumbnail
    if (base64) {
      els.resultThumbnail.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
      els.resultThumbnail.style.display = 'block';
    } else {
      els.resultThumbnail.style.display = 'none';
    }

    // Animated gauge
    const score = result.score || 0;
    const circumference = 2 * Math.PI * 50; // r=50
    const offset = circumference - (score / 100) * circumference;

    let gaugeColor;
    if (score >= 70) gaugeColor = '#00ff9d';
    else if (score >= 40) gaugeColor = '#ffd700';
    else gaugeColor = '#ff4d4d';

    // Set initial state then animate
    els.gaugeFill.style.transition = 'none';
    els.gaugeFill.setAttribute('stroke-dashoffset', circumference);
    els.gaugeFill.setAttribute('stroke', gaugeColor);

    // Force reflow before animation
    void els.gaugeFill.getBoundingClientRect();

    els.gaugeFill.style.transition = 'stroke-dashoffset 1s ease-out';
    els.gaugeFill.setAttribute('stroke-dashoffset', offset);

    // Animate score number
    animateCounter(els.gaugeScore, 0, score, 800);

    // Verdict
    let verdictText, verdictClass;
    switch (result.verdict) {
      case 'likely_real':
        verdictText = '\u2705 Likely Real';
        verdictClass = 'verdict--real';
        break;
      case 'likely_ai':
        verdictText = '\u274C Likely AI-Generated';
        verdictClass = 'verdict--ai';
        break;
      default:
        verdictText = '\u26A0\uFE0F Possibly AI';
        verdictClass = 'verdict--uncertain';
    }
    els.resultVerdict.textContent = verdictText;
    els.resultVerdict.className = `verdict ${verdictClass}`;

    // Meta
    const confidence = result.confidence || 'medium';
    els.metaConfidence.textContent = confidence.charAt(0).toUpperCase() + confidence.slice(1);

    const ms = result.inferenceMs || 0;
    els.metaInference.textContent = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

    const sourceLabels = {
      onnx: 'Neural',
      api: 'Cloud',
      local_heuristic: 'Heuristic',
      fallback: 'Fallback',
    };
    els.metaSource.textContent = sourceLabels[result.source] || result.source || 'Local';
  }

  /**
   * Animates a number counter from start to end over the given duration.
   */
  function animateCounter(element, start, end, duration) {
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);

      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  // ── Error Display ──────────────────────────────────────────────────────────

  function showError(message) {
    els.errorMessage.textContent = message;
    showView('error');
  }

  // ── Sharing ────────────────────────────────────────────────────────────────

  function shareResult() {
    if (!lastResult) return;

    const score = lastResult.score || 0;
    let verdict;
    switch (lastResult.verdict) {
      case 'likely_real': verdict = 'Likely Real'; break;
      case 'likely_ai': verdict = 'Likely AI-Generated'; break;
      default: verdict = 'Uncertain';
    }

    const text = `I just checked an image with FakeCheck by @DeepCheckAI:\n\n` +
      `Score: ${score}% Real \u2014 ${verdict}\n\n` +
      `Check your images for free: https://deep-check-two.vercel.app`;

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  }

  // ── Message Helper ─────────────────────────────────────────────────────────

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── Clipboard Paste ────────────────────────────────────────────────────────

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFile(file);
        return;
      }
    }
  }

  // ── Event Listeners ────────────────────────────────────────────────────────

  // File input
  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // Drag & drop
  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });

  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
  });

  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  });

  // URL check
  els.btnCheckUrl.addEventListener('click', () => {
    handleUrl(els.urlInput.value.trim());
  });

  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleUrl(els.urlInput.value.trim());
    }
  });

  // Share
  els.btnShare.addEventListener('click', shareResult);

  // New check
  els.btnNewCheck.addEventListener('click', () => {
    currentBase64 = null;
    lastResult = null;
    els.urlInput.value = '';
    els.fileInput.value = '';
    showView('input');
  });

  // Error retry
  els.btnErrorRetry.addEventListener('click', () => {
    showView('input');
  });

  // Paste support
  document.addEventListener('paste', handlePaste);

  // ── Pending Analysis (from context menu) ───────────────────────────────────

  async function checkPendingAnalysis() {
    try {
      const pending = await sendMessage({ type: 'FAKECHECK_GET_PENDING' });
      if (pending && pending.imageUrl) {
        showView('loading');

        // Check if we already have the result
        const stored = await chrome.storage.local.get(['fakecheck_last_result']);
        const lastStored = stored.fakecheck_last_result;

        if (lastStored && lastStored.imageUrl === pending.imageUrl &&
            lastStored.timestamp > pending.timestamp - 5000) {
          lastResult = lastStored;
          showResult(lastStored, null);
          els.resultThumbnail.src = pending.imageUrl;
          els.resultThumbnail.style.display = 'block';
          return;
        }

        // Result not ready yet — show loading and poll
        const checkResult = () => {
          chrome.storage.local.get(['fakecheck_last_result'], (stored2) => {
            const result = stored2.fakecheck_last_result;
            if (result && result.imageUrl === pending.imageUrl) {
              lastResult = result;
              showResult(result, null);
              els.resultThumbnail.src = pending.imageUrl;
              els.resultThumbnail.style.display = 'block';
            } else {
              setTimeout(checkResult, 500);
            }
          });
        };
        setTimeout(checkResult, 500);
      }
    } catch {
      // No pending analysis
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    const canContinue = await updateUsage();
    if (canContinue !== false) {
      checkPendingAnalysis();
    }
  }

  init();
})();
