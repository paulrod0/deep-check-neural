#!/usr/bin/env python3
"""
Deep-Check — EfficientNet-B0 Pixel Forensics (L4)
==================================================
Server-side deepfake detection from raw pixel data.
Detects:
  - GAN synthesis artifacts in DCT frequency domain
  - Unnatural skin texture (missing pore/noise structure)
  - Color channel over-correlation (neural renders: RGB too correlated)
  - JPEG compression artifacts inconsistent with claimed quality

Architecture:
  EfficientNet-B0 backbone (pretrained ImageNet)
  + DCT frequency branch (analyze 8x8 block DCT coefficients)
  + Late fusion: concat(B0_features, dct_features) -> head(3 classes)

Usage:
  python train_efficientnet_pixel.py \
    --real-dir  ./data/frames/real \
    --fake-dir  ./data/frames/fake \
    --photo-dir ./data/frames/photo \
    --output    efficientnet_pixel.onnx

Requirements:
  pip install torch torchvision Pillow tqdm

Output:
  checkpoints/efficientnet_best.pt
  efficientnet_pixel.onnx  (~9MB fp32, ~4.5MB fp16)

Veritas Engine v2 — Deep-Check
"""

import os
import sys
import json
import time
import argparse
import numpy as np
from pathlib import Path

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
    from torchvision import transforms, models
    from PIL import Image
    from tqdm import tqdm
except ImportError as e:
    print(f"ERROR: {e}")
    print("Install: pip install torch torchvision Pillow tqdm")
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────

IMG_SIZE    = 224
N_CLASSES   = 3
BATCH_SIZE  = 32
LR          = 1e-4
WEIGHT_DECAY = 1e-4
PATIENCE    = 10
MAX_EPOCHS  = 60
LABELS      = ['real_human', 'deepfake_video', 'photo_replay']

# ─── Dataset ─────────────────────────────────────────────────────────────────

TRAIN_TRANSFORMS = transforms.Compose([
    transforms.Resize((IMG_SIZE + 16, IMG_SIZE + 16)),
    transforms.RandomCrop(IMG_SIZE),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

VAL_TRANSFORMS = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


class FaceFrameDataset(Dataset):
    """Load face frame images from real/, fake/, photo/ directories."""

    def __init__(self, data_dir: str, split: str = 'train'):
        self.transform = TRAIN_TRANSFORMS if split == 'train' else VAL_TRANSFORMS
        self.samples: list[tuple[str, int]] = []
        img_exts = {'.jpg', '.jpeg', '.png', '.bmp'}

        label_dirs = [
            (Path(data_dir) / 'real',  0),
            (Path(data_dir) / 'fake',  1),
            (Path(data_dir) / 'photo', 2),
        ]

        for d, label in label_dirs:
            if not d.exists():
                print(f"[data] WARNING: {d} not found — skipping")
                continue
            files = sorted([f for f in d.rglob('*') if f.suffix.lower() in img_exts])
            n_train = int(len(files) * 0.8)
            if split == 'train':
                files = files[:n_train]
            else:
                files = files[n_train:]
            self.samples.extend([(str(f), label) for f in files])

        if not self.samples:
            print("[data] No images found — using dummy dataset")
            self.samples = [('__dummy__', i % 3) for i in range(300)]

    def __len__(self): return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        if path == '__dummy__':
            img = Image.fromarray(np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8))
        else:
            img = Image.open(path).convert('RGB')
        return self.transform(img), label


# ─── DCT branch ───────────────────────────────────────────────────────────────

class DCTBranch(nn.Module):
    """
    Extract DCT-domain features from input image tensor.
    GAN-generated images have characteristic artifacts in DCT frequency bands.
    Operates on grayscale Y channel (luminance).
    """

    def __init__(self, out_dim: int = 64):
        super().__init__()
        # Create 8x8 DCT basis matrix as fixed conv weight
        dct_basis = self._build_dct_basis()
        # Register as buffer (not trainable)
        self.register_buffer('dct_weight', dct_basis)  # (64, 1, 8, 8)
        self.pool = nn.AdaptiveAvgPool2d((7, 7))
        self.fc   = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 7 * 7, 256),
            nn.ReLU(),
            nn.Linear(256, out_dim),
        )

    def _build_dct_basis(self):
        """Build 64 8x8 DCT basis functions as conv kernels."""
        basis = torch.zeros(64, 1, 8, 8)
        for u in range(8):
            for v in range(8):
                k = u * 8 + v
                cu = (1 / np.sqrt(8)) if u == 0 else np.sqrt(2 / 8)
                cv = (1 / np.sqrt(8)) if v == 0 else np.sqrt(2 / 8)
                for x in range(8):
                    for y in range(8):
                        basis[k, 0, x, y] = cu * cv * np.cos((2*x+1)*u*np.pi/16) * np.cos((2*y+1)*v*np.pi/16)
        return basis

    def forward(self, x):
        # x: (B, 3, H, W) normalized
        # Convert to grayscale luminance
        gray = 0.299 * x[:, 0] + 0.587 * x[:, 1] + 0.114 * x[:, 2]
        gray = gray.unsqueeze(1)  # (B, 1, H, W)

        # Apply DCT conv (stride=8 for non-overlapping 8x8 blocks)
        dct = F.conv2d(gray, self.dct_weight, stride=8)  # (B, 64, H/8, W/8)
        dct = dct.abs()  # magnitude

        out = self.pool(dct)
        return self.fc(out)


# ─── Full model ───────────────────────────────────────────────────────────────

