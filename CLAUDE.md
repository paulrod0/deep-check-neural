# Deep-Check — Project Context

## What is Deep-Check
AI-powered identity verification platform. Privacy-first: all biometric processing runs client-side in the browser via ONNX Runtime WebAssembly. Zero biometric data sent to servers.

**Live:** https://deep-check-two.vercel.app
**Repo:** https://github.com/paulrod0/deep-check (private, BSL license)
**Owner:** Pablo Lopez Rodriguez, Madrid, Spain

## Architecture

### 6-Layer Veritas Ensemble Engine
Bayesian logit-space fusion of 6 independent detection layers:
| Layer | Weight | File |
|-------|--------|------|
| rPPG (blood flow) | 0.30 | `src/lib/veritasEnsemble.ts` |
| FACS (micro-expressions) | 0.26 | `src/lib/veritasEnsemble.ts` |
| EfficientNet-B4 pixel | 0.22 | `src/lib/neuralForensics.ts` |
| CNN v2 blendshape | 0.10 | `src/lib/deepfakeInference.ts` |
| Keystroke biometrics | 0.12 | `src/lib/keystrokeBiometrics.ts` |

### Key Tech Stack
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS
- **AI Models:** ONNX Runtime Web (WASM) for browser inference
- **Face Detection:** MediaPipe FaceLandmarker (CDN: jsdelivr + googleapis)
- **Backend:** Supabase (auth + DB), Vercel (hosting)
- **Payments:** Paddle (Overlay Checkout)
- **ML Training:** PyTorch + timm on AWS EC2 (A10G GPUs)
- **Foundation Models:** DINOv2, DINOv3 (via timm + HuggingFace)
- **Database:** Neon (PostgreSQL serverless) + Supabase (auth)
- **i18n:** EN/ES with language selector (src/lib/i18n.tsx)

## Models

### Deepfake Pixel Model (primary)
- **V3 (deployed):** EfficientNet-B4 + FrequencyBranchV2 (multi-scale Laplacian)
  - 18.6M params, 70MB ONNX
  - AUC 0.9999, EER 0.31% (7 Kaggle datasets, 155K images)
  - Anti-leak verified (train ∩ test = 0)
  - File: `public/models/deepfake/deepfake_pixel_v1.onnx`
  - S3: `s3://deep-check-models/deepfake/deepfake_pixel_v3.onnx`

- **V7 (stopped):** DINOv2 ViT-L/14 + FrequencyBranch
  - 304M params, 315K images (cross-source validation)
  - Best AUC 0.988, EER 2.18% (cross-source: LFW + UTKFace + val-fakes)
  - S3: `s3://deep-check-models/deepfake/v5/best_v5_clip.pt`

- **V8 (legacy API):** DINOv3 ViT-L/16 + Linear Head
  - 303M params, 315K images (legacy fakes only: StyleGAN, FaceSwap)
  - AUC 0.991, EER 2.51% cross-source (legacy generators)
  - **Problem:** misclassifies modern AI images (SDXL, MidJourney, Flux) as real
  - S3: `s3://deep-check-models/deepfake/v8/best_v8.pt`

- **V9.4 (current best deepfake):** DINOv3 ViT-L/16 + Linear Head
  - 303M params, 900K+ images (legacy + 207K modern fakes)
  - Modern fakes: SFHQ-T2I (Flux+SDXL+DALL-E 3), DeepDetect-2025, FFGenAI, OpenFake
  - **AUC 0.945, EER 13.0%** cross-source against modern generators
  - V9.5 multi-GPU training on g5.12xlarge (4x A10G) in progress
  - S3: `s3://deep-check-models/deepfake/v9/best_v9_simple.pt`

- **Doc Forensics V2b (DONE):** DINOv2 ViT-L/14 + ELA (6-channel)
  - 304M params, 171K images (CASIA + forensics-rf), warm restart with fresh LR
  - **AUC 0.998, EER 1.87%** — production ready
  - S3: `s3://deep-check-models/doc_forensics/v2b/best_doc_restart.pt`

