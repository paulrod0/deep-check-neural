# Veritas Engine v2 Implementation Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Design doc:** `docs/plans/2026-03-14-veritas-engine-v2-design.md`
**Stack:** Next.js 14+ / TypeScript / Supabase / onnxruntime-web / MediaPipe

---

## Architecture Overview

```
Browser (real-time, private)                Server (async, deep)
────────────────────────────                ────────────────────
L1: rPPG-Granger causality (NEW)  ──────►  L4: EfficientNet pixel forensics
L2: FACS biomechanical rules (NEW)          /api/deepfake-analyze
L3: 3-stream blendshape CNN v2              /api/audit-chain
L5: Keystroke biometrics (existing)
              │
              ▼
veritasEnsemble.ts → Bayesian P(fake)
auditChain.ts → SHA-256 block chain
```

---

## Phase 1 — Foundation (browser modules, no ML training needed)

### Task 1.1 — DB migration: dc_deepfake_audit table
**File:** `docker/init.sql` + Supabase migration
```sql
CREATE TABLE IF NOT EXISTS dc_deepfake_audit (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID REFERENCES dc_assessments(id) ON DELETE CASCADE,
    block_index   INTEGER NOT NULL,
    block_hash    TEXT NOT NULL,
    prev_hash     TEXT NOT NULL DEFAULT '0000000000000000',
    timestamp     BIGINT NOT NULL,
    layer         TEXT NOT NULL,  -- 'rppg'|'facs'|'cnn_v2'|'efficientnet'|'keystroke'|'ensemble'
    payload       JSONB NOT NULL,
    chain_valid   BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_audit_assessment ON dc_deepfake_audit (assessment_id, block_index);
GRANT SELECT, INSERT ON dc_deepfake_audit TO deepcheck_anon;
```

### Task 1.2 — `src/lib/auditChain.ts`
SHA-256 tamper-evident block chain for forensic evidence.

```typescript
// Interface
export interface AuditBlock {
  index: number
  timestamp: number
  layer: 'rppg' | 'facs' | 'cnn_v2' | 'efficientnet' | 'keystroke' | 'ensemble'
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

export class AuditChain {
  private blocks: AuditBlock[] = []

  addBlock(layer: AuditBlock['layer'], payload: Record<string, unknown>): AuditBlock
  verify(): { valid: boolean; tamperIndex?: number }
  export(): AuditBlock[]
  getChainHash(): string  // HMAC-like summary
}

async function sha256(data: string): Promise<string>  // Web Crypto API
```

- Use `crypto.subtle.digest('SHA-256', ...)` (works browser + Node)
- Each block hashes: `${index}|${timestamp}|${layer}|${JSON.stringify(payload)}|${prevHash}`
- `verify()` recomputes every hash and compares; returns first tamper index
- Export for saving to `dc_deepfake_audit` table

### Task 1.3 — `src/lib/facsConstraints.ts`
FACS Ekman biomechanical rule engine (L2).

**6 biomechanical rules** (all use MediaPipe blendshape indices):

```typescript
export interface FACSResult {
  score: number          // 0=real, 100=fake
  violations: FACSViolation[]
  duchenne: boolean      // AU6+AU12 detected (genuine smile)
  bilateralSync: number  // symmetry score 0-1
}

// Rule 1: Duchenne test — genuine smiles need AU6 (cheek raise) + AU12 (lip corner)
// Rule 2: Bilateral sync — left/right AU amplitudes must be within 15% for natural expressions
// Rule 3: Co-contraction impossibility — AU1+AU4 (inner brow raise + brow lower) cannot max simultaneously
// Rule 4: Blink trajectory — typical blink: 150-400ms, asymptotic shape
// Rule 5: Expression coherence — AU combos must be physically possible (surprise≠disgust overlap)
// Rule 6: Temporal smoothing — expression changes must follow biomechanical velocity limits

export class FACSConstraintEngine {
  // Sliding window of 30 frames
  private window: number[][]  // [frame][blendshape]

  pushFrame(blendshapes: number[]): void
  evaluate(): FACSResult
  reset(): void
}

// MediaPipe blendshape → AU mapping (52 blendshapes → 44 AUs)
const BLENDSHAPE_TO_AU: Record<string, number[]>
```

Key MediaPipe blendshape indices to use:
- browInnerUp (0) → AU1
- browDownLeft/Right (1,2) → AU4
- cheekSquintLeft/Right (5,6) → AU6
- mouthSmileLeft/Right (44,45) → AU12
- eyeBlinkLeft/Right (9,10) → AU46
- jawOpen (17) → AU27

