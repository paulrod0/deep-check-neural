# Deep-Check Formal Deepfake Detection Benchmark

**Date:** 2026-03-23T09:44:37
**Model:** deepfake_pixel_v3
**Standard:** ISO/IEC 30107-3:2023
**Inference:** Real ONNX inference on real images

---

## Results by Dataset

| Dataset | N_real | N_fake | AUC | EER | APCER | BPCER | d' | ms/img |
|---------|--------|--------|-----|-----|-------|-------|----|--------|
| deepfake_test | 1,000 | 1,000 | 1.0000 | 0.0000 | 0.0000 | 0.0000 | 30.68 | 53 |

## Industry Comparison

| System | Best AUC | Best EER | Liveness | Architecture |
|--------|---------|---------|----------|-------------|
| **Deep-Check v3** | **1.0000** | **0.0000** | Passive (7 checks) + 6-layer ensemble | EfficientNet-B4 + FreqV2 |
| Onfido | ~0.95 | ~0.05 | Active + Passive | Proprietary |
| iProov | ~0.98 | ~0.02 | Active (GPA) | Proprietary |
| FaceTec | ~0.99 | ~0.01 | Active (3D Liveness) | 3D FaceMap |
| BioCatch | N/A | N/A | Behavioral | Keystroke + mouse |

## Operating Points (Best Dataset)

| Metric | Value |
|--------|-------|
| frr_at_far_0_001 | 0.0000 (0.00%) |
| frr_at_far_0_01 | 0.0000 (0.00%) |
| frr_at_far_0_05 | 0.0000 (0.00%) |
| far_at_frr_1pct | 0.0000 (0.00%) |
| far_at_frr_5pct | 0.0000 (0.00%) |
| far_at_frr_10pct | 0.0000 (0.00%) |

## Definitions (ISO 30107-3)

- **AUC**: Area Under ROC Curve (1.0 = perfect discrimination)
- **EER**: Equal Error Rate (FAR = FRR crossing point, lower = better)
- **APCER**: Attack Presentation Classification Error Rate (missed attacks)
- **BPCER**: Bona Fide Presentation Classification Error Rate (false alarms)
- **d'**: Sensitivity index (distribution separation, >3 = excellent)