- **Keystroke Biometrics (DONE):** Transformer Encoder (4L, 8H, 256D)
  - 3.3M params, 251 users (Aalto 136M + CMU + IKDD), 4190 sequences
  - Dual output: 128D user embedding + bot detection score
  - **Bot AUC 0.949, accuracy 90.8%**
  - S3: `s3://deep-check-models/keystroke/best_keystroke.pt`

### ONNX Contract (DO NOT CHANGE)
```
Input:  "face_image" [batch, 3, 224, 224] float32 (ImageNet normalized)
Output: "logit" [batch] float32 (sigmoid -> P(fake))
Opset:  17
```
Browser consumer: `src/lib/neuralForensics.ts` and `src/lib/veritasEnsemble.ts`

## AWS Resources

### S3
- Bucket: `deep-check-models` (eu-west-1)
- Models: `s3://deep-check-models/deepfake/`
- IAM Profile: `deep-check-ec2-training`

### EC2 SSH Keys
- `deep-check-v4-key` — for V4 training instances
- PEM stored at `/tmp/deep-check-v4-key.pem` (regenerate if lost)
- Key pair `deep-check-train-v2` — PEM lost, cannot use

### Kaggle Credentials
- Username: `kgat_7f852c46aaa9faaea565d0ccdf1c426c`
- Config: `~/.config/kaggle/kaggle.json`

## Vercel

### Environment Variables (set in Vercel dashboard)
- `PADDLE_API_KEY` — Paddle live API key
- `PADDLE_WEBHOOK_SECRET` — Paddle notification webhook secret
- `PADDLE_CLIENT_TOKEN` — Paddle client-side token
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` — Same, for client
- `NEXT_PUBLIC_PADDLE_PRICE_STARTER` — `pri_01kmd3y9b6bd4kg8k0a91mz7dn`
- `NEXT_PUBLIC_PADDLE_PRICE_PRO` — `pri_01kmd40b8wjxzf79angzbv9ywa`
- `NEXT_PUBLIC_PADDLE_ENV` — `production`

### Deployment
- Production: `https://deep-check-two.vercel.app`
- Deploy: `npx vercel --prod --yes` or push to GitHub (auto-deploy)
- `.vercelignore`: excludes `packages/` and large files

## CSP (Content Security Policy)
Configured in `next.config.ts`. MediaPipe needs:
- `script-src`: `https://cdn.jsdelivr.net` + `wasm-unsafe-eval`
- `connect-src`: `https://cdn.jsdelivr.net` + `https://storage.googleapis.com`

## NIST Submission
- PAD SDK: `nist-fate-pad/deep-check-sdk/src/deep_check_pad.cpp`
- FRTE 1:1 SDK: `nist-fate-pad/deep-check-sdk/src/deep_check_frte11.cpp`
- Headers: `nist-fate-pad/deep-check-sdk/include/`
- KPI Report: `nist-fate-pad/FORMAL_KPI_REPORT.md`
- Build: `cd nist-fate-pad/deep-check-sdk && make`

## Publications
- **Zenodo:** Paper published with DOI (CC BY-NC-ND 4.0)
- **Papers With Code:** Pending submission (need DOI first)
- **TechRxiv:** Pending submission

## Benchmark Results (V3, real inference)
```
AUC:    0.999998  [95% CI: 0.999991 — 1.000000]
EER:    0.10%     [95% CI: 0.00% — 0.30%]
APCER:  0.10%
BPCER:  0.10%
ECE:    0.005 (excellent calibration)

Robustness:
  Original:    AUC 1.0000, EER 0.00%
  JPEG Q10:    AUC 0.9986, EER 2.20%
  Blur r=5:    AUC 0.9853, EER 6.90%
  Grayscale:   AUC 0.9801, EER 7.20%
  Resize 25%:  AUC 0.9995, EER 0.10%
```
Benchmark script: `ml/benchmark_industrial.py`
Reports: `ml/reports/industrial_benchmark.json` and `.md`

## MCP Server
- Package: `packages/mcp-server/`
- 9 tools: verify_document, batch_verify, list_sessions, etc.
- Transport: stdio (JSON-RPC 2.0)
- Config: `DEEP_CHECK_API_KEY` + `DEEP_CHECK_BASE_URL`

