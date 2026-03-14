# Veritas Engine v2 — Design Document
**Date:** 2026-03-14
**Status:** Approved
**Project:** Deep-Check — Interview Integrity Platform

---

## Overview

Veritas Engine v2 is a 5-layer multimodal deepfake and identity fraud detection system that combines:
- **Approach C**: Biomechanical neuromotor analysis (novel, real-time, browser-side)
- **Approach B**: Real-data trained CNN models (FaceForensics++, DFDC, CelebDF-v2)

The system is designed for government agencies, private enterprises, and universities (public and private), with both **SaaS** and **self-hosted** deployment options.

---

## Target Users

| Sector | Use Case | Deployment |
|--------|----------|------------|
| Government agencies | ID verification, testimony integrity | Self-hosted (air-gapped) |
| Private companies | Remote hiring, contract signing | SaaS or Self-hosted |
| Universities (public/private) | Online exam proctoring, thesis defense | SaaS or Self-hosted |

---

## Architecture: 5-Layer Ensemble

### Overview

```
┌──────────────────────────────── BROWSER (client-side, private) ────────────────────────────────┐
│                                                                                                   │
│  L1: rPPG-Motion Granger Coupling   L2: FACS Biomechanical   L3: Blendshape CNN v2              │
│  ──────────────────────────────     ──────────────────────   ─────────────────────────────      │
│  Cardiac pulse extracted from       52 blendshapes → 44 AU   3-stream architecture:             │
│  skin color (rPPG) + landmark       Ekman FACS rules         temporal + covariance +            │
│  micro-vibration coupling           6 biomechanical checks   frequency (FFT)                    │
│  Granger causality test                                       Trained on FF++ + DFDC             │
│                                                                                                   │
│  L5: Keystroke Biometrics                                                                         │
│  ──────────────────────────                                                                       │
│  XGBoost + IsoForest + BiLSTM (AUC 1.0, existing)                                               │
│                                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │ HTTPS (scores only, no video)
┌──────────────────────────────── SERVER (Vercel / Docker) ──────────────────────────────────────┐
│                                                                                                   │
│  L4: Pixel Forensics                              Bayesian Ensemble                              │
│  ────────────────────────────────                 ──────────────────────────────────────────    │
│  EfficientNet-Lite0 (ONNX, ~4MB)                 P(fake) = sigmoid(Σ wᵢ·logit(Lᵢ) + b)         │
│  + DCT frequency analysis (GAN artifacts)        CI_95 = [P ± 1.96·σ]                           │
│  + Skin texture LBP analysis                     XAI: which layer + which feature + why         │
│  Trained on FaceForensics++ c23                                                                  │
│                                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
┌──────────────────────────────── SUPABASE / POSTGRES ───────────────────────────────────────────┐
│  Audit Chain (SHA-256 blocks)   Forensic Reports    Session History    API Keys                 │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: rPPG-Motion Granger Coupling (THE NOVEL ALGORITHM)

### Biophysical Principle

Real human faces have facial arteries. The cardiac cycle creates pressure waves that physically deform facial tissue by ~0.05–0.3mm per heartbeat. MediaPipe landmarks register these as high-frequency micro-vibrations.

Deepfakes generate realistic pixels but do NOT simulate vascular physics. Therefore:
- **Real human**: rPPG signal (skin color oscillation) Granger-causes landmark micro-motion
- **Deepfake/photo**: No causal relationship — rPPG and motion are statistically independent

This has been studied independently in academic literature but **never implemented as a real-time browser-side deepfake detector**.

### Implementation

**rPPG Extraction (per frame):**
```
ROI_forehead = mean(green_channel, landmarks[10,338,297,332...])
ROI_cheeks   = mean(green_channel, landmarks[234,454,...])
rppg_raw[t]  = 0.5·ROI_forehead + 0.25·(ROI_cheeks_L + ROI_cheeks_R)
rppg[t]      = bandpass_filter(rppg_raw, 0.7Hz, 4.0Hz)  // 42–240 BPM
```

**Motion Signal Extraction (per frame):**
```
z_coords[t] = [landmarks[1].z, landmarks[10].z, landmarks[152].z]
motion[t]   = highpass_filter(mean(z_coords), 0.7Hz)  // removes head pose, keeps vascular
```

**Granger Causality Test (every 150 frames / ~10s):**
```
AR  model: motion[t] = Σ aᵢ·motion[t-i] + ε₁           (p=4 lags, ~270ms)
VAR model: motion[t] = Σ aᵢ·motion[t-i] + Σ bᵢ·rppg[t-i] + ε₂

