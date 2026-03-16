#!/usr/bin/env python3
"""
train_pixel_ec2.py — EfficientNet-B4 deepfake detector (EC2 version)
=====================================================================
Versión adaptada de kaggle_deepfake_notebook.py para instancia EC2
g4dn.2xlarge (T4 16GB).

Datos esperados en /data/:
  /data/kaggle_140k/real_vs_fake/real_vs_fake/{train,valid,test}/{real,fake}/
  /data/celebdf/  — cualquier subdirectorio con imágenes real/fake
  /data/ciplab/real_and_fake_face/training_{real,fake}/

Salida:
  /data/output/pixel/deepfake_pixel_v1.onnx
  /data/output/pixel/deepfake_pixel_v1_metadata.json
  /data/output/pixel/training_history.json

Subida automática a S3:
  s3://$S3_BUCKET/deepfake/deepfake_pixel_v1.onnx
"""

import os
import sys
import json
import time
import random
import subprocess
from pathlib import Path

# Auto-instalar dependencias faltantes
for pkg in ['timm', 'albumentations', 'scikit-learn']:
    try:
        __import__(pkg.replace('-', '_').split('==')[0])
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', pkg],
                       capture_output=True)

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

# ── Seeds ─────────────────────────────────────────────────────────────────────
SEED = 42
torch.manual_seed(SEED); np.random.seed(SEED); random.seed(SEED)
if torch.cuda.is_available(): torch.cuda.manual_seed_all(SEED)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    print(f"GPU: {p.name} | VRAM: {p.total_memory/1e9:.1f}GB")

# ── Config ────────────────────────────────────────────────────────────────────
IMG_SIZE     = 224
BATCH_SIZE   = 48       # g4dn.2xlarge T4 16GB → 48 cabe con AMP
NUM_EPOCHS   = 40       # mas epocas = mejor AUC
LR           = 3e-4
WEIGHT_DECAY = 1e-4
LABEL_SMOOTH = 0.05

S3_BUCKET = os.environ.get('S3_BUCKET', 'deep-check-models')
OUT_DIR   = Path('/data/output/pixel')
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Paths de datos ─────────────────────────────────────────────────────────────
BASE_140K = '/data/kaggle_140k/real_vs_fake/real_vs_fake'
DATA_CONFIG = Path('/data/pixel_dataset_config.json')


def load_data_config() -> dict | None:
    """Lee config generado por prepare_pixel_data.py si existe."""
    if DATA_CONFIG.exists():
        with open(DATA_CONFIG) as f:
            return json.load(f)
    return None


def find_celebdf_dirs():
    """Devuelve (real_dirs, fake_dirs) encontrados en /data/celebdf."""
    base = Path('/data/celebdf')
    real_dirs, fake_dirs = [], []
    if not base.exists():
        return real_dirs, fake_dirs

    real_names = ['real', 'Real', 'Celeb-real', 'real_frames', 'original']
    fake_names = ['fake', 'Fake', 'Celeb-synthesis', 'fake_frames', 'synthesis', 'deepfake']

    # Buscar directamente o en subdirectorios
    for search_path in [base] + list(base.iterdir() if base.exists() else []):
        if not (isinstance(search_path, Path) and search_path.is_dir()):
            continue
        for name in real_names:
            d = search_path / name if search_path != base else base / name
            if d.exists() and any(d.rglob('*.jpg')):
                real_dirs.append(str(d)); break
        for name in fake_names:
            d = search_path / name if search_path != base else base / name
            if d.exists() and any(d.rglob('*.jpg')):
                fake_dirs.append(str(d)); break

    # Fallback: clasificar por nombre de directorio
    if not real_dirs or not fake_dirs:
        for sub in base.rglob('*'):
            if sub.is_dir() and any(sub.glob('*.jpg')):
                n = sub.name.lower()
                if any(k in n for k in ['real', 'original', 'genuine']):
                    real_dirs.append(str(sub))
                elif any(k in n for k in ['fake', 'synth', 'deepfake', 'manipul']):
                    fake_dirs.append(str(sub))

    return list(set(real_dirs)), list(set(fake_dirs))


