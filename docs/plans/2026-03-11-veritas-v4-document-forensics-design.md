# Veritas Engine v4 — Document & Media Forensics
**Date:** 2026-03-11
**Status:** Approved
**Scope:** Complete multi-modal document forensics pipeline

---

## 1. Problem Statement

The current Veritas Engine v3 has a critical false-negative for PNG documents modified with vector/design tools (Canva, Illustrator, etc.):

1. `isScreenshot = wi.isPng` — any PNG activates "screenshot" mode
2. This caps 3/6 signals: `ELA ≤ 20`, `Noise ≤ 25`, `EXIF ≤ 15`
3. The EXIF signal correctly detects `Software: Canva` (score=40+) but it's capped to 15
4. The false-positive gate requires ≥2 signals with LLR > 0.3 — rarely met when 3/6 are suppressed
5. Final score ≤ 29% → "clean" ✗

Additionally, v3 has no coverage for: identity document photo manipulation, semantic validation of financial numbers, or media authenticity (war images, deepfakes).

---

## 2. Solution: Veritas Engine v4

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (client-side)                                       │
│                                                              │
│  imageForensics.ts v4                                        │
│  ├── S1: Multi-Quality ELA        (fixed PNG exemption)      │
│  ├── S2: DCT Statistics           (unchanged)                │
│  ├── S3: Noise Residual / PRNU    (fixed PNG exemption)      │
│  ├── S4: Edge Statistics          (unchanged)                │
│  ├── S5: EXIF Forensics           (fixed: no cap on edit sw) │
│  ├── S6: Chroma Analysis          (unchanged)                │
│  └── S7: Document Pixel Analysis  (NEW)                      │
│       ├── noise floor in background regions                  │
│       ├── sub-pixel edge sharpness score                     │
│       └── bimodal pixel distribution tightness              │
│                                                              │
│  → POST /api/documents/forensics (async, after client pass) │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  SERVER  /api/documents/forensics  (Next.js Route Handler)   │
│                                                              │
│  documentForensics.ts (orchestrator)                         │
│  ├── textractAnalysis.ts                                     │
│  │   ├── AWS Textract: DetectDocumentText + AnalyzeDocument  │
│  │   ├── Semantic validator (financial documents)            │
│  │   │   ├── math check: Σ(línea) == subtotal == total        │
│  │   │   ├── NIF/CIF check digit validation                  │
│  │   │   ├── IBAN format + checksum                          │
│  │   │   └── date consistency                                │
│  │   └── Semantic validator (ID documents)                   │
│  │       └── MRZ checksum validation                         │
│  ├── docForensicsCnn.ts                                      │
│  │   ├── MobileNetV3-Small ONNX (served from S3/Lambda)      │
│  │   ├── classify: invoice|id_card|passport|certificate|     │
│  │   │            payslip|media_photo|screenshot|other       │
│  │   └── manipulation_score: 0–100                           │
│  ├── rekognitionAnalysis.ts                                  │
│  │   ├── DetectFaces (ID document photo quality/liveness)    │
│  │   └── DetectModerationLabels (media content)              │
│  └── frequencyAnalysis.ts                                    │
│      ├── FFT spectral analysis (splicing artifacts)          │
│      └── Wavelet decomposition (double-compression patterns) │
│                                                              │
│  Extended Bayesian Combiner (10 signals)                     │
│  └── Returns: documentType, manipulationProb, riskScore,    │
│               signalBreakdown, semanticAlerts                │
└─────────────────────────────────────────────────────────────┘
         │
┌────────▼───────────────────────────────────────────────────┐
│  DATABASE  dc_document_analyses                             │
│  New columns: document_type, semantic_score, cnn_score,    │
│              rekognition_score, frequency_score,           │
│              semantic_alerts (jsonb)                       │
└────────────────────────────────────────────────────────────┘
         │
┌────────▼───────────────────────────────────────────────────┐
│  TRAINING  (EC2 Spot g4dn.xlarge — extends existing infra) │
│  infra/train_docforensics.py                               │
│  ├── MobileNetV3-Small pretrained on ImageNet              │
│  ├── Fine-tuned on synthetic dataset:                      │
│  │   ├── Real documents (public datasets + generated)      │
│  │   └── Manipulated: Canva, GIMP, Photoshop, Inkscape     │
│  └── Export: ONNX → s3://deep-check-models/docforensics/  │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1: Client-side Fixes (imageForensics.ts)

### 3.1 Fix: PNG Exemption Reform

**Current (broken):**
```ts
const isScreenshot = wi.isPng || exif.isSuspectedScreenshot
if (isScreenshot) {
  elaScore   = Math.min(elaScore, 20)
  noiseScore = Math.min(noiseScore, 25)
  exifScore  = Math.min(exifScore, 15)   // ← kills Canva detection
}
```