### Task 1.4 — `src/lib/rppgCoupling.ts`
rPPG-Motion Granger Causality — L1, novel algorithm.

**Algorithm steps:**
1. Extract rPPG signal from skin pixels (approximated from MediaPipe face mesh normals / facial color proxy)
2. Extract micro-vibration signal from facial landmark coordinates (nose tip Z, chin Y)
3. Compute Granger causality: does rPPG Granger-cause landmark vibrations?
4. Real humans: clear coupling (heartbeat → micro-head-movement). Deepfakes: no coupling.

```typescript
export interface RPPGResult {
  couplingStrength: number   // 0-1 (higher = more real)
  heartRateEstimate: number  // BPM from rPPG
  motionFrequency: number    // Dominant frequency in landmark motion (Hz)
  grangerPValue: number      // p-value: < 0.05 = significant coupling
  isSuspicious: boolean      // true if no coupling detected
}

export class RPPGCouplingDetector {
  private rppgBuffer: number[]     // 150 samples (~5s at 30fps)
  private motionBuffer: number[]   // parallel motion signal

  pushSample(
    skinLuminance: number,    // average R-G from face region (proxy rPPG)
    landmarkMotion: number    // nose_z delta + chin_y delta magnitude
  ): void

  evaluate(): RPPGResult | null  // null if insufficient data (<150 samples)
  reset(): void
}

// Granger causality test (simplified, browser-safe):
// 1. Fit AR(p) model on motion alone: motion(t) = a1*motion(t-1) + ... + ε1
// 2. Fit AR(p)+rPPG: motion(t) = a1*motion(t-1) + b1*rppg(t-1) + ... + ε2
// 3. F-test: F = ((RSS1-RSS2)/p) / (RSS2/(n-2p-1))
// 4. F > 3.84 (p<0.05 critical value) → rPPG Granger-causes motion
function grangerTest(cause: number[], effect: number[], lag: number): { fStat: number; pValue: number }

// Skin luminance extraction from MediaPipe face mesh landmarks
// Use forehead region: landmarks 10, 338, 297, 332, 284 → average green channel proxy
export function extractSkinLuminance(landmarkData: Float32Array): number
```

### Task 1.5 — `src/lib/veritasEnsemble.ts`
Bayesian ensemble + XAI explainability.

```typescript
export interface LayerScore {
  layer: 'rppg' | 'facs' | 'cnn_v1' | 'cnn_v2' | 'efficientnet' | 'keystroke'
  score: number      // 0=real, 100=fake
  confidence: number // 0-1
  available: boolean // false if layer didn't run
}

export interface EnsembleResult {
  pFake: number           // 0-1 posterior probability
  verdict: 'real' | 'suspicious' | 'fake'
  confidence: 'high' | 'medium' | 'low'
  contributingLayers: LayerContribution[]
  xaiExplanation: string  // human-readable
  auditPayload: Record<string, unknown>
}

export interface LayerContribution {
  layer: string
  weight: number
  contribution: number  // signed contribution to logit
  explanation: string   // "rPPG coupling absent (p=0.12)"
}

// Weights (v1, calibrated on synthetic data, updated when real data available)
const LAYER_WEIGHTS = {
  rppg:       0.25,
  facs:       0.20,
  cnn_v1:     0.15,  // existing deepfake_detector.onnx
  cnn_v2:     0.00,  // activated once v2 model trained
  efficientnet: 0.25, // server-side
  keystroke:  0.15,
}

// Bayesian logit ensemble:
// logit(P_fake) = Σ wᵢ * logit(scoreᵢ/100) + bias
// P_fake = sigmoid(logit_sum)
export function computeEnsemble(layers: LayerScore[]): EnsembleResult

// Generate XAI explanation
function generateExplanation(contributions: LayerContribution[]): string
```

---

## Phase 2 — Integration

### Task 2.1 — Update `src/components/VerificationCamera.tsx`
Add L1 (rPPG) and L2 (FACS) to the detection loop.

**Imports to add:**
```typescript
import { RPPGCouplingDetector, RPPGResult, extractSkinLuminance } from '@/lib/rppgCoupling'
import { FACSConstraintEngine, FACSResult } from '@/lib/facsConstraints'
import { computeEnsemble, LayerScore, EnsembleResult } from '@/lib/veritasEnsemble'
import { AuditChain } from '@/lib/auditChain'
```