F = ((RSS_AR - RSS_VAR)/p) / (RSS_VAR/(n-2p-1))
coupling_score = 1 - p_value(F_distribution, df1=p, df2=n-2p-1)

phase_lag_frames = argmax(cross_correlation(rppg, motion, max_lag=20))
// Expected human: 2–8 frames (130–530ms, vascular transit time)
```

**Interpretation:**
- `coupling_score > 0.85` → Human confirmed (rPPG causes motion)
- `coupling_score < 0.40` → Deepfake/Photo signal
- `phase_lag` outside [2,8] frames → Additional suspicion

**Calibration:** Train thresholds on VoxCeleb2 (real faces) and FaceForensics++ (fakes).

---

## Layer 2: FACS Biomechanical Constraint Engine

### Action Unit Mapping (MediaPipe → FACS)

```typescript
const FACS_MAP = {
  AU1:  ['browInnerUp'],
  AU4:  ['browDownLeft', 'browDownRight'],
  AU6:  ['cheekSquintLeft', 'cheekSquintRight'],   // Duchenne marker
  AU12: ['mouthSmileLeft', 'mouthSmileRight'],
  AU25: ['jawOpen'],
  AU45: ['eyeBlinkLeft', 'eyeBlinkRight'],
  AU17: ['mouthPucker'],
}
```

### The 6 Biomechanical Rules (Ekman 2002 + FACS Manual)

| Rule | Description | Trust Penalty |
|------|-------------|---------------|
| **Duchenne Test** | AU12 active > 85% without AU6 = fake smile | −15% |
| **Bilateral Sync** | `\|leftAU − rightAU\|` < 0.005 in ≥3 pairs = synthesis artifact | −20% |
| **Co-contraction** | AU1 > 0.7 AND AU4 > 0.7 without AU17 = biomechanically impossible | −10% |
| **Blink Trajectory** | Close:open duration ratio must be 0.6–0.8 | −15% |
| **Expression Coherence** | Contradictory AU combinations without valid expression | −10% |
| **Temporal Smoothing** | AU transitions < 80ms = AI over-smoothing | −10% |

### Score computation
```
facs_score = 100 - Σ(active_violations × penalty)
Alert if facs_score < 60 sustained over 20 frames
```

---

## Layer 3: Blendshape CNN v2 (3-Stream Architecture)

### Improvements over v1

v1: Single Conv1D + BiGRU + Attention stream
v2: Three independent streams fused late

```
Input: 90 frames × 59 features (52 BS + 4 iris + 3 depth)

Stream A — Temporal:    Conv1D(64) → BatchNorm → BiGRU(128) → MH-Attention(4 heads) → 128-dim
Stream B — Covariance:  52×52 correlation matrix → Conv2D(32,3×3)×3 → GlobalAvgPool → 128-dim
Stream C — Frequency:   FFT(each BS over 90 frames) → magnitude spectrum → Conv1D(64) → 128-dim

