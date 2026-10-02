#!/usr/bin/env python3
"""
Deep-Check — Priority 1: Fine-tune on FaceForensics++
======================================================
Fine-tunes the existing EfficientNet-B4 + FrequencyBranch model
on FaceForensics++ dataset for real deepfake detection.

FaceForensics++ contains 1000 original videos manipulated with:
  - Deepfakes (autoencoder-based face swap)
  - Face2Face (facial reenactment)
  - FaceSwap (graphics-based face swap)
  - NeuralTextures (GAN-based reenactment)
  - FaceShifter (high-fidelity face swap)

Dataset access:
  FaceForensics++ requires filling a Google Form:
  https://docs.google.com/forms/d/e/1FAIpQLSdRRR3L5zAv6tQ_CKxmK4W96tAab_pfBu2EKAgQbeDVhmXagg/viewform

Usage:
  # Step 1: Download & extract frames
  python infra/finetune_faceforensics.py --prepare \
    --ff-root /data/FaceForensics++ \
    --output-dir /data/ff_frames

  # Step 2: Fine-tune from existing checkpoint
  python infra/finetune_faceforensics.py --train \
    --data-dir /data/ff_frames \
    --checkpoint /kaggle/working/best_model.pt \
    --output deepfake_pixel_v2_ff.onnx

  # Step 3: Evaluate
  python infra/finetune_faceforensics.py --eval \
    --data-dir /data/ff_frames \
    --checkpoint checkpoints/ff_best.pt

Requirements:
  pip install torch torchvision timm albumentations Pillow tqdm \
              scikit-learn opencv-python-headless onnx onnxruntime

Veritas Engine v3 — Deep-Check
"""

import os
import sys
import json
import time
import random
import argparse
from pathlib import Path
from typing import Optional

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
    import timm
    import albumentations as A
    from albumentations.pytorch import ToTensorV2
    from PIL import Image
    from tqdm import tqdm
    from sklearn.metrics import roc_auc_score, roc_curve
    import cv2
except ImportError as e:
    print(f"ERROR: {e}")
    print("Install: pip install torch torchvision timm albumentations Pillow tqdm scikit-learn opencv-python-headless")
    sys.exit(1)

# ─── Reproducibility ──────────────────────────────────────────────────────────
torch.manual_seed(42)
np.random.seed(42)
random.seed(42)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(42)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# ─── Config ───────────────────────────────────────────────────────────────────

IMG_SIZE      = 224
BATCH_SIZE    = 32
LR_HEAD       = 3e-4
LR_BACKBONE   = 3e-5
WEIGHT_DECAY  = 1e-4
LABEL_SMOOTH  = 0.05
WARMUP_EPOCHS = 3
MAX_EPOCHS    = 40
PATIENCE      = 8

FF_METHODS = ['Deepfakes', 'Face2Face', 'FaceSwap', 'NeuralTextures', 'FaceShifter']
FF_COMPRESSIONS = ['c23', 'c40']

# ─── Model (same arch as kaggle_deepfake_notebook.py) ─────────────────────────

class FrequencyBranch(nn.Module):
    def __init__(self, out_dim: int = 32):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(16, 32, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(8),
        )
        self.proj = nn.Linear(32 * 8 * 8, out_dim)

    def forward(self, x):
        xf = F.interpolate(x, size=(64, 64), mode='bilinear', align_corners=False)
        low = F.avg_pool2d(xf, kernel_size=3, stride=1, padding=1)
        hp = xf - low
        return self.proj(self.encoder(hp).flatten(1))


class DeepfakeDetector(nn.Module):
    def __init__(self, dropout: float = 0.4):
        super().__init__()
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        feat_dim = self.backbone.num_features
        self.freq = FrequencyBranch(out_dim=32)
        self.head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feat_dim + 32, 256),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(256, 1),
        )

    def forward(self, x):
        spatial = self.backbone(x)
        freq = self.freq(x)
        combined = torch.cat([spatial, freq], 1)
        return self.head(combined).squeeze(1)

    @torch.no_grad()
    def predict_proba(self, x):
        return torch.sigmoid(self.forward(x))


# ─── Augmentation ─────────────────────────────────────────────────────────────

TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.8, 1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([
        A.ImageCompression(quality_range=(30, 95)),
        A.GaussianBlur(blur_limit=(3, 7)),
        A.GaussNoise(std_range=(0.04, 0.22)),
    ], p=0.7),
    A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.5),
    A.CoarseDropout(num_holes_range=(1, 4), hole_height_range=(10, 20),
                    hole_width_range=(10, 20), p=0.3),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])

VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])


# ─── Face extraction from video ──────────────────────────────────────────────

def extract_faces_from_video(video_path, output_dir, max_frames=30, face_margin=0.3):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return 0

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        cap.release()
        return 0

    indices = np.linspace(0, total_frames - 1, min(max_frames, total_frames), dtype=int)
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )

    os.makedirs(output_dir, exist_ok=True)
    saved = 0
    video_name = Path(video_path).stem

    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ret, frame = cap.read()
        if not ret:
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.3, 5, minSize=(64, 64))

        if len(faces) > 0:
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            margin_x = int(w * face_margin)
            margin_y = int(h * face_margin)
            x1 = max(0, x - margin_x)
            y1 = max(0, y - margin_y)
            x2 = min(frame.shape[1], x + w + margin_x)
            y2 = min(frame.shape[0], y + h + margin_y)
            face = frame[y1:y2, x1:x2]
        else:
            h_f, w_f = frame.shape[:2]
            size = min(h_f, w_f) // 2
            cx, cy = w_f // 2, h_f // 2
            face = frame[cy - size:cy + size, cx - size:cx + size]

        if face.size == 0:
            continue

        face = cv2.resize(face, (IMG_SIZE, IMG_SIZE))
        out_path = os.path.join(output_dir, f"{video_name}_f{idx:04d}.jpg")
        cv2.imwrite(out_path, face, [cv2.IMWRITE_JPEG_QUALITY, 95])
        saved += 1

    cap.release()
    return saved


def prepare_faceforensics(ff_root, output_dir, frames_per_video=30):
    """Extract face frames from FF++ videos."""
    ff_root = Path(ff_root)
    output_dir = Path(output_dir)
    stats = {'real': 0, 'fake': 0, 'methods': {}}

    for comp in FF_COMPRESSIONS:
        real_dir = ff_root / 'original_sequences' / 'youtube' / comp / 'videos'
        if not real_dir.exists():
            print(f"  [skip] {real_dir} not found")
            continue
        print(f"\n  Extracting real faces ({comp})...")
        for v in tqdm(sorted(real_dir.glob('*.mp4')), desc=f'Real {comp}'):
            out = output_dir / 'real' / comp / v.stem
            stats['real'] += extract_faces_from_video(str(v), str(out), frames_per_video)

    for method in FF_METHODS:
        stats['methods'][method] = 0
        for comp in FF_COMPRESSIONS:
            fake_dir = ff_root / 'manipulated_sequences' / method / comp / 'videos'
            if not fake_dir.exists():
                continue
            print(f"\n  Extracting {method} ({comp})...")
            for v in tqdm(sorted(fake_dir.glob('*.mp4')), desc=f'{method} {comp}'):
                out = output_dir / 'fake' / method / comp / v.stem
                n = extract_faces_from_video(str(v), str(out), frames_per_video)
                stats['fake'] += n
                stats['methods'][method] += n

    with open(output_dir / 'extraction_stats.json', 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"\n  Real: {stats['real']:,} | Fake: {stats['fake']:,}")
    for m, c in stats['methods'].items():
        print(f"    {m}: {c:,}")


# ─── Dataset ──────────────────────────────────────────────────────────────────

