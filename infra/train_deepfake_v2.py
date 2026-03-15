#!/usr/bin/env python3
"""
Deep-Check — 3-Stream Deepfake Blendshape CNN v2
=================================================
Trains a three-stream neural network on MediaPipe FaceLandmarker output
(52 blendshapes × N frames) to classify faces as:
  0 = real_human
  1 = deepfake_video
  2 = photo_replay

Three complementary streams fused at the last layer:
  S1 — Temporal stream:    Conv1D → BiGRU → MultiheadAttention → pool
  S2 — Covariance stream:  52×52 correlation matrix → MLP
  S3 — Frequency stream:   Per-feature FFT magnitude → Conv2D → pool

Dataset:
  Real:         VoxCeleb2 test subset (extract_features_mp.py)
  Deepfake:     FaceForensics++ c23 + CelebDF-v2 + DFDC Preview
  Photo replay: VoxCeleb2 stills + custom printed-photo captures

Training:
  python train_deepfake_v2.py [--data-dir ./data/features] [--epochs 100] [--export-only]

Output:
  checkpoints/deepfake_v2_best.pt
  deepfake_v2.onnx           <- copy to public/models/deepfake/

Veritas Engine v2 — Deep-Check
"""

import os
import sys
import json
import time
import argparse
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────

N_BLENDSHAPES = 52
N_FRAMES      = 90
N_CLASSES     = 3
BATCH_SIZE    = 64
LR            = 3e-4
WEIGHT_DECAY  = 1e-4
PATIENCE      = 12
MAX_EPOCHS    = 100

LABELS = ['real_human', 'deepfake_video', 'photo_replay']

# ─── Dataset ─────────────────────────────────────────────────────────────────