## Training Scripts
| Script | Purpose |
|--------|---------|
| `ml/train_deepfake_v3.py` | V3 training (7 datasets, EfficientNet-B4) |
| `ml/train_v9_simple.py` | **V9.4 DINOv3 + Linear (207K modern fakes)** |
| `ml/train_v9_warm.py` | V9.4 warm restart from checkpoint |
| `ml/train_v9_staged.py` | V9.2 staged (P1 Linear -> P2 Gated) |
| `ml/train_v9_freq.py` | V9.1 with FrequencyBranch + SRM |
| `ml/train_v9_modern.py` | V9 baseline with modern data |
| `ml/train_doc_v2.py` | Doc Forensics V2 (FreqBranch + SRM) |
| `ml/train_keystroke.py` | **Keystroke biometrics (Transformer)** |
| `ml/benchmark_industrial.py` | Industrial benchmark (ISO 30107-3) |

## EC2 Instances
| Instance | Type | IP | GPU | Purpose |
|----------|------|-----|-----|---------|
| i-07189a89d5f7f254a | g5.12xlarge | 108.130.98.126 | **4x A10G (96GB)** | V9.5 multi-GPU training |
| i-0105e7979c9ad73a0 | g5.xlarge | 54.229.204.211 | 1x A10G | Keystroke (done) / available |
| i-027f26e44cea55363 | g5.xlarge | 3.253.40.29 | 1x A10G | Stopped (V9 migrated to g5.12xlarge) |

## AWS GPU Quota
- G instances: **64 vCPU** (approved April 2026)
- P instances: 8 vCPU
- Best available: g5.12xlarge (4x A10G, 48 vCPU)

## Docker On-Premise Deployment
```bash
docker compose up -d   # Full stack: DB + API + ML Worker + Model Updater + Nginx
```

### Services
| Service | Image | Purpose |
|---------|-------|---------|
| `db` | postgres:16 | PostgreSQL with pgcrypto |
| `rest` | postgrest/postgrest | Supabase-compatible REST |
| `app` | deep-check (Next.js) | Frontend + API routes |
| `ml-worker` | deep-check-ml (FastAPI) | **All ML engines (GPU/CPU)** |
| `model-updater` | Python cron | Auto-sync models from S3 every 6h |
| `nginx` | nginx:1.25 | Reverse proxy + TLS |

### ML Worker Engines
| Engine | Model | GPU | CPU Fallback |
|--------|-------|-----|-------------|
| Deepfake | V9 DINOv3 (303M) | Yes | V3 ONNX EfficientNet |
| Doc Forensics | DINOv2 + ELA (304M) | Yes | ELA heuristic |
| Keystroke | Transformer (3.3M) | Optional | CPU fine |

### ML Worker Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | All engine status |
| `/detect/deepfake` | POST | Deepfake detection |
| `/detect/document` | POST | Document forensics |
| `/verify/keystroke` | POST | Keystroke verification + bot |
| `/enroll/keystroke` | POST | Enroll user typing pattern |
| `/models/status` | GET | Model versions + metrics |
| `/models/reload` | POST | Hot-reload from disk |
| `/models/update` | POST | Check S3 + download + reload |

### Model Auto-Update
Models auto-update from S3 via manifests:
```
s3://deep-check-models/approved/{engine}/manifest.json
{"version": "v9.5", "file": "best_v9.pt", "auc": 0.96, "eer": 0.05}
```
model-updater checks every 6h, downloads newer versions, notifies ml-worker to hot-reload.

## API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/detect` | POST | V3 deepfake detection (ONNX server-side) |
| `/api/v1/detect-v8` | POST/GET | V8 DINOv3 detection (proxy to EC2) |
| `/api/v1/verify` | POST | Document verification (MRZ + forensics) |
| `/api/v1/batch` | POST/GET | Async batch verification |
| `/api/v1/sessions` | GET/POST | Assessment session management |
| `/api/v1/keys` | GET/POST | API key management (admin) |
| `/api/waitlist` | POST | Enterprise waitlist signup |
| `/api/training/metrics` | GET | Training dashboard data (S3) |

