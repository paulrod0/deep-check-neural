# Veritas v5 — Real-Data Training + Neural Biometrics Upgrade

**Date:** 2026-03-13
**Status:** Approved
**Scope:** DocForensics CNN v5 (real datasets), Biometrics Neural Upgrade (MediaPipe FaceMesh/Iris, Deepfake CNN)

---

## Problem Statement

### DocForensics CNN
The current DocForensics CNN (EfficientNet-B4) trains on 100% synthetic data generated with PIL/NumPy. This creates critical blind spots:

1. **False positives on legitimate documents**: A photo of a real DNI captured by phone and converted to PDF introduces camera noise, perspective distortion, JPEG compression chains, reflections, and paper texture. The model has never seen these artifacts and will classify them as manipulation.

2. **KYC vs Forensics dual use**: In KYC, false positives reject real customers. In forensics, false negatives miss manipulations. The current model cannot distinguish "ugly but authentic" from "cleanly manipulated."

3. **Missing capture-method awareness**: A scan, a phone photo, a screenshot, and a digital PDF all produce fundamentally different artifact patterns. The model needs to know HOW a document was captured to set appropriate manipulation thresholds.

### Biometrics Stack
- **face-api.js** is unmaintained, uses TinyFaceDetector (68 landmarks), no iris tracking, no depth estimation
- **Deepfake detection** is heuristic-only (ELA + noise uniformity), not trained on real deepfakes
- **Ocular photometry** is limited to 5-direction gaze detection, no pupillary reflex or microsaccade tracking
- **Anti-spoofing** is basic (flash + pupil response), no 3D depth analysis

---

## Design

### AREA 1: DocForensics v5 — Real-World Training

#### Phase 1: Dataset Construction

**Public datasets (auto-download script):**

| Dataset | Content | Size | Purpose |
|---------|---------|------|---------|
| MIDV-500 | 500 identity document types, multiple capture conditions | ~4GB | Real authentic documents |
| MIDV-2020 | Extended identity documents with video clips | ~6GB | Varied capture conditions |
| CASIA v2 | 12,614 tampered images + ground truth masks | ~800MB | Real manipulation examples |
| IMD2020 | 2,010 manipulated images + masks | ~1.2GB | Advanced manipulations |
| CoMoFoD | 260 copy-move forgery sets with variations | ~300MB | Copy-move ground truth |

**Real-world augmentation pipeline (applied to synthetic + real):**

```python
def foto_de_documento(img):
    # Perspective warp (phone camera angle 5-25 degrees)
    # Poisson + Gaussian camera noise (sensor model)
    # Motion blur (hand shake, 1-5px kernel)
    # JPEG compression chain (Q=85 camera -> Q=60 messaging -> Q=75 upload)
    # Paper texture overlay (wrinkles, folds, stains)
    # Lighting gradient (shadows, reflections, flash hotspot)

def escaneo_de_documento(img):
    # Moire pattern (halftone interference)
    # Dust/scratch particles
    # Slight rotation (0.5-3 degrees)
    # Scanner resolution (150-600 DPI simulation)
    # Flatbed edge darkening

def screenshot_de_documento(img):
    # Pixel grid pattern
    # Color banding (8-bit quantization)
    # Window border/toolbar artifacts
    # Screen gamma curve

def fotocopia_de_documento(img):
    # Contrast loss (gamma 0.7-1.3)
    # Toner spots/streaks
    # Text edge degradation
    # Generation loss (copy of copy)

def pdf_de_foto(img):
    # PDF compression artifacts
    # Color space conversion (sRGB -> CMYK -> sRGB)
    # Resolution resampling
    # Metadata stripping
```

#### Phase 2: 3-Head Architecture

```
EfficientNet-B4 Backbone (frozen first 3 blocks, fine-tune rest)
    |
    ├── DocType Head: Linear(1792,512) -> SiLU -> Linear(512,8) -> Softmax
    |   Classes: invoice, id_card, passport, certificate, payslip, media_photo, screenshot, other
    |
    ├── Manipulation Head: Linear(1792,256) -> SiLU -> Linear(256,17) -> Softmax
    |   Classes: none + 16 manipulation types (multi-class instead of binary)
    |   This gives EXPLAINABILITY: "detected copy-paste in region X"
    |
    └── CaptureMethod Head: Linear(1792,128) -> SiLU -> Linear(128,5) -> Softmax
        Classes: scan, photo, digital, screenshot, printout
        PURPOSE: Adjust manipulation thresholds based on capture method
```

**Anti-false-positive logic:**
```python
if capture_method == "photo":
    manipulation_threshold = 0.75  # More tolerant (camera artifacts expected)
elif capture_method == "digital":
    manipulation_threshold = 0.35  # Strict (no artifacts expected in native PDF)
elif capture_method == "scan":
    manipulation_threshold = 0.60  # Moderate (scanner artifacts expected)
```

#### Phase 3: Training Strategy