**Fixed:**
```ts
// Separate "actual screenshot" from "document PNG"
const isDocumentPng = wi.isPng
  && lumStat.mean > 0.72        // mostly white background
  && lumStat.std  > 0.08        // has text (bimodal, not uniform)

const isActualScreenshot = (exif.isSuspectedScreenshot ?? false)
  && !isDocumentPng

// Only suppress for actual screenshots, not document PNGs
if (isActualScreenshot) {
  elaScore   = Math.min(elaScore, 20)
  noiseScore = Math.min(noiseScore, 25)
}

// NEVER cap EXIF when edit software is explicitly detected
if (!exif.editSoftwareDetected) {
  if (isActualScreenshot) exifScore = Math.min(exifScore, 15)
}
```

### 3.2 Fix: AI Signature Alert for Document PNGs

Remove `!ctx.isScreenshot` gate on the AI signature alert:
```ts
// Before: if (ela.aiSignature && !ctx.isScreenshot)
// After:
if (ela.aiSignature) {
  // For document PNGs, flat ELA = vector/Canva render = suspicious
  severity: isDocumentPng ? 'medium' : 'high'
}
```

### 3.3 New Signal S7: Document Pixel Analysis

For high-luminance PNGs (documents):

**Noise Floor Score:**
- Sample all background pixels (lum > 0.85)
- Compute σ of pixel values in 16×16 background patches
- Authentic scan: σ ≈ 2–8 per 8-bit pixel
- Canva export: σ ≈ 0–0.5
- Score: `clamp((0.8 - normalizedSigma) * 100, 0, 100)`

**Edge Sharpness Score:**
- Find strong edges (Sobel > threshold)
- Measure pixel transition width (1px = vector; 3-5px = natural)
- Sub-pixel-sharp edges → suspicious for scanned documents

**Bimodal Tightness Score:**
- Compute pixel histogram, find two main peaks (text + background)
- Measure peak width (FWHM)
- Canva: very tight peaks (std ≈ 0–2)
- Scan: broader peaks (std ≈ 8–20)

**Combined:** weighted average → score 0–100

---

## 4. Layer 2: Server-side API

### 4.1 Endpoint: POST /api/documents/forensics

```
Input:
  imageDataUrl: string        (base64 PNG/JPEG)
  fileName: string
  fileType: string
  documentId?: string         (to update existing analysis)

Output:
  documentType: DocumentClass
  semanticScore: number       (0–100)
  cnnScore: number            (0–100)
  rekognitionScore: number    (0–100)
  frequencyScore: number      (0–100)
  semanticAlerts: SemanticAlert[]
  analysisMs: number
```

### 4.2 AWS Textract Semantic Validation

```
Client: AWS Textract (eu-west-1)
API calls:
  - AnalyzeDocument(FeatureTypes: ["TABLES", "FORMS"])
  - DetectDocumentText

Financial document validation:
  1. Extract all monetary values from table cells
  2. Re-compute: unit_price × quantity = line_total (±0.02€ rounding tolerance)
  3. Re-compute: Σ line_totals = base_imponible
  4. Re-compute: base_imponible × (1 + IVA%) = total_a_pagar
  5. Validate NIF/CIF: format regex + check digit (mod23 algorithm)
  6. Validate IBAN: mod97 checksum
  7. Validate dates: chronological consistency
  Score: 100 - (penalties per failed check)

ID document validation:
  1. Extract MRZ lines (if present)
  2. Validate MRZ check digits (per ICAO Doc 9303)
  3. Cross-validate name + DOB + expiry across fields
  Score: 100 - (penalties per failed check)
```

### 4.3 DocForensics CNN

```
Architecture: MobileNetV3-Small (pretrained ImageNet, fine-tuned)
Input: 224×224×3 (normalized)
Output:
  - document_type: softmax over 8 classes
  - manipulation_score: sigmoid → 0–1

Training dataset (generated in train_docforensics.py):
  - ~200k synthetic documents per class
  - Authentic: clean renders with natural noise added
  - Manipulated: Canva edits, pixel-level number changes,
                 copy-paste regions, color adjustments

Deployment:
  - Export: ONNX (float32)
  - Storage: s3://deep-check-models/docforensics/model.onnx
  - Runtime: onnxruntime in Lambda container (same pattern as BiLSTM)
  - Cold start: < 800ms (MobileNetV3-Small is ~10MB)
```

### 4.4 AWS Rekognition

```
For ID documents (passport, DNI, id_card):
  - DetectFaces: confidence, pose, quality, landmarks
    - Low confidence → suspicious (printed/screenshotted photo)
    - Extreme pose → flag
    - Low sharpness → printed-photo-of-photo
  - If enrollment profile exists: CompareFaces → identity match score

For media images:
  - DetectModerationLabels: flag violent/disturbing content for context
  - Score contribution: face quality anomalies → manipulation signal
```

### 4.5 Frequency Domain Analysis

```
FFT Analysis (server-side, NumPy via child_process or WASM):
  - 2D FFT of luminance channel
  - Detect periodic spectral peaks (moiré → scanner/print artifact)
  - Detect discontinuities in frequency domain (splicing boundary)
  - Double-JPEG ghost: spectral signature distinct from single-compression

Wavelet Analysis:
  - Haar DWT 3-level decomposition
  - HL/LH/HH subband statistics per level
  - Inconsistency between subbands → splice regions
  Score: 0–100 based on spectral anomalies
```

