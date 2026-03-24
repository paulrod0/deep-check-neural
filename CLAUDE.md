# Deep-Check — Project Context

## What is Deep-Check
AI-powered identity verification platform. Privacy-first: all biometric processing runs client-side in the browser via ONNX Runtime WebAssembly. Zero biometric data sent to servers.

**Live:** https://deep-check-two.vercel.app
**Repo:** https://github.com/paulrod0/deep-check (private, BSL license)
**Owner:** Pablo Lopez Rodriguez, HIUM Solutions SL, Andalucia, Spain

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
- **ML Training:** PyTorch + timm on AWS EC2 (T4/A10G GPUs)

## Models

### Deepfake Pixel Model (primary)
- **V3 (deployed):** EfficientNet-B4 + FrequencyBranchV2 (multi-scale Laplacian)
  - 18.6M params, 70MB ONNX
  - AUC 0.9999, EER 0.31% (7 Kaggle datasets, 155K images)
  - Anti-leak verified (train ∩ test = 0)
  - File: `public/models/deepfake/deepfake_pixel_v1.onnx`
  - S3: `s3://deep-check-models/deepfake/deepfake_pixel_v3.onnx`

- **V4 (training):** ConvNeXt-Base + FrequencyBranchV2
  - ~89M params, 13 Kaggle datasets (~500K images)
  - Includes: StyleGAN2, PhotoShop, ProGAN, CycleGAN, StarGAN, DFDC, AI faces, Stable Diffusion, ArtiFact (13 generators), anti-spoofing
  - 200 epochs with adversarial augmentation
  - Training script: `ml/train_deepfake_v3.py` (modified for v4 on EC2)

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
| `ml/benchmark_industrial.py` | Industrial benchmark (ISO 30107-3) |
| `ml/benchmark_deepfake_v3.py` | Basic benchmark |
| `infra/train_pixel_ec2.py` | Original V1 EC2 training |

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
src/app/pricing/page.tsx      — Pricing page with Paddle checkout
next.config.ts                — CSP headers, security config
public/models/deepfake/       — ONNX models served to browser
nist-fate-pad/                — NIST C++ SDKs
ml/                           — Training and benchmark scripts
```
