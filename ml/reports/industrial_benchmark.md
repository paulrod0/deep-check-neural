# Deep-Check Industrial PAD Benchmark
**Standard:** ISO/IEC 30107-3:2023 + NIST FATE PAD methodology
**Date:** 2026-03-24T09:55:23
**Model:** deepfake_pixel_v3
**Inference:** Real ONNX model on real images

---

## 1. Per-Dataset Results

| Dataset | N | AUC | EER | APCER | BPCER | d' | AP |
|---------|---|-----|-----|-------|-------|----|----|
| deepfake_test | 20,000 | 1.0000 | 0.03% | 0.03% | 0.03% | 36.94 | 1.0000 |

## 2. Operating Points (Security vs Usability)

| Dataset | FAR@FRR=1% | FAR@FRR=0.1% | FRR@FAR=1% | FRR@FAR=0.1% |
|---------|-----------|-------------|-----------|-------------|
| deepfake_test | 0.0001 | 0.0001 | 0.0000 | 0.0002 |

## 3. Confidence Intervals (95% Bootstrap, n=1000)

| Dataset | AUC [95% CI] | EER [95% CI] |
|---------|-------------|-------------|
| deepfake_test | 1.0000 [1.0000, 1.0000] | 0.04% [0.01%, 0.07%] |

## 4. Robustness Under Degradation

| Degradation | AUC | EER | AUC Drop |
|------------|-----|-----|----------|
| original | 1.0000 | 0.00% | — |
| jpeg_q10 | 0.9986 | 2.20% | +0.0014 |
| jpeg_q30 | 1.0000 | 0.40% | +0.0000 |
| jpeg_q50 | 1.0000 | 0.10% | +0.0000 |
| blur_r3 | 0.9991 | 0.80% | +0.0009 |
| blur_r5 | 0.9853 | 6.90% | +0.0147 |
| resize_50% | 1.0000 | 0.20% | +0.0000 |
| resize_25% | 0.9995 | 0.10% | +0.0005 |
| grayscale | 0.9801 | 7.20% | +0.0199 |

## 5. Calibration (ECE = 0.0073)

Lower ECE = better calibrated probabilities. <0.05 = excellent.


## 6. Threshold Stability (global t=0.4965)

| Dataset | APCER | BPCER | ACER |
|---------|-------|-------|------|
| deepfake_test | 0.03% | 0.03% | 0.03% |

## 7. Industry Comparison

| System | Best EER | Cross-domain | PAD Layers | Approach |
|--------|---------|-------------|-----------|----------|
| **Deep-Check v3** | **0.03%** | **N/A** | **6-layer ensemble** | EfficientNet-B4 + FreqV2 |
| Onfido | ~2-5% | Not published | 3D FaceMap | Proprietary |
| iProov | ~1-2% | Not published | Active GPA | Proprietary |
| FaceTec | ~0.5-1% | Not published | 3D Liveness | 3D FaceMap |
| XceptionNet (2019) | ~3.5% | ~15% | Single model | Transfer learning |
| Face X-Ray (2020) | ~2.0% | ~10% | Single model | Blending boundary |
| RECCE (2022) | ~1.8% | ~8% | Single model | Reconstruction |

## Methodology

- All metrics from **real ONNX inference** on **real images**
- Test/cross-test splits **completely disjoint** from training data
- Leak verification: train ∩ test = 0, train ∩ cross = 0
- Bootstrap CI: 1000 iterations, stratified resampling
- Operating points computed at NIST-standard thresholds
- Robustness tests simulate real-world image degradation
- Reproducible: `python ml/benchmark_industrial.py --model <path>`