class BlendshapeDataset(Dataset):
    """Loads .npz feature files from data_dir/real/, data_dir/fake/, data_dir/photo/"""

    def __init__(self, data_dir: str, split: str = 'train', seq_len: int = N_FRAMES,
                 augment: bool = True):
        self.seq_len = seq_len
        self.augment = augment and split == 'train'
        self.samples: list[tuple[np.ndarray, int]] = []

        label_dirs = [
            (Path(data_dir) / 'real',  0),
            (Path(data_dir) / 'fake',  1),
            (Path(data_dir) / 'photo', 2),
        ]

        for d, label in label_dirs:
            if not d.exists():
                print(f"[data] WARNING: {d} not found — skipping")
                continue
            files = sorted(d.glob('*.npz'))
            # 80/20 split by file
            n_train = int(len(files) * 0.8)
            if split == 'train':
                files = files[:n_train]
            else:
                files = files[n_train:]

            for f in files:
                data = np.load(f)
                feats = data['features']  # shape: (num_frames, 52+)
                # Extract windows of seq_len
                n_frames = feats.shape[0]
                for start in range(0, max(1, n_frames - seq_len + 1), seq_len // 2):
                    window = feats[start:start + seq_len, :N_BLENDSHAPES]
                    if window.shape[0] < seq_len:
                        window = np.pad(window, ((0, seq_len - window.shape[0]), (0, 0)))
                    self.samples.append((window.astype(np.float32), label))

        if not self.samples:
            # Fallback to synthetic data if no real data available
            print("[data] No real data found — generating synthetic dataset for testing")
            self.samples = _generate_synthetic(split)

    def __len__(self): return len(self.samples)

    def __getitem__(self, idx):
        x, y = self.samples[idx]
        x = x.copy()

        if self.augment:
            # Time jitter: shift by +-5 frames
            shift = np.random.randint(-5, 6)
            if shift > 0:
                x = np.concatenate([x[shift:], x[-shift:]])
            elif shift < 0:
                x = np.concatenate([x[:shift], x[shift:]])

            # Amplitude noise
            x += np.random.normal(0, 0.01, x.shape).astype(np.float32)
            x = np.clip(x, 0, 1)

            # Temporal dropout: zero out random 5-frame blocks
            if np.random.random() < 0.3:
                start = np.random.randint(0, self.seq_len - 5)
                x[start:start + 5] = 0

        return torch.from_numpy(x), y


def _generate_synthetic(split: str, n_per_class: int = 4000):
    """Fallback synthetic data when no real recordings exist."""
    rng = np.random.default_rng(42 if split == 'train' else 99)
    samples = []
    n = n_per_class if split == 'train' else n_per_class // 5

    for label in range(3):
        for _ in range(n):
            x = np.zeros((N_FRAMES, N_BLENDSHAPES), dtype=np.float32)
            if label == 0:  # real_human: correlated temporal dynamics
                t = np.linspace(0, 4 * np.pi, N_FRAMES)
                base = np.sin(t + rng.uniform(0, 2 * np.pi)) * 0.15 + 0.05
                for j in range(N_BLENDSHAPES):
                    x[:, j] = np.clip(base * rng.uniform(0.5, 2.0) + rng.normal(0, 0.02, N_FRAMES), 0, 1)
            elif label == 1:  # deepfake_video: smooth but uncorrelated
                for j in range(N_BLENDSHAPES):
                    x[:, j] = np.clip(rng.uniform(0.0, 0.2) + np.cumsum(rng.normal(0, 0.003, N_FRAMES)), 0, 1)
            else:  # photo_replay: near-static
                base = rng.uniform(0, 0.1, N_BLENDSHAPES)
                for j in range(N_BLENDSHAPES):
                    x[:, j] = np.clip(base[j] + rng.normal(0, 0.005, N_FRAMES), 0, 1)
            samples.append((x, label))

    rng.shuffle(samples)
    return samples


# ─── Model — 3-stream CNN ─────────────────────────────────────────────────────

class Stream1Temporal(nn.Module):
    """Temporal: Conv1D + BiGRU + MultiheadAttention"""

    def __init__(self, n_features=N_BLENDSHAPES, hidden=64, out_dim=64):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(n_features, 128, kernel_size=7, padding=3),
            nn.BatchNorm1d(128),
            nn.GELU(),
            nn.Conv1d(128, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.GELU(),
        )
        self.gru = nn.GRU(128, hidden, num_layers=2, batch_first=True,
                          bidirectional=True, dropout=0.3)
        self.attn = nn.MultiheadAttention(hidden * 2, num_heads=4, batch_first=True, dropout=0.1)
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.proj = nn.Linear(hidden * 2, out_dim)

    def forward(self, x):
        # x: (B, T, F) -> (B, F, T) for Conv1D
        x = x.permute(0, 2, 1)
        x = self.conv(x)
        x = x.permute(0, 2, 1)          # (B, T, 128)
        x, _ = self.gru(x)               # (B, T, hidden*2)
        x, _ = self.attn(x, x, x)       # self-attention
        x = x.permute(0, 2, 1)
        x = self.pool(x).squeeze(-1)    # (B, hidden*2)
        return F.gelu(self.proj(x))     # (B, out_dim)


class Stream2Covariance(nn.Module):
    """Covariance matrix stream: 52x52 correlation -> MLP"""

    def __init__(self, n_features=N_BLENDSHAPES, out_dim=64):
        super().__init__()
        # Upper triangle of n_features×n_features: n*(n-1)//2 = 1326 pairs for n=52
        self.n_pairs = n_features * (n_features - 1) // 2
        self.mlp = nn.Sequential(
            nn.Linear(self.n_pairs, 512),
            nn.LayerNorm(512),
            nn.GELU(),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.GELU(),
            nn.Linear(128, out_dim),
        )
        # Pre-compute upper-triangle indices as a static buffer so ONNX export
        # doesn't encounter aten::triu_indices (unsupported in ONNX opset ≤17).
        idx = torch.triu_indices(n_features, n_features, offset=1)
        self.register_buffer('triu_row', idx[0])  # (n_pairs,)
        self.register_buffer('triu_col', idx[1])  # (n_pairs,)

    def forward(self, x):
        # x: (B, T, n_feat) — n_feat name avoids shadowing F=torch.nn.functional
        B, T, _ = x.shape
        # Zero-mean per feature
        xm = x - x.mean(dim=1, keepdim=True)
        # Covariance: (B, n_feat, n_feat)
        cov = torch.bmm(xm.permute(0, 2, 1), xm) / (T - 1 + 1e-6)
        # Normalize to correlation matrix
        std = torch.sqrt(torch.diagonal(cov, dim1=1, dim2=2) + 1e-6)  # (B, n_feat)
        cov = cov / (std.unsqueeze(2) * std.unsqueeze(1) + 1e-6)
        # Extract upper triangle using pre-computed static indices (ONNX-safe)
        flat = cov[:, self.triu_row, self.triu_col]  # (B, n_pairs)
        return F.gelu(self.mlp(flat))


class Stream3Frequency(nn.Module):
    """FFT frequency stream: per-feature magnitude spectrum -> Conv2D"""

    def __init__(self, n_features=N_BLENDSHAPES, n_frames=N_FRAMES, out_dim=64):
        super().__init__()
        self.n_freq = n_frames // 2 + 1  # real FFT output size
        self.conv = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(16),
            nn.GELU(),
            nn.Conv2d(16, 32, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(32),
            nn.GELU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.fc = nn.Linear(32 * 4 * 4, out_dim)

    def forward(self, x):
        # x: (B, T, F)
        x_fft = torch.fft.rfft(x, dim=1)           # (B, n_freq, F) complex
        mag   = x_fft.abs() / (x.shape[1] + 1e-6)  # normalize
        # Reshape to image: (B, 1, n_freq, F)
        mag = mag.unsqueeze(1)
        out = self.conv(mag)
        out = out.flatten(1)
        return F.gelu(self.fc(out))


class DeepfakeV2(nn.Module):
    """3-stream late-fusion deepfake detector"""

    def __init__(self, n_features=N_BLENDSHAPES, n_classes=N_CLASSES, dropout=0.4):
        super().__init__()
        self.s1 = Stream1Temporal(n_features, hidden=64, out_dim=64)
        self.s2 = Stream2Covariance(n_features, out_dim=64)
        self.s3 = Stream3Frequency(n_features, out_dim=64)
        self.head = nn.Sequential(
            nn.Linear(64 * 3, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Linear(64, n_classes),
        )

    def forward(self, x):
        # x: (B, T, F)
        f1 = self.s1(x)
        f2 = self.s2(x)
        f3 = self.s3(x)
        fused = torch.cat([f1, f2, f3], dim=1)
        return self.head(fused)


# ─── Training ─────────────────────────────────────────────────────────────────

def run_validation(model, loader, device):
    """Compute accuracy and per-class metrics on a dataloader."""
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
    report = {}
    for i, name in enumerate(LABELS):
        tp = per_class[i, i]
        fp = per_class[:, i].sum() - tp
        fn = per_class[i, :].sum() - tp
        prec = tp / max(1, tp + fp)
        rec  = tp / max(1, tp + fn)
        f1   = 2 * prec * rec / max(1e-6, prec + rec)
        report[name] = {'precision': float(prec), 'recall': float(rec),
                        'f1': float(f1), 'count': int(per_class[i].sum())}
        print(f"  {name:18s}  P={prec:.3f}  R={rec:.3f}  F1={f1:.3f}  n={per_class[i].sum()}")

    return acc, report


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[train] Using device: {device}")

    train_ds = BlendshapeDataset(args.data_dir, 'train')
    val_ds   = BlendshapeDataset(args.data_dir, 'val', augment=False)
    print(f"[train] Train: {len(train_ds)} samples  |  Val: {len(val_ds)} samples")

    # Balanced sampling
    labels = [s[1] for s in train_ds.samples]
    counts = np.bincount(labels, minlength=N_CLASSES)
    weights = 1.0 / (counts + 1e-6)
    sample_weights = torch.tensor([weights[l] for l in labels])
    sampler = WeightedRandomSampler(sample_weights, len(sample_weights))

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=sampler,
                              num_workers=4, pin_memory=True)
    val_loader   = DataLoader(val_ds, batch_size=BATCH_SIZE * 2, shuffle=False,
                              num_workers=4)

    model = DeepfakeV2().to(device)
    print(f"[train] Parameters: {sum(p.numel() for p in model.parameters()):,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=LR * 10, epochs=MAX_EPOCHS,
        steps_per_epoch=len(train_loader), pct_start=0.1,
    )
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_val_acc = 0.0
    patience_cnt = 0
    os.makedirs('checkpoints', exist_ok=True)

    for epoch in range(1, MAX_EPOCHS + 1):
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
            scheduler.step()

            total_loss += loss.item() * xb.size(0)
            correct    += (logits.argmax(1) == yb).sum().item()
            total      += xb.size(0)

        train_loss = total_loss / total
        train_acc  = correct / total

        val_acc, val_report = run_validation(model, val_loader, device)
        improved = val_acc > best_val_acc
        if improved:
            best_val_acc = val_acc
            torch.save(model.state_dict(), 'checkpoints/deepfake_v2_best.pt')
            patience_cnt = 0
        else:
            patience_cnt += 1

        marker = ' <- best' if improved else ''
        print(f"Epoch {epoch:3d}/{MAX_EPOCHS}  loss={train_loss:.4f}  "
              f"train={train_acc:.3f}  val={val_acc:.3f}{marker}  "
              f"lr={scheduler.get_last_lr()[0]:.2e}")

        if patience_cnt >= PATIENCE:
            print(f"[train] Early stopping at epoch {epoch} (no improvement for {PATIENCE} epochs)")
            break

    print(f"\n[train] Best val accuracy: {best_val_acc:.4f}")
    model.load_state_dict(torch.load('checkpoints/deepfake_v2_best.pt', weights_only=False))
    export_onnx(model, device, args.output)


def export_onnx(model, device, output_path: str = 'deepfake_v2.onnx'):
    model.train(False)
    dummy = torch.zeros(1, N_FRAMES, N_BLENDSHAPES, device=device)

    torch.onnx.export(
        model, dummy, output_path,
        input_names=['blendshapes'],
        output_names=['logits'],
        dynamic_axes={'blendshapes': {0: 'batch_size'}},
        opset_version=17,
    )

    # Verify
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(output_path)
        out  = sess.run(None, {'blendshapes': np.zeros((1, N_FRAMES, N_BLENDSHAPES), np.float32)})
        probs = np.exp(out[0]) / np.exp(out[0]).sum()
        print(f"[export] ONNX verified. Output shape: {out[0].shape}, probs: {probs}")
    except ImportError:
        print("[export] onnxruntime not installed — skipping verification")

    file_size = os.path.getsize(output_path)
    print(f"[export] Saved: {output_path} ({file_size // 1024}KB)")

    # Save metadata
    meta = {
        'model': 'deepfake_v2',
        'architecture': '3-stream-blendshape-cnn',
        'n_blendshapes': N_BLENDSHAPES,
        'n_frames': N_FRAMES,
        'classes': LABELS,
        'streams': ['temporal_conv1d_bigru_attn', 'covariance_52x52', 'fft_frequency'],
        'exported_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    meta_path = output_path.replace('.onnx', '_metadata.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"[export] Metadata: {meta_path}")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir',    default='./data/features', help='Root of feature dataset')
    parser.add_argument('--output',      default='deepfake_v2.onnx')
    parser.add_argument('--epochs',      type=int, default=MAX_EPOCHS)
    parser.add_argument('--batch-size',  type=int, default=BATCH_SIZE)
    parser.add_argument('--export-only', action='store_true', help='Skip training, just export ONNX')
    args = parser.parse_args()

    MAX_EPOCHS = args.epochs
    BATCH_SIZE = args.batch_size

    if args.export_only:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model  = DeepfakeV2().to(device)
        model.load_state_dict(torch.load('checkpoints/deepfake_v2_best.pt', weights_only=False))
        export_onnx(model, device, args.output)
    else:
        train(args)