def build_path_lists():
    """
    Construye listas de directorios real/fake para cada split.
    Prioridad:
      1. /data/pixel_dataset_config.json  (generado por prepare_pixel_data.py)
      2. /data/kaggle_140k/               (dataset Kaggle 140k descargado)
      3. Dataset local en ~/data/frames/  (fallback minimo)
    """
    cfg = load_data_config()
    if cfg:
        print(f"  Usando config: {DATA_CONFIG}")
        return (
            ([cfg['train_real']], [cfg['train_fake']]),
            ([cfg['val_real']],   [cfg['val_fake']]),
            ([cfg['test_real']],  [cfg['test_fake']]),
        )

    # Kaggle 140k
    if Path(f'{BASE_140K}/train/real').exists():
        print(f"  Usando dataset Kaggle 140k: {BASE_140K}")
        ciplab_real = '/data/ciplab/real_and_fake_face/training_real'
        ciplab_fake = '/data/ciplab/real_and_fake_face/training_fake'
        celebdf_real, celebdf_fake = find_celebdf_dirs()
        train_real = [f'{BASE_140K}/train/real'] + celebdf_real
        train_fake = [f'{BASE_140K}/train/fake'] + celebdf_fake
        if Path(ciplab_real).exists(): train_real.append(ciplab_real)
        if Path(ciplab_fake).exists(): train_fake.append(ciplab_fake)
        return (
            (train_real, train_fake),
            ([f'{BASE_140K}/valid/real'], [f'{BASE_140K}/valid/fake']),
            ([f'{BASE_140K}/test/real'],  [f'{BASE_140K}/test/fake']),
        )

    # Fallback: datos locales en ~/data/frames/
    home = Path.home()
    print("  AVISO: Usando datos locales (~/data/frames/) — dataset pequeño")
    return (
        ([str(home / 'data/frames/real')], [str(home / 'data/frames/fake')]),
        ([str(home / 'data/frames/real')], [str(home / 'data/frames/fake')]),
        ([str(home / 'data/frames/real')], [str(home / 'data/frames/fake')]),
    )


# ── Augmentations ─────────────────────────────────────────────────────────────
TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(IMG_SIZE, IMG_SIZE, scale=(0.8, 1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([
        A.ImageCompression(quality_lower=40, quality_upper=95),
        A.GaussianBlur(blur_limit=(3, 7)),
        A.GaussNoise(var_limit=(10, 50)),
    ], p=0.7),
    A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.5),
    A.RandomGamma(gamma_limit=(70, 130), p=0.3),
    A.CoarseDropout(max_holes=4, max_height=20, max_width=20, p=0.3),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])
VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])


# ── Dataset ───────────────────────────────────────────────────────────────────
class FaceDataset(Dataset):
    IMG_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}

    def __init__(self, real_dirs: list, fake_dirs: list, augment: A.Compose):
        self.augment = augment
        self.samples: list = []

        for d in real_dirs:
            p = Path(d)
            if p.exists():
                self.samples.extend([(str(f), 0) for f in p.rglob('*')
                                      if f.suffix.lower() in self.IMG_EXTS])
        for d in fake_dirs:
            p = Path(d)
            if p.exists():
                self.samples.extend([(str(f), 1) for f in p.rglob('*')
                                      if f.suffix.lower() in self.IMG_EXTS])

        random.shuffle(self.samples)
        n_real = sum(1 for _, l in self.samples if l == 0)
        n_fake = sum(1 for _, l in self.samples if l == 1)
        print(f"  Dataset: {n_real:,} real + {n_fake:,} fake = {len(self.samples):,} total")

    def __len__(self): return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = np.array(Image.open(path).convert('RGB'))
        except Exception:
            img = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
        return self.augment(image=img)['image'], torch.tensor(label, dtype=torch.float32)

    def class_weights(self) -> torch.Tensor:
        labels = np.array([l for _, l in self.samples])
        counts = np.bincount(labels)
        per_class = 1.0 / np.maximum(counts, 1)
        return torch.tensor(per_class[labels], dtype=torch.float32)


