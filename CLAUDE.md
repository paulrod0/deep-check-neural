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

- **V8 (best, API deployed):** DINOv3 ViT-L/16 + Linear Head
  - 303M params, 315K images, cross-source validation
  - **Best AUC 0.991, EER 2.51%** — state of the art cross-source
  - API live at EC2 52.215.31.248:8080 (proxied via /api/v1/detect-v8)
  - S3: `s3://deep-check-models/deepfake/v8/best_v8.pt`

- **Doc Forensics (training):** DINOv2 ViT-L/14 + ELA branch
  - 304M params, 171K images (CASIA + forensics-rf 4 datasets)
  - Cross-source validation (Set 4 as val)
  - Training on EC2 54.229.204.211
  - 6-channel input: RGB + Error Level Analysis (ELA)

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
| `ml/train_v5_fixed.py` | V5-B4 cross-source training (811K images, anti-overfitting) |
| `ml/train_v5_b4v2.py` | V5-B4v2 with higher LR and warmup |
| `ml/train_v5_effnetv2.py` | V5 with EfficientNet-V2-S backbone |
| `ml/train_deepfake_v5.py` | V5 original training script |
| `ml/benchmark_industrial.py` | Industrial benchmark (ISO 30107-3) |
| `ml/benchmark_deepfake_v3.py` | Basic benchmark |

## EC2 Instances (Active)
| Instance | IP | GPU | Purpose |
|----------|-----|-----|---------|
| i-0105e7979c9ad73a0 | 54.229.204.211 | A10G | Doc Forensics training |
| i-027f26e44cea55363 | 52.215.31.248 | A10G | V8 API server |

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