Late Fusion: concat[A,B,C] → Dense(256) → Dropout(0.3) → Dense(3) → Softmax
```

### Training Data

| Source | Real | Fake | Fake Methods |
|--------|------|------|-------------|
| FaceForensics++ c23 | 1000 vids | 4000 vids | DF, F2F, FS, NT |
| DFDC Preview | 0 | 3000 clips | Multiple |
| CelebDF-v2 | 590 vids | 5639 vids | High-quality |
| VoxCeleb2 (subset) | 5000 clips | 0 | Real only |
| **Total sequences** | ~50K | ~50K | — |

### Expected metrics (based on FF++ benchmarks)
- Intra-dataset AUC: >0.99
- Cross-dataset AUC: >0.85 (target, dependent on training)

---

## Layer 4: EfficientNet-Lite0 Pixel Forensics (Server-Side)

### Model
- Architecture: EfficientNet-Lite0 (~4MB ONNX, feasible for serverless)
- Input: 224×224 face crop (extracted from frame)
- Training: FaceForensics++ raw frames
- Additional signals:
  - DCT frequency analysis: GAN artifacts concentrate in high-frequency DCT bands
  - LBP (Local Binary Patterns): skin texture anomalies at blending boundaries

### Server-side execution
- API route: `POST /api/deepfake-analyze`
- Input: base64-encoded face crop (single frame or batch of 5)
- Output: pixel_score + dct_anomaly_region + lbp_score
- Runtime: onnxruntime-node (no Python dependency on server)

---

## Bayesian Ensemble + XAI

### Combination
```
logit(fake) = w₁·logit(L1) + w₂·logit(L2) + w₃·logit(L3) + w₄·logit(L4) + w₅·logit(L5) + b

Default weights (conservative): [0.35, 0.20, 0.20, 0.15, 0.10]
// L1 (rPPG) highest weight — most novel, robust to compression

P(fake) = sigmoid(logit(fake))
CI_95   = [P − 1.96·σ, P + 1.96·σ]  where σ = std(layer_scores)
Uncertainty = "high" if σ > 0.25, "low" if σ < 0.10
```

### XAI Output Format
```json
{
  "prediction": "deepfake_video",
  "confidence": 0.94,
  "confidence_interval": [0.89, 0.97],
  "uncertainty": "low",
  "risk_score": 87,
  "layers": {
    "rppg_coupling":   { "score": 0.12, "heart_rate_bpm": 71, "coupling_absent": true, "weight": 0.35 },
    "facs_score":      { "score": 38,   "violations": ["duchenne_missing", "bilateral_sync"], "weight": 0.20 },
    "blendshape_cnn":  { "prediction": "deepfake_video", "prob": 0.91, "weight": 0.20 },
    "pixel_forensics": { "score": 0.82, "dct_anomaly": "periorbital_L", "weight": 0.15 },
    "keystroke":       { "ai_risk": 12, "weight": 0.10 }
  },
  "xai_explanation": "rPPG cardiac coupling absent (strongest signal, 35% weight). FACS: non-Duchenne smile for 4.2s. CNN: 91% deepfake_video. DCT anomaly in left periorbital region.",
  "audit_hash": "sha256:a3f9c2...",
  "chain_block": 7,
  "timestamp_signed": "2026-03-14T10:35:00Z"
}
```

---

## Cryptographic Audit Trail

### Chain of Custody (tamper-evident)

```
Block_0: SHA256(session_id || t₀ || scores_t₀ || screenshot_hash_t₀)
Block_1: SHA256(Block_0_hash || t₁ || scores_t₁ || screenshot_hash_t₁)
...
Block_N: SHA256(Block_{N-1}_hash || tN || final_report_json)
Final:   HMAC-SHA256(Block_N_hash, institution_secret_key)
```

Any modification to any block invalidates all subsequent hashes. Admissible as forensic evidence.

### Storage (Supabase)
```sql
deepfake_audit_chain (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES assessments(id),
  block_index integer,
  block_hash text,       -- SHA-256 of this block
  prev_hash text,        -- SHA-256 of previous block
  payload jsonb,         -- scores + screenshot_hash + timestamp
  created_at timestamptz
)
```

---

## Deployment Options

### Option A — SaaS (Vercel)
- Zero infrastructure for institution
- Data: scores only transmitted, no video stored
- GDPR: DPA with Vercel (Frankfurt EU region) + Supabase (EU)
- Pricing: existing plan system (Free / Starter / Pro / Enterprise)
- SLA: Vercel Pro 99.9%

### Option B — Self-Hosted (Docker)
```yaml
# docker-compose.yml (enhanced)
services:
  web:        # Next.js app
  ml_server:  # FastAPI + ONNX models
  postgres:   # Audit trail + sessions
  nginx:      # TLS termination