**New refs:**
```typescript
const rppgDetectorRef = useRef<RPPGCouplingDetector>(new RPPGCouplingDetector())
const facsEngineRef   = useRef<FACSConstraintEngine>(new FACSConstraintEngine())
const auditChainRef   = useRef<AuditChain>(new AuditChain())
```

**New state:**
```typescript
const [rppgDisplay, setRppgDisplay] = useState<{ bpm: number; coupling: number } | null>(null)
const [facsDisplay, setFacsDisplay] = useState<{ score: number; violations: string[] } | null>(null)
const [ensembleDisplay, setEnsembleDisplay] = useState<EnsembleResult | null>(null)
```

**In detection loop:**
- Every frame: push to rPPG + FACS detectors
- Every 30 frames: evaluate FACS → update display + fire `facs_violation` event if score > 60
- Every 150 frames (~5s): evaluate rPPG → fire `rppg_decoupling` event if isSuspicious
- Every 90 frames: run ensemble with all available layer scores
- On deepfake_cnn_alert: add block to auditChain

**New AntiCheatEvent types:**
```typescript
| 'facs_violation'    // FACS biomechanical rule broken
| 'rppg_decoupling'  // rPPG-motion coupling absent
| 'veritas_alert'    // Ensemble pFake > 0.7
```

**UI overlay additions:**
- rPPG: `❤ XXbpm · coupling XX%` (green/yellow/red)
- FACS: `FACS OK` or `FACS: AU6 asymmetry` (violation name)
- Ensemble: `Veritas XX%` confidence badge

### Task 2.2 — Update `src/app/interview/page.tsx`
Handle new event types and show XAI:

```typescript
case 'facs_violation':
  trustScore = Math.max(0, trustScore - 15)
  alerts.push({ type: 'medium', message: `Biomechanical anomaly: ${event.detail}` })
  break

case 'rppg_decoupling':
  trustScore = Math.max(0, trustScore - 20)
  alerts.push({ type: 'high', message: 'Physiological signal decoupled from motion — possible deepfake' })
  setLiveMetrics(prev => ({ ...prev, aiRisk: Math.min(100, prev.aiRisk + 20) }))
  break

case 'veritas_alert':
  trustScore = Math.max(0, trustScore - 30)
  alerts.push({ type: 'critical', message: `Veritas Engine: ${event.explanation}` })
  setLiveMetrics(prev => ({ ...prev, aiRisk: Math.min(100, prev.aiRisk + 30) }))
  break
```

### Task 2.3 — `src/app/api/audit-chain/route.ts`
```typescript
// POST /api/audit-chain
// Body: { assessmentId: string, blocks: AuditBlock[] }
// 1. Verify chain integrity (recompute hashes)
// 2. Save blocks to dc_deepfake_audit
// 3. Return { valid, savedCount, chainHash }

// GET /api/audit-chain?assessmentId=xxx
// Return all blocks for given assessment, ordered by block_index
```

### Task 2.4 — `src/app/api/deepfake-analyze/route.ts`
Server-side pixel forensics endpoint (L4 placeholder until EfficientNet trained):

```typescript
// POST /api/deepfake-analyze
// Body: { frameBase64: string }
// For now: returns heuristic pixel analysis (DCT frequency, compression artifacts)
// Later: full EfficientNet-Lite0 inference
// Returns: { score: number, method: string, features: object }
```

---

## Phase 3 — Training Scripts

### Task 3.1 — `infra/train_deepfake_v2.py`
3-stream CNN (temporal Conv1D + BiGRU + Attention | covariance matrix | FFT frequency).

**Architecture:**
```python
class DeepfakeV2(nn.Module):
    # Stream 1: Temporal
    # Input: (B, 90, 59) — 90 frames × 59 features
    # Conv1d(59→128, k=7) → BiGRU(128, 64) → MultiheadAttention → pool

    # Stream 2: Covariance
    # Input: (B, 90, 52) — 52 blendshapes only
    # Compute 52×52 correlation matrix → flatten → Linear(2704→256) → Linear(256→64)

    # Stream 3: Frequency
    # Input: (B, 90, 59) → FFT per feature → magnitude → (B, 46, 59) → Conv2d → pool → 64

    # Late fusion: concat(64+64+64) → Linear(192→64) → Linear(64→3)
```

