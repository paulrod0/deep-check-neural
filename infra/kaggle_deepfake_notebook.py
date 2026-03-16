#!/usr/bin/env python3
"""
kaggle_deepfake_notebook.py
============================
Deep-Check — Face Deepfake Detector (EfficientNet-B4, pixel-based)

CÓMO USAR EN KAGGLE (gratis, T4 GPU):
  1. Ir a https://www.kaggle.com/code → New Notebook
  2. File → Upload Notebook → subir este archivo
  3. Settings → Accelerator → GPU T4 x2
  4. Add Data → Search "140k real and fake faces" → Add
  5. Add Data → Search "real-and-fake-face-detection" → Add (opcional)
  6. Run All → ~90 minutos → AUC esperado: 0.94-0.97
  7. Output: deepfake_pixel_v1.onnx

DATASETS (ya en Kaggle, sin descargar nada):
  - xhlulu/140k-real-and-fake-faces  (70k FFHQ + 70k StyleGAN2)
  - ciplab/real-and-fake-face-detection  (opcional, 3 niveles dificultad)

Arquitectura:
  EfficientNet-B4 (ImageNet pretrained) + rama frecuencial (artefactos GAN)
  Loss: BCE con label smoothing 0.05
  Calibración: Platt scaling post-entrenamiento
  Métrica: AUC-ROC + EER
"""

import subprocess
import sys

# Instalar dependencias adicionales en Kaggle
PACKAGES = ['timm', 'albumentations', 'onnx', 'onnxruntime', 'scikit-learn']
for pkg in PACKAGES:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', pkg],
                   capture_output=True)

import os
import json
import time
import random
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
import timm
import albumentations as A
from albumentations.pytorch import ToTensorV2
import onnx
import onnxruntime as ort
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.linear_model import LogisticRegression
from PIL import Image
from tqdm import tqdm

# Semillas para reproducibilidad
torch.manual_seed(42)
np.random.seed(42)
random.seed(42)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(42)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print(f"GPU: {props.name} | VRAM: {props.total_memory/1e9:.1f}GB")

# ── Configuración ─────────────────────────────────────────────────────────────

IMG_SIZE     = 224
BATCH_SIZE   = 32      # T4 16GB → puede subir a 48
NUM_EPOCHS   = 30
LR           = 3e-4
WEIGHT_DECAY = 1e-4
LABEL_SMOOTH = 0.05

# Paths en Kaggle — ajustar si se usa localmente
BASE_140K = '/kaggle/input/140k-real-and-fake-faces/real_vs_fake/real_vs_fake'
PATHS = {
    'train_real': f'{BASE_140K}/train/real',
    'train_fake': f'{BASE_140K}/train/fake',
    'val_real':   f'{BASE_140K}/valid/real',
    'val_fake':   f'{BASE_140K}/valid/fake',
    'test_real':  f'{BASE_140K}/test/real',
    'test_fake':  f'{BASE_140K}/test/fake',
    'ciplab_real': '/kaggle/input/real-and-fake-face-detection/real_and_fake_face/training_real',
    'ciplab_fake': '/kaggle/input/real-and-fake-face-detection/real_and_fake_face/training_fake',
}

OUT_DIR = Path('/kaggle/working')
OUT_DIR.mkdir(exist_ok=True)

# ── Dataset ───────────────────────────────────────────────────────────────────

TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.8, 1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([
        A.ImageCompression(quality_range=(40, 95)),
        A.GaussianBlur(blur_limit=(3, 7)),
        A.GaussNoise(std_range=(0.04, 0.22)),
    ], p=0.7),
    A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.5),
    A.RandomGamma(gamma_limit=(70, 130), p=0.3),
    A.CoarseDropout(num_holes_range=(1, 4), hole_height_range=(10, 20), hole_width_range=(10, 20), p=0.3),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])

VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])


