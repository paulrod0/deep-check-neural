# Papers With Code — Deep-Check v3 Submission

## Method
**Deep-Check v3** (EfficientNet-B4 + FrequencyBranchV2 + SupCon)

## Architecture
EfficientNet-B4 backbone (1792-dim) + Multi-scale Laplacian Frequency Branch (48-dim) + Supervised Contrastive auxiliary loss + Focal BCE primary loss. Total: 18.6M parameters.

## Code
https://github.com/paulrod0/deep-check

## Results

### 140K Real vs Fake Faces (StyleGAN2)
| Metric | Value |
|--------|-------|
| AUC | **1.0000** |
| EER | **0.00%** |
| Accuracy | **100.0%** |
| d' | **30.68** |

### Cross-Domain (RVF10K — never seen in training)
| Metric | Value |
|--------|-------|
| AUC | **1.0000** |
| EER | **<0.1%** |

### Multi-Dataset Validation (18K images)
| Metric | Value |
|--------|-------|
| Val AUC | **0.9999** |
| Best EER | **0.31%** |

## Training
- Hardware: Tesla T4 16GB (EC2 g4dn.xlarge)
- 30 epochs, 145K training images from 6 datasets
- Focal BCE (gamma=2) + SupCon (w=0.1)
- Aggressive augmentation: JPEG, blur, noise, downscale, dropout

## Contact
pablo@hiumsolutions.com | HIUM Solutions SL
