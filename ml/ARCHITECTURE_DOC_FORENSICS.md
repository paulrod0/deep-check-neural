# Deep-Check: Document Forensics Architecture Document

**Version:** 1.0
**Date:** 2026-03-30
**Author:** Deep-Check ML Team
**Status:** Design Phase (no code yet)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Model 1: Document Forensics (Manipulation Detection)](#2-model-1-document-forensics)
3. [Model 2: ID Document Verification](#3-model-2-id-document-verification)
4. [Model 3: OCR + Template Validation](#4-model-3-ocr--template-validation)
5. [Shared Infrastructure](#5-shared-infrastructure)
6. [Timeline and Prioritization](#6-timeline-and-prioritization)
7. [References](#7-references)

---

## 1. Executive Summary

This document specifies the architecture for three new AI models that extend Deep-Check
beyond deepfake face detection into document intelligence. All three models follow the
project's privacy-first philosophy: classification runs client-side in the browser via
ONNX Runtime Web (WASM/WebGPU), while heavier server-side pipelines (OCR, template
matching) run on Vercel Edge Functions or the existing Supabase backend.

### Design Principles

- **Privacy first:** Sensitive document images never leave the client for classification.
  OCR extraction may use a server endpoint, but the raw image is discarded immediately.
- **Existing pipeline compatibility:** Models follow the same ONNX contract used by the
  deepfake detector (EfficientNet-B4, 224x224 input, ImageNet normalization, logit output).
  Segmentation models extend this with a decoder head.
- **Progressive enhancement:** Each model ships in two modes: (1) a heuristic fallback
  using ELA/noise analysis (already partially implemented in `neuralForensics.ts`), and
  (2) a trained ONNX model that activates when placed in `/public/models/`.
- **Modular integration:** Each model plugs into the existing Veritas Ensemble as a new
  layer or operates standalone for its dedicated product page (DocSafe, etc.).

---

## 2. Model 1: Document Forensics (Manipulation Detection)

### 2.1 Problem Statement

Detect manipulation in images of documents: payslips, invoices, certificates, diplomas,
contracts. Manipulations include text overlay/replacement, stamp additions, region
copy-move, splicing from other documents, color-shift edits, and AI-generated content
insertion.

### 2.2 Architecture Options (Evaluated)

#### Option A: EfficientNet-B4 Encoder + U-Net Decoder + ELA/SRM Branch (RECOMMENDED)

```
                                    Input Image (224x224x3)
                                           |
                         +-----------------+------------------+
                         |                                    |
                    RGB Branch                          Forensic Branch
                         |                                    |
              EfficientNet-B4 Encoder               +--------+--------+
              (timm, ImageNet pretrained)            |        |        |
                         |                         ELA     SRM(3)   Noise
                  Feature Pyramid                  (multi-  filters  residual
                  [f1, f2, f3, f4, f5]              scale)          (Laplacian)
                         |                           |        |        |
                         |                         Conv1x1  Conv3x3  Conv3x3
                         |                           |        |        |
                         |                         Concat + Conv1x1 -> F_forensic
                         |                                    |
                         +------------ Concatenate -----------+
                                           |
                              U-Net Decoder (4 stages)
                              Skip connections from encoder
                                           |
                         +-----------------+------------------+
                         |                                    |
                  Classification Head                 Segmentation Head
                  GAP -> FC(512) -> FC(1)            Conv1x1 -> Upsample
                  -> logit (P(manipulated))          -> 224x224x1 heatmap
```

**Why this option:**
- Reuses the proven EfficientNet-B4 backbone from the deepfake V3 model (same training
  infrastructure, same ONNX export pipeline in `ml/export_model.py`).
- The ELA+SRM forensic branch adds domain-specific signal that pure RGB models miss.
  Research shows ELA-CNN integration achieves 94% accuracy on CASIA v2.0 benchmarks.
- The U-Net decoder enables pixel-level localization (heatmap output) without adding
  excessive parameters. EfficientNet-B4 encoder has 18.6M params; the decoder adds ~3M.
- The dual-head design (classification + segmentation) serves two use cases: binary
  verdict for the Veritas Ensemble, and a visual heatmap for the DocSafe UI.

#### Option B: DINOv2 ViT-S + Linear Probe (Alternative)

```
  Input (224x224) -> DINOv2 ViT-S/14 (frozen) -> patch tokens -> Linear head -> logit
                                                              -> Reshape -> heatmap
```

- DINOv2 ViT-S has 22M params, ~86MB ONNX. Strong zero-shot features.
- DinoLizer (2024) showed DINOv2 localizes generative inpainting with sliding windows.
- Disadvantage: ViT models are slower in WASM (attention is O(n^2) on sequence length).
  On mobile browsers, inference could exceed 5 seconds vs ~1.5s for EfficientNet-B4.
- Disadvantage: No frequency-domain branch. DINOv2 features are semantic, not forensic.

#### Option C: Swin Transformer + UperNet (Heavy, server-only)

```
  Input (384x384) -> Swin-T Encoder -> FPN -> UperNet Decoder -> 384x384 mask
```

- DFST-UNet (2025) showed Swin Transformer captures long-range context for forgery
  localization at multiple scales.
- Swin-T: 28M params. With UperNet: ~60M total. ~240MB ONNX.
- Too large for browser deployment. Would require server-side inference only.
- Best accuracy but impractical for Deep-Check's client-side architecture.

**Decision: Option A.** Best balance of accuracy, model size, and browser compatibility.
Option B kept as future experiment. Option C rejected for browser use.

### 2.3 Architecture Diagram (Option A, Detailed)

```
INPUT PIPELINE:
  User uploads document image (JPEG/PNG/PDF page)
       |
  [Browser] Resize to 224x224, preserve aspect ratio (letterbox pad)
       |
  +----+----+
  |         |
  RGB       ELA Computation (client-side)
  Tensor    - Recompress at Q=65, Q=75, Q=85, Q=92
  [3,224,   - Subtract from original
   224]     - Amplify x20
            - Produces ELA map [3,224,224]
            |
            SRM Filters (3 kernels, applied per channel)
            - KV filter:  [[-1,2,-1],[2,-6,2],[-1,2,-1]]/4
            - Edge filter: [[0,0,0],[0,-1,1],[0,0,0]]
            - 2nd order:   [[0,1,0],[1,-4,1],[0,1,0]]
            - Produces SRM maps [9,224,224]
            |
            Noise Residual (Laplacian variance per 16x16 block)
            - Produces noise map [1,224,224]
            |
  Combined forensic input: [13,224,224]
       |
  Conv1x1 (13 -> 3 channels, learnable projection)
       |
  Forensic features [3,224,224]

MODEL (single ONNX file):
  Input: "rgb_image" [1,3,224,224] + "forensic_map" [1,3,224,224]
         (or concatenated as [1,6,224,224] for simpler ONNX graph)

  Encoder: EfficientNet-B4 (modified stem: 6-channel input instead of 3)
    - Stage 0: Conv 6->48, stride 2     -> f0 [48, 112, 112]
    - Stage 1: MBConv 48->24, x2        -> f1 [24, 112, 112]
    - Stage 2: MBConv 24->32, x4        -> f2 [32, 56, 56]
    - Stage 3: MBConv 32->56, x4        -> f3 [56, 28, 28]
    - Stage 4: MBConv 56->160, x6       -> f4 [160, 14, 14]
    - Stage 5: MBConv 160->448, x2      -> f5 [448, 7, 7]

  Classification Head (from f5):
    GAP -> Dropout(0.3) -> FC(448, 512) -> ReLU -> Dropout(0.2) -> FC(512, 1)
    Output: "manipulation_logit" [1] (sigmoid -> P(manipulated))

  Segmentation Decoder (U-Net style):
    Up4: ConvT(448, 160) + concat(f4) -> Conv(320, 160) -> f4' [160, 14, 14]
    Up3: ConvT(160, 56)  + concat(f3) -> Conv(112, 56)  -> f3' [56, 28, 28]
    Up2: ConvT(56, 32)   + concat(f2) -> Conv(64, 32)   -> f2' [32, 56, 56]
    Up1: ConvT(32, 24)   + concat(f1) -> Conv(48, 24)   -> f1' [24, 112, 112]
    Final: ConvT(24, 16) -> Conv(16, 1) -> Upsample(2x) -> [1, 224, 224]
    Output: "heatmap" [1, 1, 224, 224] (sigmoid -> per-pixel manipulation probability)

ONNX CONTRACT:
  Input:  "document_image" [batch, 6, 224, 224] float32 (ImageNet norm for RGB, raw for forensic)
  Output: "manipulation_logit" [batch] float32 (sigmoid -> P(manipulated))
          "heatmap" [batch, 1, 224, 224] float32 (sigmoid -> per-pixel P(manipulated))
  Opset:  17
```

### 2.4 Datasets

| Dataset | Size | Type | Source | Notes |
|---------|------|------|--------|-------|
| **DocTamper** | 170K images | Document text tampering | [Kaggle](https://www.kaggle.com/datasets/dinmkeljiame/doctamper) / [GitHub](https://github.com/qcf-568/DocTamper) | CVPR 2023. Bilingual (EN/CN). Contracts, invoices, receipts. Pixel-level masks. Requires education email for password. |
| **CASIA v2.0** | 12,616 images (7,492 authentic + 5,124 tampered) | Copy-move + splicing | [Kaggle](https://www.kaggle.com/datasets/divg07/casia-20-image-tampering-detection-dataset) | Standard benchmark. Use [corrected ground truth](https://github.com/SunnyHaze/CASIA2.0-Corrected-Groundtruth). |
| **IMD2020 Extended** | 72K images (35K real + 35K synthetic + 2K real-life manipulated) | Multi-type manipulation | [WACV paper](https://openaccess.thecvf.com/content_WACVW_2020/papers/w4/Novozamsky_IMD2020_A_Large-Scale_Annotated_Dataset_Tailored_for_Detecting_Manipulated_Images_WACVW_2020_paper.pdf) | GAN, inpainting, copy-move, splicing. Binary masks. 2,322 camera models. |
| **Columbia** | 1,845 images | Splicing only | [Columbia DVMM](https://www.ee.columbia.edu/ln/dvmm/downloads/AuthSplicedDataSet/AuthSplicedDataSet.htm) | Grayscale + color. Uncompressed. Good for splicing-specific evaluation. |
| **COVERAGE** | 200 images (100 pairs) | Copy-move only | Academic request | Small but high quality. Good for copy-move-specific eval. |
| **Synthetic (self-generated)** | 100K+ images | All manipulation types | `ml/train_document_forensics.py` (already written) | Uses `DocumentManipulator` class: text overlay, stamps, copy-move, splicing, color-shift, erase. Generates from Kaggle document sources. |
| **Real-world documents** | ~10K images | Source images for manipulation | [Kaggle: shaz13/real-world-documents-collections](https://www.kaggle.com/datasets/shaz13/real-world-documents-collections), [mrcella22/document-image-dataset](https://www.kaggle.com/datasets/mrcella22/document-image-dataset) | Already configured in `train_document_forensics.py`. |

**Total training data target:** ~250K images (after augmentation: ~1M+ samples via online augmentation).

### 2.5 Training Approach

**Transfer learning base:** EfficientNet-B4 pretrained on ImageNet (timm library).
Stem convolution modified from 3-channel to 6-channel input by duplicating and halving
the pretrained weights (standard technique for multi-modal input).

**Loss function:** Multi-task loss combining:
- `L_cls = BCE(manipulation_logit, label)` -- binary classification (weight: 1.0)
- `L_seg = BCE(heatmap, ground_truth_mask) + DiceLoss(heatmap, mask)` -- segmentation (weight: 0.5)
- `L_total = L_cls + 0.5 * L_seg`

For images without pixel-level masks (e.g., CASIA v2.0 without corrected GT), the
segmentation loss is masked out (zero weight). Classification loss always applies.

**Augmentation pipeline (Albumentations):**
```
- HorizontalFlip(p=0.5)
- RandomRotate90(p=0.3)
- ShiftScaleRotate(shift=0.1, scale=0.15, rotate=15, p=0.5)
- OneOf([
    GaussNoise(var_limit=(10, 50)),
    GaussianBlur(blur_limit=(3, 7)),
    MotionBlur(blur_limit=(3, 7)),
  ], p=0.4)
- OneOf([
    OpticalDistortion(distort_limit=0.05),
    GridDistortion(num_steps=5, distort_limit=0.3),
  ], p=0.2)
- RandomBrightnessContrast(brightness=0.2, contrast=0.2, p=0.5)
- ImageCompression(quality_lower=30, quality_upper=100, p=0.5)  # JPEG artifacts
- CoarseDropout(max_holes=8, max_height=20, max_width=20, p=0.3)
- Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])
- ToTensorV2()
```

**Optimizer:** AdamW (lr=3e-4, weight_decay=1e-4, betas=(0.9, 0.999))

**Scheduler:** CosineAnnealingWarmRestarts (T_0=10, T_mult=2) with 5-epoch linear warmup.

**Training protocol:**
1. Phase 1 (epochs 1-5): Freeze encoder, train decoder + heads only. LR=1e-3.
2. Phase 2 (epochs 6-100): Unfreeze all, LR=3e-4 with cosine schedule.
3. Early stopping: patience=20 on validation AUC.
4. Mixed precision (fp16) via PyTorch AMP.
5. Gradient clipping at max_norm=1.0.

### 2.6 Inference Pipeline

```
CLIENT-SIDE (Browser):

  1. User uploads document image
       |
  2. JavaScript: resize to 224x224 (letterbox, preserve aspect ratio)
       |
  3. Compute ELA maps at Q=65,75,85,92 (canvas JPEG round-trip, same as docsafe/page.tsx)
       |
  4. Apply SRM filters (3x3 convolutions in JavaScript, 3 kernels x 3 channels = 9 maps)
       |
  5. Compute noise residual (Laplacian per 16x16 block, resize to 224x224)
       |
  6. Stack: [RGB(3ch) + ELA(3ch averaged) + SRM(3ch projected) = 6ch or 9ch]
     Reduce forensic channels to 3 via learned Conv1x1 (baked into ONNX model)
       |
  7. ONNX Runtime Web inference (WASM or WebGPU)
     Input: [1, 6, 224, 224] float32
       |
  8. Outputs:
     - manipulation_logit -> sigmoid -> P(manipulated) [0-1]
     - heatmap [224x224] -> sigmoid -> overlay on original image
       |
  9. Classification:
     - P < 0.20 -> "Authentic" (green)
     - 0.20 <= P < 0.60 -> "Suspicious" (yellow)
     - P >= 0.60 -> "Manipulated" (red)
       |
  10. Display: Original image with heatmap overlay (hot regions = manipulated areas)
      + confidence score + alert list
```

### 2.7 Model Size and Deployment

| Component | Parameters | ONNX Size (fp32) | ONNX Size (fp16) | Deployment |
|-----------|-----------|-------------------|-------------------|------------|
| EfficientNet-B4 encoder | 18.6M | ~70MB | ~35MB | Browser (WASM) |
| U-Net decoder | ~3M | ~12MB | ~6MB | Browser (WASM) |
| Forensic projection | ~0.1M | <1MB | <1MB | Browser (WASM) |
| **Total** | **~21.7M** | **~83MB** | **~42MB** | **Browser** |

The fp16 model at ~42MB is within the practical browser download budget (similar to the
existing deepfake_pixel_v1.onnx at 70MB). For mobile, INT8 quantization could reduce
to ~21MB at the cost of ~1-2% accuracy.

**Fallback mode:** If no ONNX model is present, the existing `neuralForensics.ts`
enhanced heuristic mode (multi-scale ELA + DCT + regional noise consistency) activates.
This is already implemented and deployed.

### 2.8 Estimated Training Time (A10G)

| Phase | Data | Epochs | Time/Epoch | Total |
|-------|------|--------|------------|-------|
| Phase 1 (frozen encoder) | 250K | 5 | ~3 min | ~15 min |
| Phase 2 (full fine-tune) | 250K | 95 | ~8 min | ~12.5 hrs |
| Evaluation | 25K | 1 | ~2 min | ~2 min |
| ONNX export + validation | - | - | - | ~10 min |
| **Total** | | | | **~13 hours** |

With 2x A10G and DataParallel: ~7 hours.

### 2.9 This Week vs Later

**This week (days 1-7):**
- [x] Synthetic data generation pipeline (already implemented in `train_document_forensics.py`)
- [ ] Download and prepare DocTamper + CASIA v2.0 datasets
- [ ] Implement 6-channel stem modification for EfficientNet-B4
- [ ] Implement U-Net decoder with dual heads
- [ ] Train Phase 1 (frozen encoder, 5 epochs) -- verify pipeline works
- [ ] Begin Phase 2 training on A10G

**Later (weeks 2-4):**
- [ ] Integrate heatmap visualization into DocSafe page
- [ ] Add IMD2020 Extended dataset for robustness
- [ ] Benchmark against CASIA v2.0 test set (target: AUC > 0.98)
- [ ] INT8 quantization for mobile browsers
- [ ] Integrate as new layer in Veritas Ensemble (`doc_forensics` layer)

---

## 3. Model 2: ID Document Verification

### 3.1 Problem Statement

Verify authenticity of identity documents (ID cards, passports, driving licenses) from
195+ countries. Detect photo substitution, text alteration, missing security features,
font inconsistencies, and MRZ validation failures.

### 3.2 Architecture: Multi-Stage Pipeline

This model is fundamentally different from Models 1 and 3: ID verification requires
a pipeline of specialized stages rather than a single neural network. The pipeline
combines client-side classification with server-side OCR and template matching.

```
MULTI-STAGE ID VERIFICATION PIPELINE:

  Stage 1: Document Detection + Classification (CLIENT-SIDE, ONNX)
  ================================================================
  Input: Camera frame or uploaded image
       |
  YOLOv8-nano or EfficientNet-B0 classifier
  - Detects document region (bounding box)
  - Classifies document type (passport, ID card, driver's license, visa)
  - Classifies country/issuer (top-20 most common, then "other")
       |
  Output: Cropped + perspective-corrected document image, document_type, country

  Stage 2: Quality Assessment (CLIENT-SIDE, heuristic)
  ====================================================
  Input: Cropped document image
       |
  - Blur detection (Laplacian variance < threshold)
  - Glare detection (white saturation > 15% of area)
  - Occlusion detection (edge completeness check)
  - Resolution check (minimum 640x400 effective pixels)
       |
  Output: quality_score, quality_issues[]

  Stage 3: Face Zone Extraction (CLIENT-SIDE, MediaPipe)
  ======================================================
  Input: Cropped document image
       |
  MediaPipe FaceLandmarker (already used by Deep-Check)
  - Detect face in document photo zone
  - Extract face crop for liveness/deepfake check (existing pipeline)
  - Check face-to-document size ratio (expected: 20-35% of doc height)
       |
  Output: face_crop, face_bbox, face_quality_score

  Stage 4: MRZ Extraction + Validation (CLIENT-SIDE or SERVER)
  =============================================================
  Input: Cropped document image (bottom region for passports, full for ID cards)
       |
  Option A (client-side): Lightweight MRZ OCR model (~5MB ONNX)
    - CRNN (CNN encoder + BiLSTM + CTC decoder) trained on MRZ fonts
    - Input: cropped MRZ zone [1, 1, 32, 320] grayscale
    - Output: character sequence (TD1: 3 lines x 30 chars, TD3: 2 lines x 44 chars)
  Option B (server-side): Tesseract with MRZ-specific config
       |
  MRZ Validation (pure JavaScript, no model needed):
    - Parse fields per ICAO 9303 spec (doc type, country, name, doc#, DOB, expiry, sex)
    - Validate check digits (positions 10, 20, 28, 43, 44 for TD3)
    - Cross-validate: name consistency, date ranges, country code validity
       |
  Output: mrz_data{}, mrz_valid: boolean, mrz_errors[]

  Stage 5: Security Feature Analysis (CLIENT-SIDE, ONNX)
  ======================================================
  Input: Cropped document image (full resolution)
       |
  Security Feature Detector (EfficientNet-B0 + multi-label head)
    - Trained to detect presence/absence of expected security features
    - Features: hologram pattern, microprint texture, UV-reactive zones,
      guilloche pattern, rainbow printing, laser perforation marks
    - Input: "doc_image" [1, 3, 224, 224] float32
    - Output: "feature_scores" [1, 8] float32 (sigmoid per feature)
       |
  Template Matcher:
    - Compare detected features against expected features for document_type + country
    - Flag missing or unexpected features
       |
  Output: security_score, missing_features[], anomalies[]

  Stage 6: Font Consistency Check (SERVER-SIDE, OCR + heuristic)
  ==============================================================
  Input: Cropped document image
       |
  PaddleOCR / Tesseract: Extract text + bounding boxes + font metrics
    - Character height uniformity within same field
    - Baseline alignment check
    - Inter-character spacing consistency
    - Font family detection (compare against expected fonts per template)
       |
  Output: font_consistency_score, font_anomalies[]

  Stage 7: Aggregation + Verdict
  ==============================
  Weighted score fusion:
    - Document classification confidence:  0.10
    - Quality assessment:                  0.05
    - Face zone analysis:                  0.10
    - MRZ validation:                      0.25
    - Security feature score:              0.30
    - Font consistency:                    0.20
       |
  Output: {
    document_type, country, authenticity_score (0-100),
    verdict: "authentic" | "suspicious" | "fraudulent",
    extracted_fields: { name, doc_number, dob, expiry, nationality, ... },
    anomalies: [ { type, severity, description, location } ],
    mrz_data: { raw_lines, parsed_fields, check_digits, valid },
    security_features: { expected[], detected[], missing[] }
  }
```

### 3.3 Sub-Model Architectures

#### 3.3.1 Document Type Classifier (Stage 1)

```
  Input: [1, 3, 224, 224] (RGB, ImageNet normalized)
       |
  EfficientNet-B0 (5.3M params, pretrained ImageNet)
       |
  GAP -> FC(1280, 256) -> ReLU -> Dropout(0.3) -> FC(256, N_classes)
       |
  Output: [1, N_classes] logits -> softmax -> document_type probabilities

  N_classes = ~30 (top 20 countries x doc_type + "other_passport" + "other_id" + "other_dl")
```

**ONNX size:** ~20MB (fp32), ~10MB (fp16). Small enough for browser.

#### 3.3.2 MRZ OCR Model (Stage 4, Option A)

```
  Input: [1, 1, 32, 320] grayscale (MRZ zone crop, thresholded)
       |
  CNN Encoder: 5x Conv2d (32->64->128->128->256, stride/pool)
       |
  Reshape -> BiLSTM (256 hidden, 2 layers)
       |
  CTC Decoder: FC(512, 37) (A-Z, 0-9, <filler>)
       |
  Output: character sequence, per-char confidence
```

**ONNX size:** ~5MB. Very lightweight, ideal for browser.

#### 3.3.3 Security Feature Detector (Stage 5)

```
  Input: [1, 3, 224, 224] (RGB, ImageNet normalized)
       |
  EfficientNet-B0 (shared backbone with doc classifier, or separate)
       |
  GAP -> FC(1280, 256) -> ReLU -> FC(256, 8) -> sigmoid
       |
  Output: [1, 8] per-feature probability
  Features: [hologram, microprint, guilloche, rainbow_print, UV_marks,
             laser_perf, embossing, watermark]
```

**ONNX size:** ~20MB (could share backbone with doc classifier = ~22MB combined).

### 3.4 Datasets

| Dataset | Size | Coverage | Source | Notes |
|---------|------|----------|--------|-------|
| **MIDV-2020** | 1,000 docs (1K video + 2K scans + 1K photos) | 10 countries, 50 doc types | [arXiv](https://arxiv.org/abs/2107.00396) | Unique faces + text per doc. Rich annotation (field positions, geometry). Primary benchmark. |
| **MIDV-500** | 500 video clips | 50 doc types | [Smart Engines](https://smartengines.com/wp-content/uploads/2020/04/datasets-of-id-documents-midv-500.pdf) | Predecessor to MIDV-2020. Mobile video stream. |
| **MIDV-Holo** | 300 genuine + 400 attack videos | Holographic security | [ResearchGate](https://www.researchgate.net/publication/373232277_MIDV-Holo_A_Dataset_for_ID_Document_Hologram_Detection_in_a_Video_Stream) | Synthetic passports with custom holograms. Attack types: photocopy, screen replay. |
| **MIDV-UP** | Pakistani + Iranian IDs | 2 countries | [Springer](https://link.springer.com/chapter/10.1007/978-3-032-04627-7_35) | Extends MIDV to underrepresented regions. |
| **IDNet** | 837,060 images | 10 US states + 10 EU countries, 20 doc types | [Kaggle](https://www.kaggle.com/datasets/chitreshkr/idnet-identity-document-analysis) / [Zenodo](https://zenodo.org/records/13855175) | Fully synthetic. Each doc has 4 fraud variants: face morphing, portrait substitution, text alteration, combined. ~490GB total. |
| **FantasyID** | TBD | Diverse design styles | [arXiv](https://arxiv.org/pdf/2507.20808) | Novel 2025 dataset. Mimics real IDs without using real documents. Diverse languages and faces. |
| **FMIDV** | 7x forgery per MIDV-2020 sample | Guilloche fraud | Academic (request) | Copy-move on guilloche patterns only. Limited scope. |
| **BID** | Challenge dataset | Various | Academic | Used in ICCV 2025 DeepID challenge. |
| **Synthetic (self-generated)** | Scalable | Template-based | Internal | Generate synthetic ID documents using Pillow/OpenCV with known templates. Apply augmentation: lighting, perspective, blur, crop. |

**Total training data target:**
- Document classifier: ~100K images (IDNet provides 837K, subsample + augment).
- MRZ OCR: ~50K MRZ crops (generated from MIDV-2020 + synthetic MRZ strings).
- Security feature detector: ~50K images (MIDV-Holo + IDNet + synthetic holograms).

### 3.5 Training Approach

**Document classifier:**
- Base: EfficientNet-B0 pretrained on ImageNet.
- Loss: CrossEntropyLoss with label smoothing (0.1).
- Train on IDNet (20 doc types) + MIDV-2020 (50 types subsampled to 20 buckets).
- Augmentation: perspective warp, lighting variation, blur, JPEG compression, partial occlusion.
- Epochs: 50. Time: ~4 hrs on A10G.

**MRZ OCR:**
- Base: CRNN from scratch (small model, domain-specific).
- Loss: CTCLoss.
- Generate training data: render MRZ strings with OCR-B font + noise/blur/skew.
- 50K samples sufficient due to limited character set (36 chars + filler).
- Epochs: 100. Time: ~2 hrs on A10G.

**Security feature detector:**
- Base: EfficientNet-B0 pretrained on ImageNet.
- Loss: BCEWithLogitsLoss (multi-label, one per feature).
- Train on MIDV-Holo (hologram detection) + synthetic features.
- Challenge: limited labeled data for security features. Use weak supervision
  (label based on document type: "passport X should have hologram Y").
- Epochs: 50. Time: ~3 hrs on A10G.

### 3.6 Inference Pipeline

```
CLIENT-SIDE:
  1. User captures/uploads ID document
  2. Document detection: ONNX model crops + corrects perspective
  3. Document classification: ONNX model identifies type + country
  4. Quality check: JavaScript heuristics (blur, glare, resolution)
  5. Face extraction: MediaPipe FaceLandmarker (existing)
  6. MRZ extraction: ONNX CRNN model + JavaScript validation per ICAO 9303

SERVER-SIDE (optional, for enhanced verification):
  7. Font consistency: PaddleOCR extracts text + metrics
  8. Template matching: compare against known templates for this doc type
  9. Cross-field validation: dates, checksums, field format rules

AGGREGATION (client-side):
  10. Weighted fusion of all stage scores -> authenticity_score + verdict
```

### 3.7 Model Size and Deployment

| Component | Parameters | ONNX Size (fp16) | Deployment |
|-----------|-----------|-------------------|------------|
| Document classifier (B0) | 5.3M | ~10MB | Browser |
| MRZ OCR (CRNN) | ~2M | ~5MB | Browser |
| Security feature detector (B0) | 5.3M | ~10MB | Browser |
| **Total client-side** | **~12.6M** | **~25MB** | **Browser** |
| PaddleOCR (server) | ~12M | N/A | Vercel Edge |
| Template DB (JSON) | N/A | ~2MB | CDN/Browser |

Combined client-side payload: ~25MB. Acceptable. Can lazy-load per stage.

### 3.8 Key Challenge: 195 Countries

Supporting 195 countries requires a scalable template database. Strategy:

**Phase 1 (MVP):** Top 20 countries by Deep-Check user base (EU + US + UK + common).
Train the classifier on these 20. For unknown documents, return "unrecognized" and
still run MRZ validation + generic security checks.

**Phase 2:** Expand to 50 countries using IDNet (10 US + 10 EU) + synthetic templates.

**Phase 3:** Use Regula's public documentation (16,000+ templates across 254 territories)
as a reference for field positions and expected security features. Build a JSON template
database with fields: `{ country, doc_type, mrz_format, expected_features[], field_positions[], font_family }`.

**Phase 4:** Consider licensing Regula Document Reader SDK for production if template
coverage becomes a bottleneck. Their API handles 254 countries out of the box.

### 3.9 Estimated Training Time (A10G)

| Sub-model | Data | Epochs | Time |
|-----------|------|--------|------|
| Document classifier | 100K | 50 | ~4 hrs |
| MRZ OCR | 50K | 100 | ~2 hrs |
| Security feature detector | 50K | 50 | ~3 hrs |
| **Total** | | | **~9 hours** |

### 3.10 This Week vs Later

**This week (days 1-7):**
- [ ] Download MIDV-2020 and IDNet datasets
- [ ] Build MRZ validation library in TypeScript (pure logic, no model needed)
  - Parse TD1 (ID cards: 3x30), TD2 (some IDs: 2x36), TD3 (passports: 2x44)
  - Validate check digits per ICAO 9303
  - Extract fields: name, nationality, DOB, expiry, doc number, sex
- [ ] Build document quality assessment heuristics (blur, glare, resolution)
- [ ] Begin training document type classifier on IDNet subset (20 types)

**Later (weeks 2-4):**
- [ ] Train MRZ OCR model on synthetic MRZ data
- [ ] Train security feature detector on MIDV-Holo
- [ ] Build template database for top 20 countries (JSON)
- [ ] Integrate font consistency check with PaddleOCR (server-side)
- [ ] Build dedicated ID verification page in Deep-Check
- [ ] Expand to 50+ countries

---

## 4. Model 3: OCR + Template Validation

### 4.1 Problem Statement

Extract structured data from official documents (invoices, payslips, certificates,
contracts) and validate the extracted data against known templates and cross-field
rules. Detect inconsistencies that indicate manipulation or fabrication.

### 4.2 Architecture: OCR + Structured Extraction + Validation

```
OCR + TEMPLATE VALIDATION PIPELINE:

  Stage 1: Document Layout Analysis (CLIENT-SIDE or SERVER)
  =========================================================
  Input: Document image (any resolution)
       |
  Layout Detection Model (YOLOv8-nano or PP-StructureV3)
  - Detect regions: header, body, table, footer, signature, stamp, logo
  - Classify document type: invoice, payslip, certificate, contract, receipt
       |
  Output: regions[] with bounding boxes + types, document_type

  Stage 2: OCR Text Extraction (SERVER-SIDE)
  ==========================================
  Input: Document image
       |
  PaddleOCR v3.0 (PP-OCRv5)
  - Text detection: DB++ text detector
  - Text recognition: SVTRv2 (138+ languages, 95%+ accuracy)
  - Output: text_lines[] with bounding boxes + confidence
       |
  Alternatively: Tesseract 5 (lighter, worse on complex layouts)
       |
  Output: [{ text, bbox, confidence, line_id }]

  Stage 3: Field Extraction via Key Information Extraction (SERVER-SIDE)
  =====================================================================
  Input: OCR results + document image
       |
  Option A: LayoutLMv3 (RECOMMENDED for accuracy)
    - Pre-trained multimodal transformer (text + layout + image)
    - Fine-tuned for Semantic Entity Recognition (SER):
      labels text tokens as: header, key, value, date, amount, name, address, etc.
    - Then Relation Extraction (RE): matches keys to their values
    - Input: tokenized text + bbox positions + image patches (224x224)
    - Output: entities[] with labels + key-value pairs
       |
  Option B: Rule-based extraction (RECOMMENDED for speed/simplicity)
    - Regex patterns for common fields: dates, amounts, percentages, emails, phones
    - Spatial proximity matching: for each detected "key" text, find nearest "value" text
    - Template-aware: if document_type is known, use field position priors
       |
  Option C: LLM-based extraction (PP-ChatOCRv4 or GPT-4o)
    - Send OCR text + layout to LLM with JSON schema
    - Most flexible but slowest and requires API call
       |
  Output: extracted_fields: {
    document_type, issuer, recipient, date, amounts[], line_items[],
    totals, signatures_present, stamps_present, ...
  }

  Stage 4: Template Matching (SERVER-SIDE)
  ========================================
  Input: extracted_fields + document_type
       |
  Template Database (JSON):
  - Per document_type: expected fields, field formats, field positions, cross-field rules
  - Example for "invoice":
    {
      required_fields: ["invoice_number", "date", "total", "issuer_name"],
      field_formats: {
        "invoice_number": /^INV-\d{6}$/,
        "date": /^\d{4}-\d{2}-\d{2}$/,
        "total": /^\$?\d+\.?\d{0,2}$/,
      },
      cross_field_rules: [
        "sum(line_items.amount) == subtotal",
        "subtotal + tax == total",
        "date <= today",
        "date >= issuer_incorporation_date",
      ]
    }
       |
  Validation engine:
  - Check required fields present
  - Validate field formats (regex)
  - Run cross-field rules (arithmetic, date logic, reference checks)
  - Check layout consistency (are fields in expected positions?)
       |
  Output: validation_result: {
    valid: boolean,
    errors: [{ field, rule, expected, actual, severity }],
    warnings: [{ field, message }],
    completeness_score: 0-100,
    consistency_score: 0-100,
  }

  Stage 5: Anomaly Detection (SERVER-SIDE)
  ========================================
  Input: extracted_fields + validation_result + OCR confidence
       |
  Statistical anomaly checks:
  - OCR confidence anomaly: fields with unusually low confidence may be tampered
  - Font size anomaly: fields with different font sizes than expected
  - Alignment anomaly: fields not aligned with document grid
  - Duplicate detection: same document submitted with different values
       |
  Output: anomalies[] with severity + location + description

  Stage 6: Final Output
  =====================
  {
    document_type: "invoice",
    extracted_fields: { ... },  // JSON with all detected fields
    confidence_per_field: { invoice_number: 0.98, date: 0.95, total: 0.87, ... },
    validation: {
      valid: false,
      errors: [
        { field: "total", rule: "sum_check", expected: "$1,250.00", actual: "$1,350.00",
          severity: "high", message: "Line item sum does not match total" }
      ],
      warnings: [
        { field: "date", message: "Document date is in the future" }
      ]
    },
    anomalies: [
      { type: "confidence_drop", field: "total", ocr_confidence: 0.67,
        message: "Low OCR confidence on total field - possible manipulation" }
    ],
    overall_score: 72,  // 0-100 trustworthiness
    verdict: "suspicious"
  }
```

### 4.3 Architecture Diagram (Text-Based)

```
+------------------------------------------------------------------+
|                    Document Image Input                            |
+------------------------------------------------------------------+
          |                            |
    [CLIENT-SIDE]               [SERVER-SIDE]
          |                            |
  +-------v--------+          +-------v--------+
  | Layout Analysis |          | PaddleOCR v3.0 |
  | (YOLOv8-nano)   |          | PP-OCRv5       |
  | or client       |          | (138+ langs)   |
  | heuristics      |          +-------+--------+
  +-------+--------+                  |
          |                    +-------v-----------+
          |                    | Key Info Extraction|
          |                    | LayoutLMv3 or      |
          |                    | Rule-based engine  |
          |                    +-------+-----------+
          |                            |
          +----------+-----------------+
                     |
            +--------v---------+
            | Template Matcher  |
            | (JSON rules DB)   |
            +--------+---------+
                     |
            +--------v---------+
            | Anomaly Detector  |
            | (statistical)     |
            +--------+---------+
                     |
            +--------v---------+
            | Final Scoring     |
            | & Verdict         |
            +------------------+
```

### 4.4 Datasets

| Dataset | Size | Type | Source | Notes |
|---------|------|------|--------|-------|
| **SROIE** | 1,000 receipts | Receipt OCR + KIE | [ICDAR 2019](https://rrc.cvc.uab.es/?ch=13) / [Kaggle](https://www.kaggle.com/datasets/urbikn/sroie-datasetv2) | 4 fields: company, date, address, total. Standard benchmark for receipt KIE. |
| **CORD** | 11,000 receipts | Receipt parsing (multilingual) | Academic request | Korean + English. 30+ field types. Box-level annotations. |
| **FUNSD** | 199 forms | Form understanding | Academic | Question/answer/header entity labeling. Standard for SER/RE benchmarks. |
| **Kleister-NDA** | 254 NDA contracts | Long document KIE | Academic | Fields: party names, jurisdiction, effective date, term. |
| **DocTamper** | 170K documents | Tampered documents | [GitHub](https://github.com/qcf-568/DocTamper) | Can be used for training anomaly detection (tampered fields have different OCR characteristics). |
| **Real-world documents** | Kaggle collections | Invoices, receipts | [shaz13/real-world-documents-collections](https://www.kaggle.com/datasets/shaz13/real-world-documents-collections) | Already used in existing pipeline. |
| **Synthetic invoices** | Scalable | Invoices + payslips | Internal generation | Use Pillow/Faker to generate synthetic invoices with known ground truth. Apply random manipulations to create tampered versions. |

### 4.5 Training Approach

**LayoutLMv3 fine-tuning (Option A):**
- Base: `microsoft/layoutlmv3-base` (133M params, 512MB).
- Fine-tune for SER on FUNSD + SROIE + CORD.
- Loss: CrossEntropyLoss per token (NER-style).
- LoRA fine-tuning to reduce compute: rank=16, alpha=32. Reduces trainable params from
  133M to ~4M. Full model stays ~512MB but training is 5x faster.
- Epochs: 20. Time: ~6 hrs on A10G.
- F1 target: > 0.95 on SROIE, > 0.90 on FUNSD.

**Note:** LayoutLMv3 is too large for browser deployment (512MB). This model runs
server-side only. The client sends the document image to a Vercel Edge Function or
Supabase Edge Function that runs PaddleOCR + LayoutLMv3.

**Rule-based extraction (Option B, recommended for MVP):**
- No training needed. Pure TypeScript.
- Regex library for dates, amounts, percentages, emails, phone numbers.
- Spatial proximity matching using OCR bounding boxes.
- Template JSON files with field definitions per document type.
- Can be deployed immediately, then upgraded to LayoutLMv3 later.

### 4.6 Inference Pipeline

```
MVP (Rule-based, deployable this week):

  1. User uploads document image
       |
  2. [CLIENT] Layout analysis: detect document regions (heuristic or ONNX)
       |
  3. [SERVER] POST /api/v1/ocr with image
     -> PaddleOCR extracts text + bounding boxes + confidence
       |
  4. [SERVER] Rule-based field extraction:
     -> Regex matches for known field patterns
     -> Spatial proximity matching for key-value pairs
       |
  5. [SERVER] Template validation:
     -> Load template rules for detected document_type
     -> Check required fields, format validation, cross-field rules
       |
  6. [CLIENT] Display results: extracted JSON + validation errors + anomalies

ENHANCED (with LayoutLMv3, weeks 3-4):

  3b. [SERVER] LayoutLMv3 inference on OCR results
      -> Semantic entity labeling (key, value, header, date, amount, ...)
      -> Relation extraction (key-value pairing)
      -> Replaces rule-based extraction in step 4
```

### 4.7 Model Size and Deployment

| Component | Parameters | Size | Deployment |
|-----------|-----------|------|------------|
| PaddleOCR PP-OCRv5 | ~12M | ~25MB | Server (Edge Function) |
| LayoutLMv3-base | 133M | ~512MB | Server (dedicated endpoint) |
| Rule-based engine | 0 | ~50KB JS | Browser or Server |
| Template DB (JSON) | 0 | ~100KB | Browser (CDN) |
| Layout detector (YOLOv8-nano, optional) | 3.2M | ~6MB | Browser (ONNX) |

**MVP deployment:** Rule-based engine (browser) + PaddleOCR (server) = minimal infrastructure.

**Enhanced deployment:** LayoutLMv3 requires a server with >2GB RAM. Deploy as a
Supabase Edge Function or dedicated Vercel serverless function. Response time: ~2-5s
per document.

### 4.8 Template Validation Rules (Examples)

```json
{
  "invoice": {
    "required_fields": ["invoice_number", "date", "total", "issuer"],
    "field_formats": {
      "invoice_number": "^[A-Z]{2,4}-?\\d{4,10}$",
      "date": "^\\d{4}[-/]\\d{2}[-/]\\d{2}$",
      "total": "^[\\$\\u20AC\\u00A3]?\\s?\\d{1,3}(,\\d{3})*(\\.\\d{2})?$"
    },
    "cross_field_rules": [
      { "rule": "sum_check", "fields": ["line_items.*.amount"], "target": "subtotal" },
      { "rule": "arithmetic", "formula": "subtotal + tax == total" },
      { "rule": "date_range", "field": "date", "min": "2020-01-01", "max": "today" },
      { "rule": "date_order", "before": "date", "after": "due_date" }
    ]
  },
  "payslip": {
    "required_fields": ["employee_name", "period", "gross_pay", "net_pay", "employer"],
    "cross_field_rules": [
      { "rule": "arithmetic", "formula": "gross_pay - deductions == net_pay" },
      { "rule": "range", "field": "tax_rate", "min": 0, "max": 0.60 }
    ]
  },
  "certificate": {
    "required_fields": ["recipient_name", "issuer", "date", "title"],
    "cross_field_rules": [
      { "rule": "date_range", "field": "date", "min": "1950-01-01", "max": "today" }
    ]
  }
}
```

### 4.9 Estimated Training Time (A10G)

| Component | Data | Epochs | Time |
|-----------|------|--------|------|
| LayoutLMv3 fine-tune (LoRA) | 12K (FUNSD+SROIE+CORD) | 20 | ~6 hrs |
| Layout detector (YOLOv8-nano) | 10K | 100 | ~3 hrs |
| **Total** | | | **~9 hours** |

Rule-based engine and template DB require no training.

### 4.10 This Week vs Later

**This week (days 1-7):**
- [ ] Build rule-based field extraction engine (TypeScript)
  - Date regex (ISO, US, EU formats)
  - Amount regex (with currency symbols)
  - Key-value proximity matching (using OCR bbox coordinates)
- [ ] Build template validation engine (TypeScript)
  - JSON template schema definition
  - Required field checker
  - Format validator (regex per field)
  - Cross-field arithmetic validator
- [ ] Set up PaddleOCR server endpoint (`/api/v1/ocr`)
  - Accept image, return text + bboxes + confidence
- [ ] Create invoice and payslip templates (JSON)
- [ ] Wire into DocSafe page as "Document Validation" tab

**Later (weeks 2-4):**
- [ ] Download SROIE, CORD, FUNSD datasets
- [ ] Fine-tune LayoutLMv3 for SER + RE
- [ ] Train YOLOv8-nano layout detector on document regions
- [ ] Add certificate, contract, diploma templates
- [ ] Build anomaly detection (OCR confidence drops, font inconsistencies)
- [ ] Integration with Model 1 (Document Forensics): run manipulation detection
  on regions flagged by OCR anomaly detection

---

## 5. Shared Infrastructure

### 5.1 ONNX Export Pipeline

All models use the same export flow, extending `ml/export_model.py`:

```python
# Standard export for all models:
torch.onnx.export(
    model,
    dummy_input,
    output_path,
    opset_version=17,
    input_names=["input_name"],
    output_names=["output_name"],
    dynamic_axes={"input_name": {0: "batch"}, "output_name": {0: "batch"}},
)

# Followed by:
# 1. onnx.shape_inference.infer_shapes()
# 2. onnxsim.simplify() (ONNX Simplifier)
# 3. Optional: onnxruntime quantization (INT8 for mobile)
```

### 5.2 Browser Inference Wrapper

All client-side models share a common inference wrapper pattern matching the existing
`neuralForensics.ts` and `docsafe/page.tsx` architecture:

```
1. Lazy-load ONNX model (fetch ArrayBuffer, cache in global variable)
2. Create InferenceSession (WASM or WebGPU backend)
3. Preprocess image to float32 tensor (ImageNet normalization)
4. Run inference
5. Post-process outputs (sigmoid, argmax, heatmap overlay)
6. Return typed result object with scores + alerts + explanation
```

### 5.3 Model Storage

| Model | Path | CDN | Lazy Load |
|-------|------|-----|-----------|
| Doc Forensics | `/public/models/doc-forensics/doc_forensics_v1.onnx` | Vercel CDN | Yes, on first DocSafe analysis |
| ID Classifier | `/public/models/id-verify/id_classifier_v1.onnx` | Vercel CDN | Yes, on first ID verification |
| MRZ OCR | `/public/models/id-verify/mrz_ocr_v1.onnx` | Vercel CDN | Yes, after ID detection |
| Security Features | `/public/models/id-verify/security_features_v1.onnx` | Vercel CDN | Yes, after ID detection |
| S3 training artifacts | `s3://deep-check-models/doc-forensics/` | N/A | N/A |

### 5.4 Veritas Ensemble Integration

The Document Forensics model (Model 1) integrates as a new layer in the Veritas Ensemble:

```typescript
// New layer in veritasEnsemble.ts:
export type LayerName =
    | 'rppg' | 'facs' | 'cnn_v1' | 'cnn_v2' | 'efficientnet' | 'keystroke'
    | 'doc_forensics'   // NEW: Document manipulation detection

// Weight allocation (when doc_forensics is available):
// rppg: 0.25, facs: 0.22, efficientnet: 0.18, doc_forensics: 0.15,
// keystroke: 0.10, cnn_v2: 0.10
```

Models 2 and 3 (ID Verification, OCR+Validation) operate as standalone pipelines, not
as Veritas Ensemble layers. They produce their own verdicts with their own scoring.

### 5.5 API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/v1/doc-forensics` | POST | Server-side document forensics (for larger images) | API key |
| `/api/v1/id-verify` | POST | Full ID verification pipeline | API key |
| `/api/v1/ocr` | POST | OCR extraction only (PaddleOCR) | API key |
| `/api/v1/ocr/validate` | POST | OCR + template validation | API key |

### 5.6 AWS Training Resources

All training uses the existing Deep-Check EC2 infrastructure:

| Resource | Spec | Use |
|----------|------|-----|
| Instance | g5.xlarge (1x A10G, 24GB VRAM, 4 vCPU, 16GB RAM) | Single-model training |
| Instance | g5.2xlarge (1x A10G, 24GB VRAM, 8 vCPU, 32GB RAM) | Large dataset training |
| S3 | `s3://deep-check-models/` (eu-west-1) | Model artifacts + datasets |
| IAM | `deep-check-ec2-training` profile | S3 read/write access |
| SSH Key | `deep-check-v4-key` | EC2 access |

Training cost estimate: ~$1.01/hr (g5.xlarge on-demand) x ~31 hours total = ~$31 for
all three models.

---

## 6. Timeline and Prioritization

### 6.1 Priority Order

1. **Model 1: Document Forensics** -- Highest priority. Directly extends the existing
   DocSafe product. Training script already exists. Most of the browser-side
   infrastructure (ELA, noise analysis) is already in `neuralForensics.ts`.

2. **Model 3: OCR + Template Validation** -- Second priority. The MVP (rule-based)
   requires no ML training and can ship within a week. High user value for invoice
   and payslip verification.

3. **Model 2: ID Document Verification** -- Third priority. Most complex pipeline
   (6 stages, 3 sub-models). Requires the most dataset preparation and template
   work. Start with MRZ validation (pure code) and document classification.

### 6.2 Week-by-Week Plan

**Week 1 (Current):**
- Doc Forensics: Prepare datasets, modify stem, begin training
- OCR Validation: Build rule-based extraction + template engine (no ML)
- ID Verification: Build MRZ validation library (pure TypeScript)

**Week 2:**
- Doc Forensics: Complete training, export ONNX, benchmark on CASIA v2.0
- OCR Validation: Set up PaddleOCR server endpoint, wire into DocSafe
- ID Verification: Download IDNet, begin training document classifier

**Week 3:**
- Doc Forensics: Integrate heatmap into DocSafe UI, browser testing
- OCR Validation: Download SROIE/CORD, begin LayoutLMv3 fine-tuning
- ID Verification: Train MRZ OCR model, begin security feature detector

**Week 4:**
- Doc Forensics: Add to Veritas Ensemble, INT8 quantization
- OCR Validation: Deploy LayoutLMv3 server endpoint, A/B test vs rule-based
- ID Verification: Build template DB for top 20 countries, integration testing

### 6.3 Success Metrics

| Model | Metric | Target | Benchmark Dataset |
|-------|--------|--------|-------------------|
| Doc Forensics | AUC | > 0.98 | CASIA v2.0 |
| Doc Forensics | Pixel IoU (heatmap) | > 0.60 | DocTamper |
| Doc Forensics | EER | < 3% | IMD2020 |
| ID Verification (classifier) | Top-1 Accuracy | > 95% | IDNet test set |
| ID Verification (MRZ) | Character Accuracy | > 99% | MIDV-2020 |
| ID Verification (overall) | Fraud Detection Rate | > 90% | IDNet fraud variants |
| OCR Extraction (LayoutLMv3) | F1 Score | > 0.95 | SROIE |
| OCR Validation (rules) | False Positive Rate | < 5% | Synthetic invoices |

---

## 7. References

### Papers

1. Qu et al., "Towards Robust Tampered Text Detection in Document Image: New Dataset and New Solution," CVPR 2023. [GitHub](https://github.com/qcf-568/DocTamper)
2. Novozamsky et al., "IMD2020: A Large-Scale Annotated Dataset Tailored for Detecting Manipulated Images," WACV 2020.
3. Bulatov et al., "MIDV-2020: A Comprehensive Benchmark Dataset for Identity Document Analysis," [arXiv:2107.00396](https://arxiv.org/abs/2107.00396).
4. Kachhiya et al., "IDNet: A Novel Dataset for Identity Document Analysis and Fraud Detection," [arXiv:2408.01690](https://arxiv.org/abs/2408.01690).
5. Huang et al., "LayoutLMv3: Pre-training for Document AI with Unified Text and Image Masking," [arXiv:2204.08387](https://arxiv.org/abs/2204.08387).
6. EdgeDoc: "Hybrid CNN-Transformer Model for Accurate Forgery Detection and Localization in ID Documents," [arXiv:2508.16284](https://arxiv.org/html/2508.16284v1).
7. DocForgeNet: "Dual Cross-Stream Fusion Network for Robust Forgery Detection in Scanned Documents," [Springer](https://link.springer.com/chapter/10.1007/978-3-032-04627-7_19).
8. DFST-UNet: "Dual-Domain Fusion Swin Transformer U-Net for Image Forgery Localization," [MDPI](https://www.mdpi.com/1099-4300/27/5/535).
9. DFF-Adapter: "Fine-Grained DINO Tuning with Dual Supervision for Face Forgery Detection," [arXiv:2511.12107](https://arxiv.org/html/2511.12107).
10. Forensim: "Can Image Splicing and Copy-Move Forgery Be Detected by the Same Model?", [arXiv](https://arxiv.org/html/2602.10079).
11. FantasyID: "A Dataset for Detecting Digital Manipulations of ID-Documents," [arXiv](https://arxiv.org/pdf/2507.20808).
12. PaddleOCR 3.0 Technical Report, [arXiv](https://arxiv.org/html/2507.05595v1).
13. Weakly Supervised Training for Hologram Verification in Identity Documents, [arXiv:2404.17253](https://arxiv.org/abs/2404.17253).
14. FakeIDet2: Privacy-Aware Detection of Fake Identity Documents, [ResearchGate](https://www.researchgate.net/publication/397815775).

### Datasets

| Dataset | URL |
|---------|-----|
| DocTamper | https://github.com/qcf-568/DocTamper |
| CASIA v2.0 | https://www.kaggle.com/datasets/divg07/casia-20-image-tampering-detection-dataset |
| CASIA v2.0 Corrected GT | https://github.com/SunnyHaze/CASIA2.0-Corrected-Groundtruth |
| IMD2020 | WACV paper (request access) |
| Columbia Splicing | https://www.ee.columbia.edu/ln/dvmm/downloads/AuthSplicedDataSet/ |
| MIDV-2020 | https://arxiv.org/abs/2107.00396 (links in paper) |
| MIDV-500 | Smart Engines (request access) |
| MIDV-Holo | ResearchGate (request access) |
| IDNet | https://www.kaggle.com/datasets/chitreshkr/idnet-identity-document-analysis |
| SROIE | https://www.kaggle.com/datasets/urbikn/sroie-datasetv2 |
| FUNSD | Academic (request access) |
| CORD | Academic (request access) |
| Image Forgery Datasets List | https://github.com/greatzh/Image-Forgery-Datasets-List |

### Tools and Libraries

| Tool | Purpose | URL |
|------|---------|-----|
| timm | PyTorch image models (EfficientNet, etc.) | https://github.com/huggingface/pytorch-image-models |
| PaddleOCR | OCR engine (PP-OCRv5) | https://github.com/PaddlePaddle/PaddleOCR |
| LayoutLMv3 | Document AI transformer | https://huggingface.co/microsoft/layoutlmv3-base |
| ONNX Runtime Web | Browser inference (WASM/WebGPU) | https://onnxruntime.ai/docs/tutorials/web/ |
| Albumentations | Image augmentation | https://albumentations.ai/ |
| mrz (Python) | MRZ generation and validation | https://github.com/Arg0s1080/mrz |
| PassportEye | MRZ extraction from images | https://github.com/konstantint/PassportEye |
| Regula SDK | Commercial ID verification (reference) | https://regulaforensics.com/products/document-reader-sdk/ |

---

*End of Architecture Document*