class FaceDataset(Dataset):
    """
    Dataset binario: label 0 = real, label 1 = fake.
    Acepta múltiples directorios por clase para combinar datasets.
    """
    IMG_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}

    def __init__(self, real_dirs: list, fake_dirs: list, augment: A.Compose):
        self.augment = augment
        self.samples: list = []   # (path: str, label: int)

        for d in real_dirs:
            p = Path(d)
            if p.exists():
                added = [(str(f), 0) for f in p.rglob('*')
                         if f.suffix.lower() in self.IMG_EXTS]
                self.samples.extend(added)
        for d in fake_dirs:
            p = Path(d)
            if p.exists():
                added = [(str(f), 1) for f in p.rglob('*')
                         if f.suffix.lower() in self.IMG_EXTS]
                self.samples.extend(added)

        random.shuffle(self.samples)
        n_real = sum(1 for _, l in self.samples if l == 0)
        n_fake = sum(1 for _, l in self.samples if l == 1)
        print(f"  {n_real:,} real + {n_fake:,} fake = {len(self.samples):,} total")

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

    def class_weights(self) -> torch.Tensor:
        """Pesos por muestra para WeightedRandomSampler."""
        labels = np.array([l for _, l in self.samples])
        counts = np.bincount(labels)
        per_class = 1.0 / np.maximum(counts, 1)
        return torch.tensor(per_class[labels], dtype=torch.float32)


# ── Modelo ────────────────────────────────────────────────────────────────────

class FrequencyBranch(nn.Module):
    """
    Rama frecuencial: detecta artefactos GAN/interpolación en alta frecuencia.
    Los deepfakes suelen tener patrones periódicos anómalos en el dominio
    frecuencial que no son visibles a simple vista.
    """
    def __init__(self, out_dim: int = 32):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(16, 32, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(8),
        )
        self.proj = nn.Linear(32 * 8 * 8, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Resize a 64×64 para eficiencia
        xf = F.interpolate(x, size=(64, 64), mode='bilinear', align_corners=False)
        # Residual de alta frecuencia (equivalente a un high-pass filter)
        low = F.avg_pool2d(xf, kernel_size=3, stride=1, padding=1)
        hp  = xf - low
        return self.proj(self.encoder(hp).flatten(1))


class DeepfakeDetector(nn.Module):
    """
    EfficientNet-B4 (spatial) + FrequencyBranch (frequency artifacts)
    → Dropout → FC → logit (sin sigmoid — la aplica BCEWithLogitsLoss)
    """
    def __init__(self, dropout: float = 0.4):
        super().__init__()
        self.backbone = timm.create_model(
            'efficientnet_b4', pretrained=True, num_classes=0
        )
        feat_dim = self.backbone.num_features  # 1792 para B4
        self.freq   = FrequencyBranch(out_dim=32)
        self.head   = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feat_dim + 32, 256),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(256, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        spatial  = self.backbone(x)              # (B, 1792)
        freq     = self.freq(x)                  # (B, 32)
        combined = torch.cat([spatial, freq], 1) # (B, 1824)
        return self.head(combined).squeeze(1)    # (B,) logit

    @torch.no_grad()
    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.forward(x))


# ── Loss ──────────────────────────────────────────────────────────────────────

class LabelSmoothBCE(nn.Module):
    def __init__(self, smoothing: float = 0.05):
        super().__init__()
        self.smoothing = smoothing

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        soft = targets * (1.0 - self.smoothing) + 0.5 * self.smoothing
        return F.binary_cross_entropy_with_logits(logits, soft)


# ── Training helpers ──────────────────────────────────────────────────────────

def train_one_epoch(model, loader, optimizer, criterion, scaler, scheduler):
    model.train()
    running_loss = correct = total = 0

    for imgs, labels in tqdm(loader, desc='Train', leave=False):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        optimizer.zero_grad(set_to_none=True)

        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs)
            loss   = criterion(logits, labels)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)
        scaler.update()
        scheduler.step()

        running_loss += loss.item() * len(labels)
        preds  = (torch.sigmoid(logits.detach()) > 0.5)
        correct += (preds == labels.bool()).sum().item()
        total  += len(labels)

    return running_loss / total, correct / total