## Products (Consumer)
| Product | Route | Description |
|---------|-------|-------------|
| Am I Real? | `/amireal` | Live webcam deepfake detection (V3 + V8 selector) |
| DateSafe | `/datesafe` | Catfish detector for dating apps |
| ProofShot | `/proofshot` | Photo authenticity certificate |
| DocSafe | `/docsafe` | Document manipulation detection |
| ListingCheck | `/listingcheck` | Listing photo verification |
| ResumeGuard | `/resumeguard` | Resume photo batch verification |
| TrustMyProfile | `/trustmyprofile` | Profile verification badge |
| FakeCheck | `extensions/fakecheck/` | Chrome Extension |

## SEO & Analytics
- Google Search Console verified (meta tag in layout.tsx)
- Sitemap at `/sitemap.xml` (14 routes)
- robots.txt configured
- JSON-LD structured data (Organization, SoftwareApplication, WebSite)
- Page-specific metadata via layout.tsx files per route

## Key Decisions Made
1. **BSL License** — protects IP while allowing code visibility
2. **Browser-side inference** — privacy-by-design, GDPR native
3. **Paddle over Stripe** — better for EU SaaS, handles VAT
4. **CC BY-NC-ND for papers** — prevents commercial reuse of research
5. **Anti-leak verification** — 140K uses original splits, hash dedup, overlap check
6. **No account creation by AI** — security policy, user creates accounts themselves

## Pricing (Paddle)
| Plan | Price | Sessions | Price ID |
|------|-------|----------|----------|
| Free | 0 | 10/mo | — |
| Starter | 29/mo | 50/mo | pri_01kmd3y9b6bd4kg8k0a91mz7dn |
| Pro | 79/mo | Unlimited | pri_01kmd40b8wjxzf79angzbv9ywa |
| Enterprise | Custom | Custom | Contact sales |

## Important Files
```
src/lib/veritasEnsemble.ts    — 6-layer Bayesian ensemble
src/lib/neuralForensics.ts    — EfficientNet pixel model loader
src/lib/deepfakeInference.ts  — CNN blendshape model
src/lib/faceMatch.ts          — MediaPipe face verification
src/lib/keystrokeBiometrics.ts — Typing pattern analysis
src/lib/facePreprocess.ts     — Shared face preprocessing (detect + crop + normalize + calibrate)
src/lib/i18n.tsx              — Internationalization (EN/ES) with LanguageProvider
src/lib/db.ts                 — Supabase/Neon database client
src/app/pricing/page.tsx      — Pricing page with Paddle checkout
src/app/training/page.tsx     — Training dashboard (real-time metrics from S3)
src/app/amireal/page.tsx      — Am I Real? with V3/V8 model selector
src/app/api/v1/detect-v8/     — V8 DINOv3 API proxy to EC2
next.config.ts                — CSP headers, security config
public/models/deepfake/       — ONNX models served to browser
nist-fate-pad/                — NIST C++ SDKs
ml/                           — Training and benchmark scripts
docs/                         — Pitch decks, commercial decks (PDF generators)
```

## Security Hardening (branch `security-hardening-audit` → PR #1)
Multi-agent audit (38 confirmed findings) + fixes: cross-tenant IDOR, SSRF, auth gaps, fabricated forensic verdicts, hardcoded infra. **Do NOT deploy without the checklist below.**

### Deploy checklist (ORDER MATTERS)
1. Run migrations **`docker/migrations/008_org_scoping_backfill.sql`** and **`009_batch_jobs.sql`** BEFORE deploying — org scoping is fail-closed (rows with NULL `org_id` become invisible to their tenant) and batch needs the `dc_batch_jobs` table.
2. Set the env vars below. Proxies return 503 if unset (by design, fail-closed).
3. Use **HTTPS / private network** for `AWS_GEMMA_URL` and `V8_API_URL` (identity docs / biometrics transit there).
4. Runtime-verify: dashboard login no longer 401s; an org-A token cannot read org-B data; batch polling works.

### New / required env vars
- `ML_WORKER_API_KEY` — `X-API-Key` for the ML worker (`docker/ml-worker/main.py` enforces if set; unset = UNAUTHENTICATED, dev only). Set in docker-compose (ml-worker + app + model-updater) and Vercel.
- `ML_WORKER_CORS_ORIGINS` (default none), `ML_WORKER_RATE_LIMIT` (default 120/min), `MAX_UPLOAD_MB` (default 15).
- `XEON_ML_URL`, `AWS_GEMMA_URL`, `V8_API_URL` (+`V8_API_KEY`) — worker URLs, fail-closed (no hardcoded IPs in source; previous values documented in `.env.example`).