```
- Air-gapped deployment (no internet required after setup)
- All ONNX models bundled in Docker image
- GPU support optional (CUDA variant)
- Minimum: 4 CPU, 8GB RAM, 20GB storage
- Configuration via `.env` file

### API Compatibility
Identical REST API in both options — transparent to integrators:
```
POST /api/v1/sessions
GET  /api/v1/sessions/:id/report
POST /api/v1/sessions/:id/verify
GET  /api/v1/health
```

---

## Training Pipeline

### Scripts to deliver

| Script | Purpose |
|--------|---------|
| `infra/download_ff.py` | Download FaceForensics++ (requires academic email) |
| `infra/download_voxceleb.py` | Download VoxCeleb2 subset (free) |
| `infra/extract_features_mp.py` | MediaPipe feature extraction from video files |
| `infra/train_deepfake_v2.py` | Train 3-stream blendshape CNN on real data |
| `infra/train_efficientnet_pixel.py` | Train EfficientNet-Lite0 on face crops |
| `infra/calibrate_rppg.py` | Calibrate rPPG thresholds on real faces |
| `infra/calibrate_facs.py` | Learn AU co-occurrence matrix from real faces |
| `infra/train_ensemble.py` | Learn Bayesian ensemble weights |

### Datasets

| Dataset | Size | Access |
|---------|------|--------|
| FaceForensics++ c23 | ~35GB | Academic email (faceforensics.net) |
| DFDC Preview | ~5GB | Kaggle API key |
| CelebDF-v2 | ~4GB | GitHub form |
| VoxCeleb2 subset | ~10GB | Free (YouTube) |

---

## New Files to Create

### Browser (src/lib/)
- `rppgCoupling.ts` — rPPG extraction + Granger causality
- `facsConstraints.ts` — FACS rule engine
- `deepfakeInferenceV2.ts` — 3-stream CNN inference
- `veritasEnsemble.ts` — Bayesian ensemble + XAI
- `auditChain.ts` — SHA-256 chain of custody

### Server (src/app/api/)
- `deepfake-analyze/route.ts` — EfficientNet pixel analysis
- `audit-chain/route.ts` — Chain verification endpoint
- `v1/sessions/route.ts` — Institutional API
- `v1/sessions/[id]/report/route.ts` — Full forensic report

### Components
- `src/components/VerificationCamera.tsx` — integrate L1+L2 new layers
- `src/app/interview/page.tsx` — new events + XAI display
- `src/app/dashboard/reports/[id]/page.tsx` — audit chain viewer

### Infrastructure
- `infra/train_deepfake_v2.py`
- `infra/train_efficientnet_pixel.py`
- `infra/extract_features_mp.py`
- `infra/calibrate_rppg.py`
- `infra/calibrate_facs.py`
- `infra/train_ensemble.py`
- `infra/download_ff.py`
- `infra/download_voxceleb.py`
- `docker-compose.yml` (enhanced for self-hosted)

### Database
- Migration: `deepfake_audit_chain` table
- Migration: `deepfake_sessions` enhanced schema

---

## Academic Metrics Targets

| Metric | Target | Benchmark |
|--------|--------|-----------|
| Intra-dataset AUC (FF++) | > 0.99 | XceptionNet: 0.996 |
| Cross-dataset AUC | > 0.85 | XceptionNet: 0.736 |
| rPPG coupling F1 (real vs fake) | > 0.88 | Novel — no benchmark |
| FACS rule precision | > 0.80 | Novel — no benchmark |
| Ensemble AUC | > 0.99 | Target: best in class |
| Inference latency (browser) | < 200ms/frame | — |
| Server inference | < 800ms/request | — |