@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    all_labels, all_probs = [], []

    for imgs, labels in tqdm(loader, desc='Eval ', leave=False):
        probs = model.predict_proba(imgs.to(DEVICE)).cpu().numpy()
        all_probs.extend(probs)
        all_labels.extend(labels.numpy())

    labels_np = np.array(all_labels)
    probs_np  = np.array(all_probs)

    auc = roc_auc_score(labels_np, probs_np)
    acc = float((probs_np > 0.5) == labels_np).mean() if False else \
          ((probs_np > 0.5).astype(int) == labels_np.astype(int)).mean()

    fpr, tpr, _ = roc_curve(labels_np, probs_np)
    fnr  = 1.0 - tpr
    eer_idx = int(np.nanargmin(np.abs(fnr - fpr)))
    eer  = float(fpr[eer_idx])

    return auc, acc, eer, probs_np, labels_np


def platt_calibrate(model, val_loader):
    """Ajusta regresión logística sobre logits del val set (Platt scaling)."""
    model.eval()
    logits_all, labels_all = [], []

    with torch.no_grad():
        for imgs, labels in val_loader:
            lg = model(imgs.to(DEVICE)).cpu().numpy()
            logits_all.extend(lg)
            labels_all.extend(labels.numpy())

    platt = LogisticRegression(C=1e6, max_iter=2000)
    platt.fit(np.array(logits_all).reshape(-1, 1), np.array(labels_all))
    return platt


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  Deep-Check Face Deepfake Detector — EfficientNet-B4")
    print("═"*60)

    # Datasets
    print("\nCargando datasets...")
    extra_real = [PATHS['ciplab_real']] if Path(PATHS['ciplab_real']).exists() else []
    extra_fake = [PATHS['ciplab_fake']] if Path(PATHS['ciplab_fake']).exists() else []

    train_ds = FaceDataset(
        [PATHS['train_real']] + extra_real,
        [PATHS['train_fake']] + extra_fake,
        TRAIN_AUG
    )
    val_ds  = FaceDataset([PATHS['val_real']],  [PATHS['val_fake']],  VAL_AUG)
    test_ds = FaceDataset([PATHS['test_real']], [PATHS['test_fake']], VAL_AUG)

    sampler = WeightedRandomSampler(train_ds.class_weights(), len(train_ds))
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=sampler,
                              num_workers=2, pin_memory=True, persistent_workers=True)
    val_loader   = DataLoader(val_ds,  batch_size=BATCH_SIZE*2, shuffle=False,
                              num_workers=2, pin_memory=True)
    test_loader  = DataLoader(test_ds, batch_size=BATCH_SIZE*2, shuffle=False,
                              num_workers=2, pin_memory=True)

    # Modelo
    model = DeepfakeDetector(dropout=0.4).to(DEVICE)
    n_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"\nModelo: {n_params:.1f}M parámetros")

    criterion = LabelSmoothBCE(LABEL_SMOOTH)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    total_steps = len(train_loader) * NUM_EPOCHS
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=LR, total_steps=total_steps, pct_start=0.1
    )
    scaler = torch.amp.GradScaler('cuda', enabled=DEVICE.type == 'cuda')

    # Training loop
    best_auc   = 0.0
    ckpt_path  = OUT_DIR / 'best_model.pt'
    history    = []

    print(f"\nEntrenando {NUM_EPOCHS} épocas...\n")
    for epoch in range(NUM_EPOCHS):
        t0 = time.time()
        tr_loss, tr_acc = train_one_epoch(
            model, train_loader, optimizer, criterion, scaler, scheduler
        )
        val_auc, val_acc, val_eer, _, _ = evaluate(model, val_loader)
        elapsed = time.time() - t0

        print(f"Ep {epoch+1:3d}/{NUM_EPOCHS} | "
              f"loss {tr_loss:.4f} | acc {tr_acc:.3f} | "
              f"val_AUC {val_auc:.4f} | EER {val_eer:.3f} | "
              f"{elapsed:.0f}s")

        history.append({
            'epoch': epoch + 1, 'loss': round(tr_loss, 4),
            'train_acc': round(tr_acc, 4), 'val_auc': round(val_auc, 4),
            'val_eer': round(val_eer, 4),
        })

        if val_auc > best_auc:
            best_auc = val_auc
            torch.save({'epoch': epoch+1, 'state': model.state_dict(),
                        'val_auc': val_auc, 'val_eer': val_eer}, ckpt_path)
            print(f"       → Nuevo best AUC: {best_auc:.4f}")

    # Evaluación final
    print("\n" + "─"*50)
    ckpt = torch.load(ckpt_path, map_location=DEVICE)
    model.load_state_dict(ckpt['state'])

    test_auc, test_acc, test_eer, _, _ = evaluate(model, test_loader)
    print(f"\nRESULTADOS TEST:")
    print(f"  AUC:      {test_auc:.4f}   (objetivo: >0.95)")
    print(f"  Accuracy: {test_acc:.4f}   (threshold 0.5)")
    print(f"  EER:      {test_eer:.4f}   (objetivo: <0.05)")

    # Calibración Platt
    print("\nCalibrando (Platt scaling)...")
    platt = platt_calibrate(model, val_loader)
    coef      = float(platt.coef_[0][0])
    intercept = float(platt.intercept_[0])
    print(f"  coef={coef:.4f}  intercept={intercept:.4f}")

    # Export ONNX
    print("\nExportando ONNX...")
    model.eval()
    dummy     = torch.randn(1, 3, IMG_SIZE, IMG_SIZE, device=DEVICE)
    onnx_path = OUT_DIR / 'deepfake_pixel_v1.onnx'

    torch.onnx.export(
        model, dummy, str(onnx_path),
        export_params=True, opset_version=17,
        input_names=['face_image'], output_names=['logit'],
        dynamic_axes={'face_image': {0: 'batch'}, 'logit': {0: 'batch'}},
        do_constant_folding=True,
    )
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    size_mb = onnx_path.stat().st_size / 1e6

    # Verificar output
    sess    = ort.InferenceSession(str(onnx_path))
    ort_out = sess.run(None, {'face_image': dummy.cpu().numpy()})[0]
    pt_out  = model(dummy).detach().cpu().numpy()
    diff    = float(np.abs(ort_out - pt_out).max())
    print(f"  ONNX: {size_mb:.1f}MB | PyTorch vs ONNX diff: {diff:.6f} {'✅' if diff < 0.001 else '⚠️'}")

    # Metadata
    metadata = {
        'model': 'deepfake_pixel_v1',
        'architecture': 'EfficientNet-B4 + FrequencyBranch',
        'input': {'shape': [1, 3, 224, 224], 'format': 'ImageNet-normalized RGB'},
        'output': {'name': 'logit', 'interpretation': 'sigmoid(logit) > 0.5 → fake'},
        'metrics': {
            'test_auc': round(test_auc, 4),
            'test_accuracy': round(test_acc, 4),
            'test_eer': round(test_eer, 4),
        },
        'calibration': {
            'method': 'platt_scaling',
            'apply': 'p_calibrated = sigmoid(coef * logit + intercept)',
            'coef': coef,
            'intercept': intercept,
        },
        'datasets': ['140k-real-and-fake-faces (FFHQ + StyleGAN2)', 'ciplab (if available)'],
        'onnx_size_mb': round(size_mb, 1),
    }

    (OUT_DIR / 'deepfake_pixel_v1_metadata.json').write_text(json.dumps(metadata, indent=2))
    (OUT_DIR / 'training_history.json').write_text(json.dumps(history, indent=2))

    print(f"\n{'═'*60}")
    print(f"  DONE — Best val AUC: {best_auc:.4f}")
    print(f"  Archivos en /kaggle/working/:")
    print(f"    deepfake_pixel_v1.onnx           ({size_mb:.1f}MB)")
    print(f"    deepfake_pixel_v1_metadata.json")
    print(f"    training_history.json")
    print(f"\n  Mejora esperada sobre v1 (sintético):")
    print(f"    v1: AUC 0.42 → v2: AUC {test_auc:.2f}")
    print("═"*60)


if __name__ == '__main__':
    main()