class FFPlusPlusDataset(Dataset):
    IMG_EXTS = {'.jpg', '.jpeg', '.png'}

    def __init__(self, data_dir, split='train', augment=None):
        self.augment = augment or (TRAIN_AUG if split == 'train' else VAL_AUG)
        self.samples = []

        data_dir = Path(data_dir)
        real_dir = data_dir / 'real'
        fake_dir = data_dir / 'fake'

        if real_dir.exists():
            for f in real_dir.rglob('*'):
                if f.suffix.lower() in self.IMG_EXTS:
                    self.samples.append((str(f), 0))

        if fake_dir.exists():
            for f in fake_dir.rglob('*'):
                if f.suffix.lower() in self.IMG_EXTS:
                    self.samples.append((str(f), 1))

        random.shuffle(self.samples)
        n = len(self.samples)
        if split == 'train':
            self.samples = self.samples[:int(n * 0.8)]
        elif split == 'val':
            self.samples = self.samples[int(n * 0.8):int(n * 0.9)]
        else:
            self.samples = self.samples[int(n * 0.9):]

        n_real = sum(1 for _, l in self.samples if l == 0)
        n_fake = sum(1 for _, l in self.samples if l == 1)
        print(f"  [{split}] {n_real:,} real + {n_fake:,} fake = {len(self.samples):,}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = np.array(Image.open(path).convert('RGB'))
        except Exception:
            img = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
        aug = self.augment(image=img)
        return aug['image'], torch.tensor(label, dtype=torch.float32)

    def class_weights(self):
        labels = np.array([l for _, l in self.samples])
        counts = np.bincount(labels, minlength=2)
        per_class = 1.0 / np.maximum(counts, 1)
        return torch.tensor(per_class[labels], dtype=torch.float32)


# ─── Loss ─────────────────────────────────────────────────────────────────────

class LabelSmoothBCE(nn.Module):
    def __init__(self, smoothing=0.05):
        super().__init__()
        self.smoothing = smoothing

    def forward(self, logits, targets):
        soft = targets * (1.0 - self.smoothing) + 0.5 * self.smoothing
        return F.binary_cross_entropy_with_logits(logits, soft)


# ─── Training ─────────────────────────────────────────────────────────────────

def train_one_epoch(model, loader, optimizer, criterion, scaler):
    model.train()
    running_loss = correct = total = 0
    for imgs, labels in tqdm(loader, desc='Train', leave=False):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs)
            loss = criterion(logits, labels)
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)
        scaler.update()
        running_loss += loss.item() * len(labels)
        preds = (torch.sigmoid(logits.detach()) > 0.5)
        correct += (preds == labels.bool()).sum().item()
        total += len(labels)
    return running_loss / total, correct / total


@torch.no_grad()
def run_evaluation(model, loader):
    model.eval()
    all_labels, all_probs = [], []
    for imgs, labels in tqdm(loader, desc='Eval', leave=False):
        probs = model.predict_proba(imgs.to(DEVICE)).cpu().numpy()
        all_probs.extend(probs)
        all_labels.extend(labels.numpy())
    labels_np = np.array(all_labels)
    probs_np = np.array(all_probs)
    auc = roc_auc_score(labels_np, probs_np)
    acc = ((probs_np > 0.5).astype(int) == labels_np.astype(int)).mean()
    fpr, tpr, _ = roc_curve(labels_np, probs_np)
    fnr = 1.0 - tpr
    eer_idx = int(np.nanargmin(np.abs(fnr - fpr)))
    eer = float(fpr[eer_idx])
    return auc, acc, eer