### Auth / IDOR model (follow for new code)
- **Session gate**: `getOrgFromSession(req)` (`src/lib/auth.ts`) validates the user JWT via a per-request client (`edgeFunctionToken`), then reads the org with the service client scoped to the validated userId. Gate dashboard/session endpoints: `const org = await getOrgFromSession(req); if (!org) return 401`.
- **Tenant scoping (fail-closed)**: `db.ts` `getAssessments(orgId)`, `getAssessmentById(id, orgId)`, `getProfileByEmail(email, orgId)`, `createApiKey(..., orgId)` REQUIRE `orgId` and return empty/null without it. API keys carry `orgId` (from `validateApiKey`). Scope queries with `.eq('org_id', org.id)`; populate `org_id` on inserts.
- **Intentionally UNSCOPED accessors** (cross-org on purpose — trusted/public paths only): `getAssessmentsUnscoped()`, `getAssessmentByIdUnscoped(id)` (public cert verify + admin dashboard), `getProfileByEmailUnscoped(email)` (ml-score). `getDefaultOrgId()` assigns new API keys to the primary org.

### Endpoint behavior changes
- `/api/v1/verify` + `/api/v1/batch` — real server-side doc forensics via ml-worker (`src/lib/docForensics.ts`); previously `riskScore=0`.
- `/api/v1/detect` — serves **V9.4 DINOv3** via ml-worker when `ML_WORKER_URL` set, else local V3 ONNX. Response adds `model`/`engine`.
- `/api/v1/batch` — DB-backed (`dc_batch_jobs`) + `after()`; works on serverless; GET polling scoped by org.
- `/api/video` — no longer fabricates a deepfake verdict from size/entropy (may return `deepfakeScore=null`).
- `ml-worker` (`docker/ml-worker/main.py`) — X-API-Key auth, CORS from env, per-IP rate limit, size limits, base64 hardening.
- SSRF guard (`src/lib/ssrfGuard.ts` `isUrlSafe`) on `osint/maltego·analyze·webhook`.

### New libs
- `src/lib/docForensics.ts` — `runDocForensics(base64) → p_tampered | null` (fail-safe worker call).
- `src/lib/ssrfGuard.ts` — `isUrlSafe(url)` + `SAFE_FETCH_OPTIONS`.

## Partnerships / Complementariedad LATAM (2026)
Two Colombian companies shared dossiers (full outreach copy: `docs/partnerships/neuronal-inteia-outreach.md`).
- **Inteia** (inteia.com.co) — data/analytics/software house with a strong LATAM enterprise base (Ecopetrol, ISA, ISAGEN, EPM, WOM, XM, public sector). 6 domains incl. video analytics (D33P) + satellite (Terradai). → potential **GTM channel** for Deep-Check in LATAM.
- **Neuronal Vision / Newzenda** (neuronalvision.com) — 20+ yr facial recognition + emotion AI. Face X: Face-LogIn, Face-Access, Face-Proctor, Face-Health (rPPG), Face-Sense (micro-expressions). Does 1:N recognition; **lacks anti-deepfake / PAD** = exactly Deep-Check's moat.

**Thesis**: a value stack, not three equals. Inteia = channel; Neuronal = customer-facing biometric product; Deep-Check = the integrity layer (anti-deepfake / PAD / liveness / doc forensics) that plugs INSIDE Neuronal's products, in front of the 1:N match. The rPPG/FACS overlap (↔ Face-Health/Sense) is reframed: Neuronal's mature rPPG FEEDS Deep-Check's liveness (complementarity, not competition).

**IP protection**: integrate serving ONLY the verdict (`P(fake)` + confidence) behind `X-API-Key` — never per-layer signals or weights (the ml-worker hardening enables this). First move: a **paid blind benchmark** (they send deepfakes + injection attempts, we return scores/AUC/EER). Do NOT claim NIST/iBeta "certified" — those are submitted/not obtained. Other strong fits from research: Mitek (Spain-remote deepfake role), iProov, Signaturit/Camerfirma (notarial QES).