**Dataset:** FaceForensics++ c23 + DFDC Preview + CelebDF-v2 + VoxCeleb2 (real)
**Output:** `deepfake_v2.onnx` (~2MB), `deepfake_v2_metadata.json`

### Task 3.2 — `infra/train_efficientnet_pixel.py`
EfficientNet-Lite0 pixel forensics (server-side, L4).

**Architecture:**
- EfficientNet-B0 backbone (torchvision, pretrained ImageNet) fine-tuned for deepfake frames
- Input: 224×224 RGB face crop
- Heads: class (real/fake) + DCT frequency branch + LBP texture branch
- Export: ONNX fp16, ~4MB

### Task 3.3 — `infra/extract_features_mp.py`
MediaPipe batch feature extraction from video files.

```python
# Input: directory of .mp4 files (real/fake labeled by folder structure)
# Output: .npz per video with shape (num_frames, 59)
# Uses MediaPipe FaceLandmarker with LIVE_STREAM mode
# Parallel: ProcessPoolExecutor(max_workers=8)
```

### Task 3.4 — Dataset download helpers

**`infra/download_ff.py`** — FaceForensics++ setup guide + download script
```python
# FaceForensics++ requires academic email approval
# Script: guides user through request form + downloads via faceforensics2 CLI
# python download.py -d all -c c23 -t videos ./data/ff/
```

**`infra/download_voxceleb.py`** — VoxCeleb2 free subset
```python
# No email needed, free download
# Download: vox2_test_aac.zip (~5GB test set, enough for real faces)
# Extract: ./data/voxceleb/
```

**`infra/calibrate_ensemble.py`** — Calibrate ensemble weights on validation set
```python
# Load saved layer scores + ground truth labels
# Optimize weights using scipy.optimize.minimize (cross-entropy loss)
# Output: ensemble_weights.json
```

---

## Phase 4 — Self-Hosted Docker Enhancement

### Task 4.1 — Update `docker-compose.yml`
Add ML worker service for server-side inference:
```yaml
ml-worker:
  build: ./docker/ml-worker
  volumes:
    - ./models:/app/models
  environment:
    - EFFICIENTNET_MODEL=/app/models/efficientnet_pixel.onnx
  ports:
    - "8001:8001"
```

### Task 4.2 — Update `docker/init.sql`
Add `dc_deepfake_audit` table (same SQL as Task 1.1).

### Task 4.3 — `docker/ml-worker/` FastAPI service
```python
# FastAPI app serving:
# POST /analyze-frame → EfficientNet inference
# GET /health → returns model status
```

---

## Phase 5 — Deploy & Validate

### Task 5.1 — `npm run build`
Fix any TypeScript errors. The new `rppgCoupling.ts` + `facsConstraints.ts` modules are
client-only — ensure they have `'use client'` guards or are never imported server-side.

### Task 5.2 — Deploy to Vercel
```bash
git add -A
git commit -m "feat(veritas-v2): L1 rPPG+L2 FACS+ensemble+audit chain — browser inference complete"
git push origin main
# Vercel deploys automatically from main
```

### Task 5.3 — Smoke test
1. Open https://deep-check-two.vercel.app/interview
2. Verify rPPG, FACS, CNN overlays appear in camera UI
3. Verify trust score decrements on suspicious events
4. POST to /api/audit-chain and verify response
5. POST to /api/deepfake-analyze and verify response

---

## Execution Order

```
1.1 DB migration → 1.2 auditChain.ts → 1.3 facsConstraints.ts
→ 1.4 rppgCoupling.ts → 1.5 veritasEnsemble.ts
→ 2.1 VerificationCamera.tsx → 2.2 interview/page.tsx
→ 2.3 audit-chain route → 2.4 deepfake-analyze route
→ 3.1 train_deepfake_v2.py → 3.2 train_efficientnet.py
→ 3.3 extract_features.py → 3.4 download helpers
→ 4.1 docker-compose → 4.2 docker init.sql → 4.3 ml-worker
→ 5.1 build → 5.2 deploy → 5.3 smoke test
```

---

## Acceptance Criteria

- [ ] FACS violations detected live in browser (≥30fps maintained)
- [ ] rPPG coupling score displayed in camera overlay
- [ ] Ensemble pFake correctly combines all available layers
- [ ] Audit chain verifiable via /api/audit-chain
- [ ] Build passes (`npm run build`)
- [ ] Deployed to Vercel without errors
- [ ] Training scripts runnable on EC2 g4dn.xlarge