def finetune(args):
    print(f"\n{'='*60}")
    print(f"  Deep-Check — FaceForensics++ Fine-tuning (Priority 1)")
    print(f"  Device: {DEVICE}")
    print(f"{'='*60}\n")

    train_ds = FFPlusPlusDataset(args.data_dir, 'train')
    val_ds = FFPlusPlusDataset(args.data_dir, 'val')
    test_ds = FFPlusPlusDataset(args.data_dir, 'test')

    sampler = WeightedRandomSampler(train_ds.class_weights(), len(train_ds))
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=sampler,
                              num_workers=4, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE * 2, shuffle=False, num_workers=4)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE * 2, shuffle=False, num_workers=4)

    model = DeepfakeDetector(dropout=0.4).to(DEVICE)

    if args.checkpoint and os.path.exists(args.checkpoint):
        print(f"Loading checkpoint: {args.checkpoint}")
        ckpt = torch.load(args.checkpoint, map_location=DEVICE, weights_only=False)
        model.load_state_dict(ckpt.get('state', ckpt), strict=False)

    # Phase 1: freeze backbone
    for p in model.backbone.parameters():
        p.requires_grad = False
    head_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(head_params, lr=LR_HEAD, weight_decay=WEIGHT_DECAY)
    criterion = LabelSmoothBCE(LABEL_SMOOTH)
    scaler = torch.amp.GradScaler('cuda', enabled=DEVICE.type == 'cuda')

    best_auc = 0.0
    patience_cnt = 0
    os.makedirs('checkpoints', exist_ok=True)
    total_epochs = WARMUP_EPOCHS + MAX_EPOCHS
    history = []

    for epoch in range(1, total_epochs + 1):
        if epoch == WARMUP_EPOCHS + 1:
            print(f"\n--- Phase 2: Full fine-tune ---")
            for p in model.backbone.parameters():
                p.requires_grad = True
            optimizer = torch.optim.AdamW([
                {'params': model.backbone.parameters(), 'lr': LR_BACKBONE},
                {'params': model.freq.parameters(), 'lr': LR_HEAD},
                {'params': model.head.parameters(), 'lr': LR_HEAD},
            ], weight_decay=WEIGHT_DECAY)

        t0 = time.time()
        tr_loss, tr_acc = train_one_epoch(model, train_loader, optimizer, criterion, scaler)
        val_auc, val_acc, val_eer = run_evaluation(model, val_loader)
        elapsed = time.time() - t0

        improved = val_auc > best_auc
        if improved:
            best_auc = val_auc
            torch.save({'epoch': epoch, 'state': model.state_dict(),
                        'val_auc': val_auc, 'val_eer': val_eer,
                        'dataset': 'faceforensics++'}, 'checkpoints/ff_best.pt')
            patience_cnt = 0
        else:
            patience_cnt += 1

        marker = ' ★' if improved else ''
        print(f"Ep {epoch:3d}/{total_epochs} | loss {tr_loss:.4f} | "
              f"acc {tr_acc:.3f} | val_AUC {val_auc:.4f} | EER {val_eer:.3f} | "
              f"{elapsed:.0f}s{marker}")
        history.append({'epoch': epoch, 'loss': round(tr_loss, 4),
                        'val_auc': round(val_auc, 4), 'val_eer': round(val_eer, 4)})

        if epoch > WARMUP_EPOCHS and patience_cnt >= PATIENCE:
            print(f"\nEarly stopping at epoch {epoch}")
            break

    # Final test
    ckpt = torch.load('checkpoints/ff_best.pt', map_location=DEVICE, weights_only=False)
    model.load_state_dict(ckpt['state'])
    test_auc, test_acc, test_eer = run_evaluation(model, test_loader)

    print(f"\nFF++ TEST: AUC={test_auc:.4f} ACC={test_acc:.4f} EER={test_eer:.4f}")

    # Export ONNX
    model.eval()
    dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE, device=DEVICE)
    torch.onnx.export(model, dummy, args.output, export_params=True, opset_version=17,
                      input_names=['face_image'], output_names=['logit'],
                      dynamic_axes={'face_image': {0: 'batch'}, 'logit': {0: 'batch'}})
    size_mb = os.path.getsize(args.output) / 1e6

    metadata = {
        'model': 'deepfake_pixel_v2_ff', 'version': '2.0.0',
        'architecture': 'EfficientNet-B4 + FrequencyBranch',
        'fine_tuned_on': 'FaceForensics++',
        'methods': FF_METHODS, 'compressions': FF_COMPRESSIONS,
        'metrics': {'test_auc': round(test_auc, 4), 'test_acc': round(test_acc, 4),
                    'test_eer': round(test_eer, 4)},
        'onnx_size_mb': round(size_mb, 1),
        'exported_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    with open(args.output.replace('.onnx', '_metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)
    with open('checkpoints/ff_history.json', 'w') as f:
        json.dump(history, f, indent=2)

    print(f"\nDONE — {args.output} ({size_mb:.1f}MB)")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Deep-Check FF++ Fine-tuning')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--train', action='store_true')
    parser.add_argument('--eval', action='store_true')
    parser.add_argument('--ff-root', default='./data/FaceForensics++')
    parser.add_argument('--data-dir', default='./data/ff_frames')
    parser.add_argument('--checkpoint', default=None)
    parser.add_argument('--output', default='deepfake_pixel_v2_ff.onnx')
    parser.add_argument('--frames-per-video', type=int, default=30)
    args = parser.parse_args()

    if args.prepare:
        prepare_faceforensics(args.ff_root, args.data_dir, args.frames_per_video)
    elif args.train:
        finetune(args)
    elif args.eval:
        model = DeepfakeDetector(dropout=0.4).to(DEVICE)
        ckpt = torch.load(args.checkpoint, map_location=DEVICE, weights_only=False)
        model.load_state_dict(ckpt.get('state', ckpt))
        test_ds = FFPlusPlusDataset(args.data_dir, 'test')
        loader = DataLoader(test_ds, batch_size=64, shuffle=False, num_workers=4)
        auc, acc, eer = run_evaluation(model, loader)
        print(f"AUC={auc:.4f}  ACC={acc:.4f}  EER={eer:.4f}")
    else:
        parser.print_help()
