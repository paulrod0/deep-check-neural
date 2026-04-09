/**
 * FakeCheck — Content Script
 * ===========================
 * Injected into every page. Handles:
 *   - Extracting clicked images as base64 for analysis
 *   - Displaying floating analysis badges on analyzed images
 *   - Showing upgrade prompts when daily limit is reached
 */

'use strict';

(() => {
  // Prevent double-injection
  if (window.__fakecheck_injected) return;
  window.__fakecheck_injected = true;

  // ── Styles ─────────────────────────────────────────────────────────────────

  const BADGE_STYLES = `
    .fakecheck-badge {
      position: absolute;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.02em;
      cursor: default;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      transition: opacity 0.3s ease;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .fakecheck-badge--real {
      background: rgba(0, 255, 157, 0.15);
      border: 1px solid rgba(0, 255, 157, 0.4);
      color: #00ff9d;
    }
    .fakecheck-badge--uncertain {
      background: rgba(255, 215, 0, 0.15);
      border: 1px solid rgba(255, 215, 0, 0.4);
      color: #ffd700;
    }
    .fakecheck-badge--ai {
      background: rgba(255, 77, 77, 0.15);
      border: 1px solid rgba(255, 77, 77, 0.4);
      color: #ff4d4d;
    }
    .fakecheck-loading {
      position: absolute;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(0, 255, 157, 0.3);
      color: #00ff9d;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .fakecheck-loading-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #00ff9d;
      animation: fakecheck-pulse 1.2s infinite;
    }
    .fakecheck-loading-dot:nth-child(2) { animation-delay: 0.2s; }
    .fakecheck-loading-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes fakecheck-pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.2); }
    }
    .fakecheck-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      padding: 12px 20px;
      border-radius: 10px;
      background: rgba(10, 10, 15, 0.95);
      border: 1px solid rgba(255, 77, 77, 0.4);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      animation: fakecheck-slide-in 0.3s ease-out;
    }
    .fakecheck-toast a {
      color: #00ff9d;
      text-decoration: underline;
      cursor: pointer;
    }
    @keyframes fakecheck-slide-in {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;

  // Inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = BADGE_STYLES;
  document.head.appendChild(styleSheet);

  // ── Badge Management ───────────────────────────────────────────────────────

  /**
   * Finds the <img> element on the page matching a given src URL.
   */
  function findImageElement(imageUrl) {
    const images = document.querySelectorAll('img');
    for (const img of images) {
      if (img.src === imageUrl || img.currentSrc === imageUrl) {
        return img;
      }
    }
    // Try matching by partial URL (some images use relative paths)
    for (const img of images) {
      try {
        const imgURL = new URL(img.src, window.location.href);
        const targetURL = new URL(imageUrl, window.location.href);
        if (imgURL.pathname === targetURL.pathname) return img;
      } catch {
        // Invalid URL — skip
      }
    }
    return null;
  }

  /**
   * Positions a badge element at the top-right corner of an image.
   */
  function positionBadge(badge, img) {
    const rect = img.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    badge.style.top = `${rect.top + scrollY + 6}px`;
    badge.style.left = `${rect.right + scrollX - badge.offsetWidth - 6}px`;
  }

  /**
   * Shows a loading indicator on an image being analyzed.
   */
  function showLoading(imageUrl) {
    removeLoading(imageUrl);

    const img = findImageElement(imageUrl);
    if (!img) return;

    const loader = document.createElement('div');
    loader.className = 'fakecheck-loading';
    loader.dataset.fakecheckUrl = imageUrl;

    // Build loading dots via DOM (safe)
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'fakecheck-loading-dot';
      loader.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = 'Analyzing...';
    loader.appendChild(label);

    document.body.appendChild(loader);
    positionBadge(loader, img);
  }

  /**
   * Removes the loading indicator for an image.
   */
  function removeLoading(imageUrl) {
    const existing = document.querySelector(
      `.fakecheck-loading[data-fakecheck-url="${CSS.escape(imageUrl)}"]`
    );
    if (existing) existing.remove();
  }

  /**
   * Shows a verdict badge on an analyzed image.
   */
  function showBadge(result) {
    const img = findImageElement(result.imageUrl);
    if (!img) return;

    removeLoading(result.imageUrl);

    // Remove any existing badge for this image
    const existing = document.querySelector(
      `.fakecheck-badge[data-fakecheck-url="${CSS.escape(result.imageUrl)}"]`
    );
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.dataset.fakecheckUrl = result.imageUrl;

    let badgeClass, labelText;
    if (result.verdict === 'likely_real') {
      badgeClass = 'fakecheck-badge--real';
      labelText = '\u2705 Real';
    } else if (result.verdict === 'likely_ai') {
      badgeClass = 'fakecheck-badge--ai';
      labelText = '\u274C AI';
    } else {
      badgeClass = 'fakecheck-badge--uncertain';
      labelText = '\u26A0\uFE0F Uncertain';
    }

    badge.className = `fakecheck-badge ${badgeClass}`;
    badge.textContent = labelText;
    badge.title = `FakeCheck: ${result.score}% real (${result.source})`;

    document.body.appendChild(badge);
    positionBadge(badge, img);

    // Auto-fade after 10 seconds
    setTimeout(() => {
      if (badge.parentNode) {
        badge.style.opacity = '0';
        setTimeout(() => badge.remove(), 300);
      }
    }, 10000);
  }

  /**
   * Shows a toast notification for limit-reached or errors.
   * Uses safe DOM construction (no innerHTML).
   */
  function showToast(textContent, linkHref, linkText, duration) {
    duration = duration || 5000;

    // Remove any existing toast
    const existing = document.querySelector('.fakecheck-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'fakecheck-toast';

    const textNode = document.createTextNode(textContent + ' ');
    toast.appendChild(textNode);

    if (linkHref && linkText) {
      const link = document.createElement('a');
      link.href = linkHref;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = linkText;
      toast.appendChild(link);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  // ── Image Extraction ───────────────────────────────────────────────────────

  /**
   * Extracts an image as base64 by drawing it to a canvas.
   * Handles CORS by fetching the image as a blob first.
   */
  async function extractImageAsBase64(imageUrl) {
    try {
      // Try direct canvas extraction first
      const img = findImageElement(imageUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL('image/jpeg', 0.92);
        } catch {
          // CORS — fall through to fetch approach
        }
      }

      // Fetch as blob to bypass CORS
      const response = await fetch(imageUrl, { mode: 'cors' });
      const blob = await response.blob();
      return await blobToBase64(blob);
    } catch {
      // Last resort: try fetching without CORS mode
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        return await blobToBase64(blob);
      } catch (err) {
        throw new Error(`Cannot extract image: ${err.message}`);
      }
    }
  }

  /**
   * Converts a Blob to a base64 data URI string.
   */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Message Listeners ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'FAKECHECK_EXTRACT_IMAGE':
        extractImageAsBase64(message.imageUrl)
          .then((base64) => {
            chrome.runtime.sendMessage({
              type: 'FAKECHECK_IMAGE_EXTRACTED',
              base64,
              imageUrl: message.imageUrl,
            });
          })
          .catch((err) => {
            showToast('FakeCheck: Could not extract image. ' + err.message);
          });
        break;

      case 'FAKECHECK_ANALYZING':
        showLoading(message.imageUrl);
        break;

      case 'FAKECHECK_RESULT':
        showBadge(message.result);
        break;

      case 'FAKECHECK_LIMIT_REACHED':
        showToast(
          'FakeCheck: Daily limit reached (5/5).',
          'https://deep-check-two.vercel.app/pricing',
          'Upgrade to Pro'
        );
        break;
    }

    sendResponse({ ok: true });
    return false;
  });
})();
