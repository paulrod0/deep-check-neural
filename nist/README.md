# Deep-Check — NIST FRVT PAD Submission

NIST FATE Presentation Attack Detection (PAD) evaluation submission for **Deep-Check**.

## Provider Information

| Field | Value |
|-------|-------|
| **Provider** | Deep-Check (Hium Solutions) |
| **Library** | `libfrvt_pad_deepcheck_001.so` |
| **API Version** | FRVT PAD v1.5.2 |
| **Implements** | `detectImpersonationPA` + `detectEvasionPA` |

## Architecture

EfficientNet-B4 backbone (1792-dim) + Laplacian FrequencyBranch (32-dim) fused into a
binary classifier head. ONNX Runtime C++ for inference. Single-core CPU (no GPU).

**Input:** RGB image (any resolution) → bilinear resize to 224x224 → ImageNet normalization
**Output:** Score in [-1, +1] where -1 = bona fide, +1 = presentation attack

## Training Data

| Dataset | Images | Attack Types |
|---------|--------|--------------|
| FaceForensics++ C23 | 182K faces | Face2Face, FaceSwap, NeuralTextures, DeepFaceLab |
| DFDC (Meta) | 124K faces | Multiple deepfake methods |
| CelebDF v2 | 130K faces | High-quality face swaps |

## Performance Metrics

| Metric | FF++ | DFDC | CelebDF |
|--------|------|------|---------|
| AUC | 0.9602 | 0.9434 | 0.9913 |
| EER | 10.3% | 12.7% | 4.55% |

## Pre-submission Validation

```
Results: 5/5 passed, 0 failed
STATUS: READY FOR NIST SUBMISSION

- Model loads: PASS
- I/O contract (face_image → logit): PASS
- Score range [-1, +1]: PASS
- Score continuity (49/50 unique): PASS
- Inference time: 45.3ms median (limit: 5000ms): PASS
```

## Build

### Docker (recommended)
```bash
# Copy model to config/
cp ../../public/models/deepfake/deepfake_pixel_v1.onnx pad/config/

# Build in NIST-compatible container
cd pad
docker build -t deepcheck-pad-build .
docker run --rm -v $(pwd)/build:/output deepcheck-pad-build
```

### Native
```bash
# Install ONNX Runtime C++
wget https://github.com/microsoft/onnxruntime/releases/download/v1.17.3/onnxruntime-linux-x64-1.17.3.tgz
tar xzf onnxruntime-linux-x64-1.17.3.tgz
sudo mv onnxruntime-linux-x64-1.17.3 /opt/onnxruntime

# Build
cd pad
cp ../../public/models/deepfake/deepfake_pixel_v1.onnx config/
make
```

## Submission Package Structure

```
submission/
  lib/
    libfrvt_pad_deepcheck_001.so   ← Compiled shared library
  config/
    deepfake_pixel_v1.onnx         ← Model weights (68.6 MB)
    model_config.json              ← Model metadata
```

## NIST Submission Process

1. Complete [FRVT Participation Agreement](https://pages.nist.gov/frvt/html/frvt_pad.html)
2. Run NIST validation package: `./run_validate_pad.sh`
3. Encrypt submission package
4. Email download link to frvt@nist.gov

## Validation Script

```bash
python3 validation/validate_pad.py \
  --model config/deepfake_pixel_v1.onnx \
  --test-dir /path/to/test/images
```

## Files

```
nist/
  README.md                              ← This file
  pad/
    Makefile                             ← Build system
    Dockerfile                           ← NIST-compatible build container
    src/
      include/
        frvt_pad.h                       ← NIST PAD API (v1.5.2)
        frvt_structs.h                   ← NIST common data structures
      lib/
        deep_check_pad.cpp               ← Deep-Check implementation
    config/
      model_config.json                  ← Model metadata
      deepfake_pixel_v1.onnx             ← (copy from public/models/)
    validation/
      validate_pad.py                    ← Pre-submission validation
```
