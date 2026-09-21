# FakeCheck -- AI Image Detector

A Chrome Extension by [Deep-Check](https://deep-check-two.vercel.app) that lets you right-click any image on the web to check if it was AI-generated.

## Features

- **Context Menu Integration** -- Right-click any image and select "Check with FakeCheck"
- **Popup Interface** -- Drop, paste, or provide a URL to any image for analysis
- **Multi-layer Analysis** -- Channel correlation, edge density, kurtosis, noise consistency, and saturation variance
- **Visual Badges** -- Floating badges appear on analyzed images showing the verdict
- **Freemium Model** -- 5 free checks per day, unlimited with Pro ($3.99/mo)
- **Share Results** -- One-click sharing to Twitter/X
- **Graceful Degradation** -- Works offline with local heuristic analysis; cloud API enhances accuracy when available

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select this `extensions/fakecheck/` directory
5. The FakeCheck icon appears in your toolbar

## How It Works

### Analysis Pipeline

1. **Cloud API** (when available) -- Sends the image to Deep-Check's server for neural network inference using the EfficientNet-B4 deepfake detector
2. **Local Heuristics** (fallback) -- Runs entirely in-browser using canvas pixel analysis:
   - **Channel Correlation** -- AI images have unnaturally high R/G/B channel correlation (>0.95)
   - **Edge Density** -- Sobel-based edge detection; AI images tend to be smoother
   - **Kurtosis** -- Color distribution shape; AI images are often platykurtic (flatter)
   - **Noise Consistency** -- Quadrant noise comparison; AI images have uniform noise
   - **Saturation Variance** -- AI images have more uniform saturation distribution

### Scoring

| Score     | Verdict              | Badge  |
|-----------|----------------------|--------|
| 70-100%   | Likely Real          | Green  |
| 40-69%    | Possibly AI          | Yellow |
| 0-39%     | Likely AI-Generated  | Red    |

## File Structure

```
extensions/fakecheck/
  manifest.json      -- Manifest V3 configuration
  background.js      -- Service worker: context menu, usage tracking, analysis orchestration
  content.js         -- Content script: image extraction, badge overlay, toast notifications
  popup.html         -- Popup UI markup
  popup.css          -- Popup styles (Deep-Check dark theme)
  popup.js           -- Popup controller: file handling, gauge animation, result display
  analyzer.js        -- Image analysis: preprocessing, ONNX stub, heuristic ensemble
  icons/
    icon16.png       -- 16x16 toolbar icon
    icon48.png       -- 48x48 extension page icon
    icon128.png      -- 128x128 Chrome Web Store icon
    icon16.svg       -- SVG source for 16px icon
    icon48.svg       -- SVG source for 48px icon
    icon128.svg      -- SVG source for 128px icon
  README.md          -- This file
```

## Permissions

| Permission     | Reason                                           |
|----------------|--------------------------------------------------|
| `contextMenus` | Add "Check with FakeCheck" to right-click menu    |
| `activeTab`    | Access the current tab to extract clicked images  |
| `storage`      | Store daily usage counter and settings            |
| `<all_urls>`   | Extract images from any website for analysis      |

## Privacy

- **No tracking** -- No analytics, no telemetry
- **Local-first** -- Heuristic analysis runs entirely in the browser
- **Images not stored** -- When using the cloud API, images are processed and discarded
- **Usage data** -- Only the daily check counter is stored locally via `chrome.storage.local`

## Development

This extension uses vanilla JavaScript with no build step required. Edit files directly and reload the extension in `chrome://extensions/`.

### Testing

1. Load the extension in developer mode
2. Navigate to any page with images
3. Right-click an image and select "Check with FakeCheck"
4. Or click the toolbar icon and drop/paste an image

## License

BSL 1.1 -- See the project root LICENSE for details.
Copyright (c) 2024-2026 HIUM Solutions SL.
