# Deep-Check — NIST FRVT PAD Submission

## Organization
- **Company**: Deep-Check (HIUM Solutions SL)
- **Location**: Andalucia, Spain
- **Contact**: pablo@hiumsolutions.com
- **Algorithm ID**: deepcheck_000

## Algorithm Description
EfficientNet-B4 backbone with multi-scale frequency analysis (FrequencyBranchV2)
trained on 7 diverse datasets covering GAN-generated faces, PhotoShop manipulations,
video deepfakes (FF++, DFDC, CelebDF), and cross-domain test sets.

### Architecture
- **Backbone**: EfficientNet-B4 (ImageNet pretrained, 1792-dim features)
- **Frequency Branch**: Multi-scale Laplacian pyramid at 32/64/128px (48-dim)
- **Loss**: Focal BCE (gamma=2) + Supervised Contrastive (w=0.1, tau=0.07)
- **Inference**: ONNX Runtime CPU (no GPU required)
- **Input**: 224x224 RGB, ImageNet-normalized
- **Output**: Logit (sigmoid -> P(fake))
- **Parameters**: 18.6M
- **ONNX size**: ~70 MB
- **Inference time**: ~80ms on Intel Xeon Gold 6248 (well under 5000ms limit)

### Training Data
| Dataset | Type | Size |
|---------|------|------|
| 140K Real & Fake (Kaggle) | StyleGAN2 | 140K images |
| CIPLab (Kaggle) | PhotoShop | ~2K images |
| Multi-GAN (Kaggle) | ProGAN/CycleGAN/StarGAN | ~5K images |
| Deepfake Faces (Kaggle) | StyleGAN | ~5K images |
| PhotoShopped Faces (Kaggle) | Manual manipulation | ~1K images |
| DFDC Sample (Kaggle) | Video deepfake frames | ~2K images |
| RVF10K (Kaggle, held-out) | Cross-domain test | 10K images |

### Performance (self-evaluation)
| Metric | Value |
|--------|-------|
| In-domain AUC | 0.9994 |
| Cross-domain AUC | 0.99994 |
| EER | 0.81% |
| APCER @ BPCER=1% | < 0.5% |

## Build Instructions

```bash
# 1. Install ONNX Runtime C++ (CPU only)
wget https://github.com/microsoft/onnxruntime/releases/download/v1.17.0/onnxruntime-linux-x64-1.17.0.tgz
tar xzf onnxruntime-linux-x64-1.17.0.tgz
export ORT_DIR=$PWD/onnxruntime-linux-x64-1.17.0

# 2. Place ONNX model in config/
cp deepfake_pixel_v3.onnx config/

# 3. Build
make

# 4. Validate
make test

# 5. Create submission package
make package
```

## Files
```
deep-check-sdk/
├── include/
│   ├── frvt_pad.h          # NIST PAD API header
│   └── frvt_structs.h      # NIST common data structures
├── src/
│   └── deep_check_pad.cpp  # Deep-Check PAD implementation
├── config/
│   └── deepfake_pixel_v3.onnx  # Trained model (placed after training)
├── lib/
│   └── libonnxruntime.so       # ONNX Runtime (bundled for submission)
├── Makefile
└── README.md
```

## NIST Submission Status
- **Track**: FATE PAD (Presentation Attack Detection)
- **Current status**: CLOSED (last deadline: Feb 28, 2023)
- **Next steps**: Subscribe to frvt-news@list.nist.gov for reopening announcement
- **Participation Agreement**: Required before first submission