# ── Model ─────────────────────────────────────────────────────────────────────
class FrequencyBranch(nn.Module):
    def __init__(self, out_dim: int = 32):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(8),
        )
        self.proj = nn.Linear(32 * 8 * 8, out_dim)

    def forward(self, x):
        xf  = F.interpolate(x, size=(64, 64), mode='bilinear', align_corners=False)
        low = F.avg_pool2d(xf, kernel_size=3, stride=1, padding=1)
        return self.proj(self.encoder(xf - low).flatten(1))


class DeepfakeDetector(nn.Module):
    def __init__(self, dropout: float = 0.4):
        super().__init__()
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        feat_dim = self.backbone.num_features  # 1792
        self.freq = FrequencyBranch(out_dim=32)
        self.head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feat_dim + 32, 256),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(256, 1),
        )

    def forward(self, x):
        return self.head(torch.cat([self.backbone(x), self.freq(x)], 1)).squeeze(1)

    @torch.no_grad()
    def predict_proba(self, x): return torch.sigmoid(self.forward(x))


class LabelSmoothBCE(nn.Module):
    def __init__(self, s=0.05): super().__init__(); self.s = s
    def forward(self, logits, targets):
        return F.binary_cross_entropy_with_logits(logits, targets * (1 - self.s) + 0.5 * self.s)


# ── Training helpers ──────────────────────────────────────────────────────────
def train_epoch(model, loader, opt, crit, scaler, sched):
    model.train()
    loss_sum = correct = total = 0
    for imgs, labels in tqdm(loader, desc='Train', leave=False, ncols=80):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs)
            loss   = crit(logits, labels)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt); scaler.update(); sched.step()
        loss_sum += loss.item() * len(labels)
        correct  += ((torch.sigmoid(logits.detach()) > 0.5) == labels.bool()).sum().item()
        total    += len(labels)
    return loss_sum / total, correct / total


@torch.no_grad()
def run_validation(model, loader):
    """Calcula AUC, accuracy y EER sobre un dataloader."""
    model.train(False)  # modo inferencia
    probs_all, labels_all = [], []
    for imgs, labels in tqdm(loader, desc='Valid', leave=False, ncols=80):
        probs_all.extend(model.predict_proba(imgs.to(DEVICE)).cpu().numpy())
        labels_all.extend(labels.numpy())
    model.train()
    y, p = np.array(labels_all), np.array(probs_all)
    auc = roc_auc_score(y, p)
    acc = ((p > 0.5).astype(int) == y.astype(int)).mean()
    fpr, tpr, _ = roc_curve(y, p)
    eer = float(fpr[np.nanargmin(np.abs(1 - tpr - fpr))])
    return auc, acc, eer, p, y