1. **Pre-train** on synthetic data (current training, already running)
2. **Fine-tune** on mixed real+synthetic with lower LR (1e-4 max vs 1e-3)
3. **Hard negative mining**: Over-sample "ugly but authentic" examples
4. **Temperature calibration**: Post-training Platt scaling on validation set
5. **Loss weights**: CrossEntropy for all 3 heads, weighted sum:
   - 0.40 x doc_type_loss
   - 0.40 x manipulation_loss
   - 0.20 x capture_method_loss

#### Phase 4: Evaluation

- Precision@95%Recall for manipulation detection (must be >98%)
- False positive rate on authentic phone-captured documents (must be <2%)
- Per-manipulation-type F1 scores
- Cross-dataset evaluation (train on CASIA, test on IMD2020)

---

### AREA 2: Neural Biometrics Upgrade

#### 2.1 MediaPipe FaceMesh (replaces face-api.js)

**What changes:**
- 68 landmarks -> 478 landmarks (including iris, face contour, lip detail)
- TinyFaceDetector -> BlazeFace (faster, more accurate)
- Adds depth estimation from monocular image
- Runs in browser via WASM/WebGL (~4MB download)

**New capabilities:**
- **3D anti-spoofing**: Real face has depth variation; printed photo is flat
- **Micro-expression detection**: 478 landmarks can detect subtle muscle movements
- **Iris tracking**: Precise pupil center and diameter measurement
- **Head pose**: Accurate yaw/pitch/roll from 3D mesh

#### 2.2 Ocular Photometry (MediaPipe Iris)

**New measurements:**
- **Pupillary Light Reflex (PLR)**: Flash screen white -> measure pupil contraction latency and magnitude. Real eyes respond in 200-300ms. Photos/screens don't.
- **Microsaccade detection**: Involuntary eye movements of ~0.5 degrees every 200-300ms. Impossible to simulate with a static photo or video replay.
- **Gaze pattern during reading**: Natural reading produces specific saccade patterns (left-to-right jumps, regression saccades). Bots/recordings don't match.

#### 2.3 Deepfake Video Detection (new CNN)

**Architecture:**
```
Per-Frame: EfficientNet-B0 (5.3M params) -> 1280-d embedding
    |
Temporal: LSTM(1280, 256) over N frames -> 256-d sequence embedding
    |
Classifier: Linear(256, 128) -> ReLU -> Linear(128, 1) -> Sigmoid
    |
Output: Deepfake probability (0-1)
```

**Training data:**
- FaceForensics++ dataset: 1,000 original + 5,000 manipulated videos
- 5 manipulation methods: Deepfakes, Face2Face, FaceSwap, NeuralTextures, FaceShifter
- Frame-level labels + video-level aggregation

#### 2.4 Browser Lite vs AWS Full

```
BROWSER (Lite Mode - runs locally):
├── MediaPipe FaceMesh + Iris    (~4MB WASM, <50ms/frame)
├── Keystroke BiLSTM             (~50KB ONNX, <10ms)
├── XGBoost bot detector         (~112KB ONNX, <10ms)
├── Liveness (blinks, gaze, PLR, microsaccades, depth)
└── Partial score in <200ms total

AWS (Full Mode - server-side):
├── DocForensics CNN v5          (EfficientNet-B4, ~80MB ONNX)
├── Deepfake CNN                 (EfficientNet-B0 + LSTM, ~25MB ONNX)
├── Transformer keystroke model  (full context analysis)
├── FFT + Wavelets + Textract + Rekognition
├── Ensemble final scoring
└── Complete verdict in ~3-5s
```

---

## Implementation Plan

| Step | Task | Where | Est. Time |
|------|------|-------|-----------|
| 1 | Create dataset download + augmentation script | Local | 2h |
| 2 | Upload datasets to S3 | Local -> S3 | 1h |
| 3 | Write `train_docforensics_v5.py` (3-head, real data) | Local | 3h |
| 4 | Launch v5 training on new EC2 g4dn.2xlarge | EC2 (eu-west-1) | ~80-100h training |
| 5 | Upgrade VerificationCamera.tsx to MediaPipe | Worktree branch | 4h |
| 6 | Add ocular photometry module (PLR, microsaccades) | Worktree branch | 3h |
| 7 | Write `train_deepfake_cnn.py` + launch training | EC2 | ~20h training |
| 8 | Update docForensicsCnn.ts for v5 model (3 heads) | Feature branch | 2h |
| 9 | Integration testing (ensure no regressions) | CI/local | 2h |
| 10 | A/B comparison: v4 synthetic vs v5 real model | Local | 1h |

**Constraint:** All changes in isolated branches/worktrees. Only merged after verification.

---

## Risk Mitigation

- **Current training continues**: v4 synthetic model serves as baseline
- **Isolated branches**: No code changes touch main until verified
- **S3 checkpointing**: Spot instance interruptions don't lose progress
- **Graceful degradation**: If v5 model unavailable, falls back to v4
- **A/B testing**: Both models compared on same test set before switching