class EfficientNetPixelForensics(nn.Module):
    """EfficientNet-B0 + DCT frequency branch for pixel forensics."""

    def __init__(self, n_classes=N_CLASSES):
        super().__init__()

        # EfficientNet-B0 backbone (pretrained)
        backbone = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        # Remove classifier head, keep feature extractor
        self.backbone = nn.Sequential(*list(backbone.children())[:-1])  # -> (B, 1280, 1, 1)
        self.backbone_dim = 1280

        # DCT branch
        self.dct = DCTBranch(out_dim=64)

        # Fusion head
        self.head = nn.Sequential(
            nn.Linear(self.backbone_dim + 64, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Dropout(0.4),
            nn.Linear(256, 64),
            nn.GELU(),
            nn.Linear(64, n_classes),
        )

    def forward(self, x):
        # EfficientNet features
        b_feat = self.backbone(x).flatten(1)  # (B, 1280)

        # DCT features
        d_feat = self.dct(x)                  # (B, 64)

        # Fuse and classify
        fused = torch.cat([b_feat, d_feat], dim=1)
        return self.head(fused)


# ─── Training ─────────────────────────────────────────────────────────────────

def run_validation(model, loader, device):
    model.train(False)
    correct, total = 0, 0
    per_class = np.zeros((N_CLASSES, N_CLASSES), dtype=int)

    with torch.no_grad():
        for xb, yb in loader:
            xb = xb.to(device)
            preds = model(xb).argmax(1).cpu()
            for t, p in zip(yb, preds):
                per_class[t.item(), p.item()] += 1
            correct += (preds == yb).sum().item()
            total   += xb.size(0)

    model.train(True)
    acc = correct / max(1, total)
    for i, name in enumerate(LABELS):
        tp = per_class[i, i]
        fp = per_class[:, i].sum() - tp
        fn = per_class[i, :].sum() - tp
        prec = tp / max(1, tp + fp)
        rec  = tp / max(1, tp + fn)
        f1   = 2 * prec * rec / max(1e-6, prec + rec)
        print(f"  {name:18s}  P={prec:.3f}  R={rec:.3f}  F1={f1:.3f}")

    return acc


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[train] Device: {device}")

    train_ds = FaceFrameDataset(args.data_dir, 'train')
    val_ds   = FaceFrameDataset(args.data_dir, 'val')
    print(f"[train] Train: {len(train_ds)}  Val: {len(val_ds)}")

    # Balanced sampler
    labels = [s[1] for s in train_ds.samples]
    counts = np.bincount(labels, minlength=N_CLASSES)
    weights = 1.0 / (counts + 1e-6)
    sample_weights = torch.tensor([weights[l] for l in labels])
    sampler = WeightedRandomSampler(sample_weights, len(sample_weights))

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=sampler,
                              num_workers=4, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE * 2, shuffle=False,
                              num_workers=4)

    model = EfficientNetPixelForensics().to(device)
    print(f"[train] Parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Freeze backbone for first 5 epochs, then unfreeze
    for p in model.backbone.parameters():
        p.requires_grad = False

    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=LR, weight_decay=WEIGHT_DECAY
    )
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_val_acc = 0.0
    patience_cnt = 0
    os.makedirs('checkpoints', exist_ok=True)

    for epoch in range(1, MAX_EPOCHS + 1):
        # Unfreeze backbone after warmup
        if epoch == 6:
            for p in model.backbone.parameters():
                p.requires_grad = True
            optimizer = torch.optim.AdamW(model.parameters(), lr=LR / 5, weight_decay=WEIGHT_DECAY)
            print("[train] Backbone unfrozen")

        model.train(True)
        total_loss, correct, total = 0.0, 0, 0

        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss   = criterion(logits, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            total_loss += loss.item() * xb.size(0)
            correct    += (logits.argmax(1) == yb).sum().item()
            total      += xb.size(0)

        train_acc = correct / total
        val_acc   = run_validation(model, val_loader, device)
        improved  = val_acc > best_val_acc
        if improved:
            best_val_acc = val_acc
            torch.save(model.state_dict(), 'checkpoints/efficientnet_best.pt')
            patience_cnt = 0
        else:
            patience_cnt += 1

        marker = ' <- best' if improved else ''
        print(f"Epoch {epoch:3d}  train={train_acc:.3f}  val={val_acc:.3f}{marker}")

        if patience_cnt >= PATIENCE:
            print(f"[train] Early stopping at epoch {epoch}")
            break

    print(f"\n[train] Best val accuracy: {best_val_acc:.4f}")
    model.load_state_dict(torch.load('checkpoints/efficientnet_best.pt', weights_only=False))
    export_onnx(model, device, args.output)


def export_onnx(model, device, output_path: str = 'efficientnet_pixel.onnx'):
    model.train(False)
    dummy = torch.zeros(1, 3, IMG_SIZE, IMG_SIZE, device=device)

    torch.onnx.export(
        model, dummy, output_path,
        input_names=['frame'],
        output_names=['logits'],
        dynamic_axes={'frame': {0: 'batch_size'}},
        opset_version=17,
    )

    size_mb = os.path.getsize(output_path) / (1024 ** 2)
    print(f"[export] Saved: {output_path} ({size_mb:.1f}MB)")

    meta = {
        'model': 'efficientnet_pixel_forensics',
        'architecture': 'efficientnet_b0 + dct_branch',
        'input_size': IMG_SIZE,
        'classes': LABELS,
        'exported_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    meta_path = output_path.replace('.onnx', '_metadata.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"[export] Metadata: {meta_path}")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir',    default='./data/frames')
    parser.add_argument('--output',      default='efficientnet_pixel.onnx')
    parser.add_argument('--export-only', action='store_true')
    args = parser.parse_args()

    if args.export_only:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model  = EfficientNetPixelForensics().to(device)
        model.load_state_dict(torch.load('checkpoints/efficientnet_best.pt', weights_only=False))
        export_onnx(model, device, args.output)
    else:
        train(args)