def platt_calibrate(model, loader):
    """Ajusta regresion logistica sobre logits del val set (Platt scaling)."""
    model.train(False)
    logits_all, labels_all = [], []
    with torch.no_grad():
        for imgs, labels in loader:
            logits_all.extend(model(imgs.to(DEVICE)).cpu().numpy())
            labels_all.extend(labels.numpy())
    model.train()
    clf = LogisticRegression(C=1e6, max_iter=2000)
    clf.fit(np.array(logits_all).reshape(-1, 1), np.array(labels_all))
    return clf


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "="*62)
    print("  Deep-Check — Pixel Deepfake Detector (EC2 / EfficientNet-B4)")
    print("="*62)

    (train_dirs, val_dirs, test_dirs) = build_path_lists()

    cfg = load_data_config()
    has_kaggle = Path(f'{BASE_140K}/train/real').exists()
    has_frames = (Path.home() / 'data/frames/real').exists()
    if not cfg and not has_kaggle and not has_frames:
        print("\nERROR: No hay datos disponibles.")
        print("  Opcion 1 (recomendada): python prepare_pixel_data.py --kaggle-user U --kaggle-key K")
        print("  Opcion 2: python prepare_pixel_data.py  (usa datos locales + HuggingFace)")
        sys.exit(1)

    print("\nCargando datasets...")
    train_ds = FaceDataset(*train_dirs, TRAIN_AUG)
    val_ds   = FaceDataset(*val_dirs,   VAL_AUG)
    test_ds  = FaceDataset(*test_dirs,  VAL_AUG)

    if len(train_ds) == 0:
        print("ERROR: Dataset vacio"); sys.exit(1)

    n_workers = min(4, os.cpu_count() or 2)
    sampler   = WeightedRandomSampler(train_ds.class_weights(), len(train_ds))
    train_dl  = DataLoader(train_ds, BATCH_SIZE,   sampler=sampler,
                           num_workers=n_workers, pin_memory=True, persistent_workers=True)
    val_dl    = DataLoader(val_ds,   BATCH_SIZE*2, shuffle=False,
                           num_workers=n_workers, pin_memory=True)
    test_dl   = DataLoader(test_ds,  BATCH_SIZE*2, shuffle=False,
                           num_workers=n_workers, pin_memory=True)

    model = DeepfakeDetector(0.4).to(DEVICE)
    print(f"\nModelo: {sum(p.numel() for p in model.parameters())/1e6:.1f}M parametros")

    crit   = LabelSmoothBCE(LABEL_SMOOTH)
    opt    = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    sched  = torch.optim.lr_scheduler.OneCycleLR(
                opt, max_lr=LR, total_steps=len(train_dl)*NUM_EPOCHS, pct_start=0.1)
    scaler = torch.amp.GradScaler('cuda', enabled=DEVICE.type == 'cuda')

    best_auc  = 0.0
    ckpt_path = OUT_DIR / 'best_model.pt'
    history   = []

    print(f"\nEntrenando {NUM_EPOCHS} epocas (batch={BATCH_SIZE}, workers={n_workers})...\n")

    for epoch in range(NUM_EPOCHS):
        t0 = time.time()
        tr_loss, tr_acc = train_epoch(model, train_dl, opt, crit, scaler, sched)
        val_auc, val_acc, val_eer, _, _ = run_validation(model, val_dl)
        elapsed = time.time() - t0

        print(f"Ep {epoch+1:3d}/{NUM_EPOCHS} | "
              f"loss {tr_loss:.4f} | acc {tr_acc:.3f} | "
              f"val_AUC {val_auc:.4f} | EER {val_eer:.3f} | {elapsed:.0f}s",
              flush=True)

        history.append({'epoch': epoch+1, 'loss': round(tr_loss, 4),
                        'train_acc': round(tr_acc, 4), 'val_auc': round(val_auc, 4),
                        'val_eer': round(val_eer, 4)})

        if val_auc > best_auc:
            best_auc = val_auc
            torch.save({'epoch': epoch+1, 'state': model.state_dict(),
                        'val_auc': val_auc, 'val_eer': val_eer}, ckpt_path)
            print(f"       * Nuevo best AUC: {best_auc:.4f}", flush=True)

        # Checkpoint intermedio a S3 cada 10 epocas
        if (epoch + 1) % 10 == 0:
            subprocess.run([
                'aws', 's3', 'cp', str(ckpt_path),
                f's3://{S3_BUCKET}/deepfake/pixel_checkpoint_ep{epoch+1}.pt'
            ], capture_output=True)
            print(f"       → checkpoint ep{epoch+1} → S3", flush=True)

    # ── Resultados finales ────────────────────────────────────────────────────
    print("\n" + "-"*50)
    model.load_state_dict(torch.load(ckpt_path, map_location=DEVICE)['state'])
    test_auc, test_acc, test_eer, _, _ = run_validation(model, test_dl)
    print(f"\nRESULTADOS TEST:")
    print(f"  AUC:      {test_auc:.4f}   (objetivo: >0.95)")
    print(f"  Accuracy: {test_acc:.4f}")
    print(f"  EER:      {test_eer:.4f}   (objetivo: <0.05)")

    # ── Platt calibration ─────────────────────────────────────────────────────
    print("\nCalibrando (Platt scaling)...")
    platt     = platt_calibrate(model, val_dl)
    coef      = float(platt.coef_[0][0])
    intercept = float(platt.intercept_[0])
    print(f"  coef={coef:.4f}  intercept={intercept:.4f}")

    # ── ONNX export ───────────────────────────────────────────────────────────
    print("\nExportando ONNX...")
    model.train(False)
    dummy     = torch.randn(1, 3, IMG_SIZE, IMG_SIZE, device=DEVICE)
    onnx_path = OUT_DIR / 'deepfake_pixel_v1.onnx'
    torch.onnx.export(model, dummy, str(onnx_path),
        export_params=True, opset_version=17,
        input_names=['face_image'], output_names=['logit'],
        dynamic_axes={'face_image': {0: 'batch'}, 'logit': {0: 'batch'}},
        do_constant_folding=True)
    onnx.checker.check_model(onnx.load(str(onnx_path)))
    size_mb = onnx_path.stat().st_size / 1e6

    # Verificar coherencia PyTorch vs ONNX
    sess    = ort.InferenceSession(str(onnx_path), providers=['CPUExecutionProvider'])
    ort_out = sess.run(None, {'face_image': dummy.cpu().numpy()})[0]
    pt_out  = model(dummy).detach().cpu().numpy()
    diff    = float(np.abs(ort_out - pt_out).max())
    print(f"  ONNX: {size_mb:.1f}MB | diff PyTorch<->ONNX: {diff:.6f} {'OK' if diff < 0.001 else 'WARN'}")

    # ── Metadata ──────────────────────────────────────────────────────────────
    datasets_used = ['xhlulu/140k-real-and-fake-faces (FFHQ+StyleGAN2)']
    if Path('/data/celebdf').exists() and any(Path('/data/celebdf').rglob('*.jpg')):
        datasets_used.append('celeb-df-v2')
    if Path('/data/ciplab/real_and_fake_face').exists():
        datasets_used.append('ciplab/real-and-fake-face-detection')

    metadata = {
        'model': 'deepfake_pixel_v1',
        'architecture': 'EfficientNet-B4 + FrequencyBranch',
        'training_epochs': NUM_EPOCHS,
        'datasets': datasets_used,
        'input': {'shape': [1, 3, 224, 224], 'format': 'ImageNet-normalized RGB CHW'},
        'output': {'name': 'logit', 'interpretation': 'sigmoid(logit) > threshold -> fake'},
        'metrics': {
            'test_auc':      round(test_auc, 4),
            'test_accuracy': round(test_acc, 4),
            'test_eer':      round(test_eer, 4),
        },
        'calibration': {
            'method':    'platt_scaling',
            'apply':     'p_calibrated = sigmoid(coef * logit + intercept)',
            'coef':      coef,
            'intercept': intercept,
        },
        'threshold':    0.5,
        'onnx_size_mb': round(size_mb, 1),
    }
    (OUT_DIR / 'deepfake_pixel_v1_metadata.json').write_text(json.dumps(metadata, indent=2))
    (OUT_DIR / 'training_history.json').write_text(json.dumps(history, indent=2))

    # ── Upload a S3 ───────────────────────────────────────────────────────────
    print(f"\nSubiendo modelos a s3://{S3_BUCKET}/deepfake/...")
    for fname in ['deepfake_pixel_v1.onnx', 'deepfake_pixel_v1_metadata.json',
                  'training_history.json']:
        r = subprocess.run([
            'aws', 's3', 'cp', str(OUT_DIR / fname),
            f's3://{S3_BUCKET}/deepfake/{fname}'
        ], capture_output=True)
        status = 'OK' if r.returncode == 0 else f'FAIL: {r.stderr.decode()[:80]}'
        print(f"  {fname}: {status}")

    print(f"\n{'='*62}")
    print(f"  ENTRENAMIENTO COMPLETO")
    print(f"  Best val AUC:  {best_auc:.4f}")
    print(f"  Test AUC:      {test_auc:.4f}  (antes: 0.42)")
    print(f"  ONNX:          {onnx_path}  ({size_mb:.1f}MB)")
    print(f"  S3:            s3://{S3_BUCKET}/deepfake/deepfake_pixel_v1.onnx")
    print("="*62)


if __name__ == '__main__':
    main()
