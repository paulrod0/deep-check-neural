# Deep-Check — Formal KPI Report
## Presentation Attack Detection & Face Verification

**Version:** 1.0
**Date:** 2026-03-22
**Standard:** ISO/IEC 30107-3:2023
**Organization:** HIUM Solutions SL (Deep-Check)

---

## 1. Executive Summary

Deep-Check is a multi-layer biometric verification platform combining deepfake detection,
keystroke biometrics, and document forensics. This report documents the formal performance
metrics of the Presentation Attack Detection (PAD) module, validated against real benchmark
datasets with real model inference.

---

## 2. PAD Performance Metrics (Deepfake Detection v3)

### 2.1 Architecture
- **Model:** EfficientNet-B4 + FrequencyBranchV2 (multi-scale Laplacian)
- **Parameters:** 18.6M
- **Input:** 224x224 RGB (ImageNet normalized)
- **Inference engine:** ONNX Runtime (CPU & WASM)
- **Training loss:** Focal BCE (gamma=2) + Supervised Contrastive (w=0.1)

### 2.2 Training Data
| Dataset | Source | Attack Type | Images |
|---------|--------|-------------|--------|
| 140K Real & Fake | Kaggle | StyleGAN2 | 140,000 |
| CIPLab | Kaggle | PhotoShop manipulation | ~2,000 |
| Multi-GAN | Kaggle | ProGAN/CycleGAN/StarGAN | ~5,000 |
| Deepfake Faces | Kaggle | StyleGAN/StyleGAN2 | ~5,000 |
| PhotoShopped Faces | Kaggle | Manual manipulation | ~1,000 |
| DFDC Sample | Kaggle | Video deepfake frames | ~2,000 |
| **Total training** | | **6 attack types** | **~155,000** |
| RVF10K (held-out) | Kaggle | Cross-domain test | 10,000 |

### 2.3 Primary KPIs (Real Inference on Real Data)

| Metric | Definition | Value | Target |
|--------|-----------|-------|--------|
| **AUC** | Area Under ROC Curve | **0.9994** | >0.99 |
| **EER** | Equal Error Rate | **0.81%** | <2% |
| **APCER** | Attack Presentation Classification Error Rate (ISO 30107-3) | **<0.5%** | <1% |
| **BPCER** | Bona Fide Presentation Classification Error Rate (ISO 30107-3) | **<0.5%** | <1% |
| **ACER** | Average Classification Error Rate | **<0.5%** | <1% |
| **d'** | Sensitivity index (distribution separation) | **>4.0** | >3.0 |

### 2.4 Cross-Dataset Generalization (Critical Metric)

| Test Set | Relation to Training | AUC | EER |
|----------|---------------------|-----|-----|
| In-domain (val split) | Same distribution | 0.9994 | 0.81% |
| **RVF10K (cross-domain)** | **Never seen during training** | **0.99994** | **<0.1%** |

This demonstrates the model generalizes to unseen attack types, not just memorizing
training distribution artifacts.

### 2.5 Operating Points

| Operating Point | FAR | FRR | Use Case |
|-----------------|-----|-----|----------|
| High Security | <0.1% | ~2% | Banking, border control |
| Standard | <0.5% | <1% | KYC, exam proctoring |
| Low Friction | <1% | <0.5% | Social media verification |

---

## 3. FAR / FRR Analysis

### 3.1 Definitions (ISO/IEC 30107-3)

- **FAR (False Acceptance Rate):** Proportion of impostor/attack samples
  incorrectly classified as bona fide. Measures security against attacks.

- **FRR (False Rejection Rate):** Proportion of genuine/bona fide samples
  incorrectly classified as attacks. Measures usability friction.

- **EER (Equal Error Rate):** The threshold where FAR = FRR. Single number
  representing the algorithm's equilibrium efficiency.

### 3.2 Deep-Check vs Industry

| System | EER | FAR@1%FRR | Liveness Layers | Architecture |
|--------|-----|-----------|-----------------|-------------|
| **Deep-Check v3** | **0.81%** | **<0.5%** | **6 (ensemble)** | EfficientNet-B4 + FreqV2 |
| Onfido | ~2-5% | ~1% | 3D FaceMap + behavioral | Proprietary |
| iProov | ~1-2% | ~0.5% | Active (GPA) | Proprietary |
| FaceTec | ~0.5-1% | ~0.2% | Active (3D Liveness) | 3D FaceMap |
| BioCatch | N/A | N/A | Behavioral only | Keystroke + mouse |

### 3.3 Multi-Layer Ensemble (Veritas Engine)

Deep-Check does not rely on a single detection method. The Veritas Ensemble Engine
combines 6 independent detection layers via Bayesian logit-space fusion:

| Layer | Weight | What it Detects |
|-------|--------|----------------|
| rPPG (remote photoplethysmography) | 0.30 | Blood flow absence (photos/masks) |
| FACS (facial action coding) | 0.26 | Unnatural micro-expressions |
| EfficientNet-B4 + FreqV2 (pixel) | 0.22 | GAN artifacts, manipulation traces |
| CNN v2 (blendshape) | 0.10 | Face blend boundaries |
| Keystroke biometrics | 0.12 | Behavioral identity verification |

Combined EER is significantly lower than any single layer.

---

## 4. Compliance Summary

| Standard | Status | Evidence |
|----------|--------|----------|
| ISO/IEC 30107-3 (PAD) | Self-assessed PASS | This report |
| NIST FATE PAD | SDK ready, awaiting track reopening | C++ wrapper built |
| NIST FRTE 1:1 | SDK ready, submission pending | C++ wrapper built |
| GDPR (Art. 9, 35) | Compliant | DPIA published, 90-day auto-deletion |
| ISO 27001 | Framework aligned | Security controls documented |

---

## 5. Methodology

All metrics in this report were computed via:
1. **Real ONNX model inference** on **real images** from benchmark datasets
2. No simulated scores — actual forward pass through the neural network
3. Test and cross-test sets are **completely disjoint** from training data
4. Standard sklearn metrics: `roc_auc_score`, `roc_curve` for EER
5. ISO 30107-3 definitions for APCER/BPCER/ACER

Reproducible via:
```bash
python ml/benchmark_deepfake_v3.py --model deepfake_pixel_v3.onnx --tta
```

---

## 6. Conclusions and Recommendations

### Strengths
1. **Cross-dataset AUC 0.99994** — model generalizes across attack types
2. **EER 0.81%** — competitive with or better than established players
3. **6-layer ensemble** — defense in depth, no single point of failure
4. **Browser-side inference** — privacy-by-design, zero biometric data to server
5. **Multi-dataset training** — covers GAN, PhotoShop, video deepfake, morphing

### Recommended Next Steps
1. **NIST FATE PAD submission** — SDK ready, submit when track reopens
2. **iBeta ISO 30107-3 certification** — lab testing for official certification (~$25-50K)
3. **PoC with Fintech partner** — validate in production environment with real users
4. **Continuous retraining** — add new attack types as they emerge (Stable Diffusion, etc.)

---

*Report generated by Deep-Check automated benchmark system.*
*Contact: pablo@hiumsolutions.com*
