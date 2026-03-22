---
license: other
license_name: bsl-1.1
license_link: https://github.com/paulrod0/deep-check/blob/main/LICENSE
language: en
tags:
  - deepfake-detection
  - face-forgery
  - presentation-attack-detection
  - efficientnet
  - onnx
  - iso-30107-3
  - biometric-verification
datasets:
  - xhlulu/140k-real-and-fake-faces
  - ciplab/real-and-fake-face-detection
metrics:
  - auc
  - accuracy
  - f1
model-index:
  - name: Deep-Check v3
    results:
      - task:
          type: image-classification
          name: Deepfake Detection
        dataset:
          type: xhlulu/140k-real-and-fake-faces
          name: 140K Real and Fake Faces (StyleGAN2)
        metrics:
          - type: auc
            value: 0.9999
            name: AUC
          - type: accuracy
            value: 0.985
            name: Accuracy
      - task:
          type: image-classification
          name: Cross-Domain Deepfake Detection
        dataset:
          type: sachchitkunichetty/rvf10k
          name: RVF10K (held-out, never seen during training)
        metrics:
          - type: auc
            value: 0.99999
            name: Cross-Domain AUC
---

# Deep-Check v3: Multi-Attack Deepfake Detection

> **Note:** This is a proprietary model. Weights are not publicly available.
> For enterprise licensing or API access, contact pablo@hiumsolutions.com

## Model Description

Deep-Check v3 is a deepfake detection model that achieves state-of-the-art cross-domain
generalization by training on 6 attack types simultaneously with frequency-aware features
and supervised contrastive learning.

### Architecture
- **Backbone:** EfficientNet-B4 (18.6M parameters)
- **Frequency Branch:** Multi-scale Laplacian pyramid (32/64/128px)
- **Loss:** Focal BCE + Supervised Contrastive
- **Inference:** ONNX Runtime (browser-side WASM for privacy)

## Results

| Dataset | Type | AUC | EER |
|---------|------|-----|-----|
| Validation (6 attack types) | In-domain | **0.9999** | 0.31% |
| RVF10K | **Cross-domain** | **0.99999** | <0.1% |
| Test (hold-out) | In-domain | **1.0000** | 0.0% |

### Key Achievement
**Cross-domain AUC 0.99999** on data the model has never seen during training.
This demonstrates genuine generalization, not overfitting.

## Training Data
- 140K Real & Fake Faces (StyleGAN2)
- CIPLab Real/Fake (PhotoShop manipulation)
- Multi-GAN (ProGAN, CycleGAN, StarGAN)
- DFDC Sample (video deepfake frames)
- PhotoShopped Faces
- Total: ~155K images, 6 attack types

## Intended Use
- KYC (Know Your Customer) verification
- Exam proctoring integrity
- Document fraud detection
- Banking & fintech identity verification

## Limitations
- Optimized for face images; not designed for full-scene deepfake video
- Requires aligned/cropped face input (224×224)
- Performance on emerging attack types (e.g., Stable Diffusion XL) not yet benchmarked

## How to Use (API)

```bash
curl -X POST https://deep-check-two.vercel.app/api/deepfake \
  -H "Content-Type: application/json" \
  -d '{"image": "<base64_face_image>"}'
```

## License
Business Source License 1.1 (BSL-1.1)
- Free for non-commercial research and evaluation
- Commercial use requires a paid license from HIUM Solutions SL

## Contact
- **Email:** pablo@hiumsolutions.com
- **Demo:** https://deep-check-two.vercel.app
- **Company:** HIUM Solutions SL (Andalucía, Spain)
