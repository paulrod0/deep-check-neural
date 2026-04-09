"""
DeepCheck Face — Backbone Networks
Clean-room implementation inspired by IResNet architecture.

The "Improved ResNet" (IResNet) from ArcFace uses:
  - BN → Dropout → FC → BN as the final embedding head
  - Pre-activation residual blocks (BN before conv)
  - Squeeze-Excitation for quality-aware feature weighting

Implemented from architectural descriptions in:
  - Deng et al., "ArcFace" (CVPR 2019)
  - Kim et al., "AdaFace" (CVPR 2022)
  - Hu et al., "Squeeze-and-Excitation Networks" (CVPR 2018)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class SqueezeExcitation(nn.Module):
    """
    SE Block (Hu et al., CVPR 2018)
    Channel attention: global avg pool → FC → ReLU → FC → Sigmoid → scale
    """

    def __init__(self, channels: int, reduction: int = 16):
        super().__init__()
        mid = max(channels // reduction, 8)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Sequential(
            nn.Linear(channels, mid, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(mid, channels, bias=False),
            nn.Sigmoid()
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.shape
        w = self.pool(x).view(b, c)
        w = self.fc(w).view(b, c, 1, 1)
        return x * w


class PreActResBlock(nn.Module):
    """
    Pre-activation residual block with optional SE attention.
    BN → PReLU → Conv3x3 → BN → PReLU → Conv3x3 [+ SE]

    Stride-2 blocks use a 1x1 conv shortcut for downsampling.
    """

    def __init__(self, in_ch: int, out_ch: int, stride: int = 1, use_se: bool = True):
        super().__init__()
        self.bn1 = nn.BatchNorm2d(in_ch)
        self.act1 = nn.PReLU(in_ch)
        self.conv1 = nn.Conv2d(in_ch, out_ch, 3, stride, 1, bias=False)

        self.bn2 = nn.BatchNorm2d(out_ch)
        self.act2 = nn.PReLU(out_ch)
        self.conv2 = nn.Conv2d(out_ch, out_ch, 3, 1, 1, bias=False)

        self.se = SqueezeExcitation(out_ch) if use_se else nn.Identity()

        # Shortcut for dimension/stride mismatch
        self.shortcut = nn.Identity()
        if stride != 1 or in_ch != out_ch:
            self.shortcut = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 1, stride, bias=False),
                nn.BatchNorm2d(out_ch)
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = self.shortcut(x)
        out = self.conv1(self.act1(self.bn1(x)))
        out = self.conv2(self.act2(self.bn2(out)))
        out = self.se(out)
        return out + identity


class DeepCheckFaceNet(nn.Module):
    """
    Face recognition backbone producing 512-D embeddings.

    Architecture follows IResNet pattern from ArcFace:
      - Stem: Conv3x3(3→64) + BN + PReLU
      - Stage 1: blocks × PreActRes(64→64)
      - Stage 2: blocks × PreActRes(64→128, stride=2 first)
      - Stage 3: blocks × PreActRes(128→256, stride=2 first)
      - Stage 4: blocks × PreActRes(256→512, stride=2 first)
      - Head: BN → Dropout → Flatten → FC(512*7*7 → emb_dim) → BN

    Input: 112×112 face images
    Output: 512-D embedding vector (NOT normalized — caller normalizes)

    Configurations:
      - DeepCheckFaceNet-50:  [3, 4, 14, 3]  → ~23M params
      - DeepCheckFaceNet-100: [3, 13, 30, 3]  → ~43M params
      - DeepCheckFaceNet-18:  [2, 2, 2, 2]    → ~12M params (lightweight)
    """

    def __init__(self, layers: list, emb_dim: int = 512, use_se: bool = True,
                 dropout: float = 0.4):
        super().__init__()
        self.emb_dim = emb_dim

        # Stem
        self.stem = nn.Sequential(
            nn.Conv2d(3, 64, 3, 1, 1, bias=False),
            nn.BatchNorm2d(64),
            nn.PReLU(64)
        )

        # Residual stages
        channels = [64, 128, 256, 512]
        self.stage1 = self._make_stage(64, channels[0], layers[0], stride=2, use_se=use_se)
        self.stage2 = self._make_stage(channels[0], channels[1], layers[1], stride=2, use_se=use_se)
        self.stage3 = self._make_stage(channels[1], channels[2], layers[2], stride=2, use_se=use_se)
        self.stage4 = self._make_stage(channels[2], channels[3], layers[3], stride=2, use_se=use_se)

        # Embedding head: BN → Dropout → FC → BN
        # After 4 stride-2 stages on 112×112: spatial size = 7×7
        self.head = nn.Sequential(
            nn.BatchNorm2d(512),
            nn.Dropout(dropout),
            nn.Flatten(),
            nn.Linear(512 * 7 * 7, emb_dim, bias=False),
            nn.BatchNorm1d(emb_dim)
        )

        self._init_weights()

    def _make_stage(self, in_ch: int, out_ch: int, num_blocks: int,
                    stride: int, use_se: bool) -> nn.Sequential:
        layers = [PreActResBlock(in_ch, out_ch, stride=stride, use_se=use_se)]
        for _ in range(1, num_blocks):
            layers.append(PreActResBlock(out_ch, out_ch, stride=1, use_se=use_se))
        return nn.Sequential(*layers)

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
            elif isinstance(m, nn.BatchNorm2d) or isinstance(m, nn.BatchNorm1d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode='fan_out')

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, 3, 112, 112) face images, normalized to [-1, 1]
        Returns:
            (B, emb_dim) embedding vectors (raw, not L2-normalized)
        """
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = self.stage4(x)
        x = self.head(x)
        return x


# ── Model constructors ───────────────────────────────────────────────────────

def deepcheck_face_18(emb_dim: int = 512, **kwargs) -> DeepCheckFaceNet:
    """Lightweight: 12M params, fast inference."""
    return DeepCheckFaceNet([2, 2, 2, 2], emb_dim=emb_dim, **kwargs)

def deepcheck_face_50(emb_dim: int = 512, **kwargs) -> DeepCheckFaceNet:
    """Standard: 23M params, good accuracy/speed tradeoff."""
    return DeepCheckFaceNet([3, 4, 14, 3], emb_dim=emb_dim, **kwargs)

def deepcheck_face_100(emb_dim: int = 512, **kwargs) -> DeepCheckFaceNet:
    """High accuracy: 43M params."""
    return DeepCheckFaceNet([3, 13, 30, 3], emb_dim=emb_dim, **kwargs)
