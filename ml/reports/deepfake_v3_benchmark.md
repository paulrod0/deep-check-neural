# Deep-Check Formal Deepfake Detection Benchmark

**Date:** 2026-03-22T08:59:02
**Model:** deepfake_pixel_v3_calibrated
**Standard:** ISO/IEC 30107-3:2023
**Inference:** Real ONNX inference on real images

---

## Results by Dataset

| Dataset | N_real | N_fake | AUC | EER | APCER | BPCER | d' | ms/img |
|---------|--------|--------|-----|-----|-------|-------|----|--------|
| deepfake_test | 1,081 | 960 | 0.5135 | 0.4850 | 0.2781 | 0.6920 | 0.01 | 86 |

## Industry Comparison

| System | Best AUC | Best EER | Liveness | Architecture |
|--------|---------|---------|----------|-------------|
| **Deep-Check v3** | **0.5135** | **0.4850** | Passive (7 checks) + 6-layer ensemble | EfficientNet-B4 + FreqV2 |
| Onfido | ~0.95 | ~0.05 | Active + Passive | Proprietary |
| iProov | ~0.98 | ~0.02 | Active (GPA) | Proprietary |
| FaceTec | ~0.99 | ~0.01 | Active (3D Liveness) | 3D FaceMap |
| BioCatch | N/A | N/A | Behavioral | Keystroke + mouse |

## Operating Points (Best Dataset)

| Metric | Value |
|--------|-------|
| frr_at_far_0_001 | 0.9991 (99.91%) |
| frr_at_far_0_01 | 0.9898 (98.98%) |
| frr_at_far_0_05 | 0.9482 (94.82%) |

## Definitions (ISO 30107-3)

- **AUC**: Area Under ROC Curve (1.0 = perfect discrimination)
- **EER**: Equal Error Rate (FAR = FRR crossing point, lower = better)
- **APCER**: Attack Presentation Classification Error Rate (missed attacks)
- **BPCER**: Bona Fide Presentation Classification Error Rate (false alarms)
- **d'**: Sensitivity index (distribution separation, >3 = excellent)