---

## 5. Layer 3: Extended Bayesian Combiner (10 signals)

```typescript
const SIGNAL_MODELS_V4 = {
  // Existing (recalibrated for document context)
  ela:         { μa: 18, σa: 12, μm: 55, σm: 22 },
  dct:         { μa: 12, σa: 10, μm: 45, σm: 22 },
  noise:       { μa: 18, σa: 13, μm: 55, σm: 22 },
  edge:        { μa: 22, σa: 14, μm: 52, σm: 22 },
  exif:        { μa: 10, σa:  8, μm: 42, σm: 25 },
  chroma:      { μa: 14, σa: 12, μm: 52, σm: 22 },
  // New client-side
  docPixel:    { μa:  8, σa:  7, μm: 60, σm: 25 },
  // New server-side
  semantic:    { μa:  5, σa:  5, μm: 70, σm: 20 },  // high confidence
  cnn:         { μa: 15, σa: 12, μm: 65, σm: 20 },  // high confidence
  frequency:   { μa: 12, σa: 10, μm: 48, σm: 22 },
}

// False-positive gate: lowered to 2/10 (was 2/6)
// Semantic or CNN alone can trigger if score > 75
```

---

## 6. Database Migration

```sql
ALTER TABLE dc_document_analyses
  ADD COLUMN IF NOT EXISTS document_type        TEXT,
  ADD COLUMN IF NOT EXISTS semantic_score       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cnn_score            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rekognition_score    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frequency_score      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semantic_alerts      JSONB;
```

---

## 7. UI Updates

### documents/[id]/page.tsx
- Extended `DocumentAnalysis` interface with 5 new fields
- New `SemanticBanner` component (shows what Textract found: math errors, format issues)
- New `DocumentTypeBadge` (invoice / id_card / passport / certificate / payslip / media)
- 10-signal grid (extends existing 6-signal grid)
- New XAI blocks for: semantic validation, CNN classification, Rekognition

### documents/page.tsx
- Extended progress bar to 12 steps (adds: CNN, Textract, Rekognition, Frequency)
- POST to `/api/documents/forensics` after client-side analysis completes
- Merge server-side scores into final display

---

## 8. Training Infrastructure

### infra/train_docforensics.py
```
Architecture: MobileNetV3-Small (torchvision.models)
Dataset generation:
  - Real docs: public invoice/ID datasets + programmatically generated
  - Manipulated: PIL-based modifications (text replacement, copy-paste, color shift)
  - Augmentation: brightness jitter, JPEG re-compression, rotation ±5°
Training: 50 epochs, AdamW, cosine annealing, label smoothing 0.1
Export: torch.onnx.export → model.onnx + class_labels.json
Upload: s3://deep-check-models/docforensics/

Estimated training cost: ~1.5h × $0.16/hr = ~$0.24 (same as BiLSTM)
```

---

## 9. Files Created / Modified

### New files
| File | Purpose |
|------|---------|
| `src/lib/documentForensics.ts` | Server-side orchestrator |
| `src/lib/textractAnalysis.ts` | Textract + semantic validation |
| `src/lib/docForensicsCnn.ts` | ONNX CNN inference |
| `src/lib/rekognitionAnalysis.ts` | Rekognition integration |
| `src/lib/frequencyAnalysis.ts` | FFT + wavelet analysis |
| `src/app/api/documents/forensics/route.ts` | New API endpoint |
| `infra/train_docforensics.py` | CNN training script |
| `infra/ec2_spot_train_docforensics.sh` | Training launcher |

### Modified files
| File | Change |
|------|--------|
| `src/lib/imageForensics.ts` | Fix PNG exemption + add S7 DocPixel signal |
| `src/app/documents/[id]/page.tsx` | 10-signal UI + semantic banner |
| `src/app/documents/page.tsx` | Extended progress + server-side call |
| `src/app/api/documents/route.ts` | Persist 5 new fields |
| `src/app/whitepaper/page.tsx` | Document v4 methodology section |

### Database
| Migration | Change |
|-----------|--------|
| `add_v4_document_columns` | 5 new columns on dc_document_analyses |

---

## 10. Expected Detection Rates

| Document Type | v3 (current) | v4 (target) |
|---------------|-------------|-------------|
| Canva-modified invoice (PNG) | 29% ❌ | 85–95% ✅ |
| Photoshop-modified JPEG | 65% ⚠️ | 80–90% ✅ |
| DNI with photo replaced | 20% ❌ | 75–90% ✅ |
| Invoice with wrong totals | 0% ❌ | 95%+ ✅ |
| War image deepfake | 30% ❌ | 70–85% ✅ |
| Authentic document | 95% clean ✅ | 92% clean ✅ |

---

## 11. AWS Cost Estimate per Analysis

| Service | Cost |
|---------|------|
| Textract (1 page) | ~$0.015 |
| Rekognition (DetectFaces) | ~$0.001 |
| Lambda (1s @ 512MB) | ~$0.000008 |
| S3 GET (model) | ~$0.000004 |
| **Total per document** | **~$0.017** |
