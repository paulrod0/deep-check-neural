#!/usr/bin/env python3
"""
train_ai_image_detector.py — General AI-Generated Image Detector
================================================================
Detects ANY AI-generated image (not just faces): Stable Diffusion, DALL-E,
Midjourney, StyleGAN, ProGAN, CycleGAN, and more.

Architecture: EfficientNet-B4 + FrequencyBranchV2 (multi-scale Laplacian)
              Same proven architecture as Deep-Check deepfake v3.

Input:  224x224 RGB images
Output: Binary — P(AI-generated)

Datasets (auto-downloaded from Kaggle):
  1. superpaultolamy/cifake-real-and-ai-generated-synthetic-images  — CIFAKE (60K+60K)
  2. birdy654/synthetic-face-images-dataset-with-real-and-ai         — Synthetic faces
  3. tristanzhang/ai-generated-images-vs-real-images                 — AI vs Real general
  4. cashbowman/ai-generated-images-vs-real-images-2                 — More AI vs Real

Usage:
  python ml/train_ai_image_detector.py                        # Full training
  python ml/train_ai_image_detector.py --epochs 10 --quick    # Quick test
  python ml/train_ai_image_detector.py --skip-download        # Pre-downloaded data
"""

import os, sys, json, time, random, subprocess, argparse, shutil, hashlib
from pathlib import Path
from collections import defaultdict

for pkg in ['timm', 'albumentations', 'scikit-learn', 'kaggle']:
    try:
        __import__(pkg.replace('-', '_').split('==')[0])
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', pkg], capture_output=True)

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
import timm
import albumentations as A
from albumentations.pytorch import ToTensorV2
from sklearn.metrics import roc_auc_score, roc_curve
from PIL import Image

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(it, **kw): return it

# Seeds & Config
SEED = 42
torch.manual_seed(SEED); np.random.seed(SEED); random.seed(SEED)
if torch.cuda.is_available(): torch.cuda.manual_seed_all(SEED)
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

IMG_SIZE     = 224
BATCH_SIZE   = 32
NUM_EPOCHS   = 100
LR           = 3e-4
WEIGHT_DECAY = 1e-4
WARMUP_EPOCHS = 5
PATIENCE     = 20
S3_BUCKET    = os.environ.get('S3_BUCKET', 'deep-check-models')
DATA_DIR     = Path(os.environ.get('DATA_DIR', '/data/ai_image_detector'))
OUT_DIR      = Path(os.environ.get('OUT_DIR', '/data/output/ai_image_detector'))

KAGGLE_DATASETS = [
    ('superpaultolamy/cifake-real-and-ai-generated-synthetic-images', 'cifake', 'train'),
    ('birdy654/synthetic-face-images-dataset-with-real-and-ai', 'synthetic_faces', 'train'),
    ('tristanzhang/ai-generated-images-vs-real-images', 'ai_vs_real', 'train'),
    ('cashbowman/ai-generated-images-vs-real-images-2', 'ai_vs_real_2', 'cross_test'),
]


def download_kaggle_datasets():
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi(); api.authenticate()
    for slug, name, role in KAGGLE_DATASETS:
        dest = DATA_DIR / 'raw' / name
        if dest.exists() and (list(dest.rglob('*.jpg')) or list(dest.rglob('*.png'))):
            n = sum(1 for f in dest.rglob('*') if f.suffix.lower() in {'.jpg','.png','.jpeg'})
            print(f"  [{name}] Already downloaded ({n:,} images)")
            continue
        dest.mkdir(parents=True, exist_ok=True)
        print(f"  [{name}] Downloading {slug}...")
        try:
            api.dataset_download_files(slug, path=str(dest), unzip=True)
            n = sum(1 for f in dest.rglob('*') if f.suffix.lower() in {'.jpg','.png','.jpeg'})
            print(f"  [{name}] OK - {n:,} images")
        except Exception as e:
            print(f"  [{name}] FAILED: {e}")


def find_real_fake_dirs(base: Path):
    real_dirs, fake_dirs = [], []
    real_kw = ['real', 'original', 'genuine', 'authentic', 'natural', 'training_real',
               'real_images', 'real-images', 'REAL']
    fake_kw = ['fake', 'synthetic', 'manipulated', 'ai', 'generated', 'artificial',
               'training_fake', 'fake_images', 'fake-images', 'FAKE', 'ai_generated',
               'sd', 'dalle', 'midjourney', 'stylegan', 'progan', 'cyclegan']
    exts = {'.jpg', '.jpeg', '.png', '.webp'}
    for d in base.rglob('*'):
        if not d.is_dir(): continue
        imgs = [f for f in d.iterdir() if f.is_file() and f.suffix.lower() in exts]
        if len(imgs) < 5: continue
        combined = f"{d.parent.name.lower()}/{d.name.lower()}"
        is_real = any(k.lower() in combined for k in real_kw) and not any(k.lower() in combined for k in fake_kw)
        is_fake = any(k.lower() in combined for k in fake_kw)
        if is_real: real_dirs.append(d)
        elif is_fake: fake_dirs.append(d)
    return real_dirs, fake_dirs


def compute_file_hash(filepath, block_size=65536):
    h = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            for block in iter(lambda: f.read(block_size), b''):
                h.update(block)
    except Exception:
        return filepath
    return h.hexdigest()


def deduplicate_paths(paths):
    seen = set()
    unique = []
    for p in paths:
        h = compute_file_hash(p)
        if h not in seen:
            seen.add(h)
            unique.append(p)
    removed = len(paths) - len(unique)
    if removed > 0:
        print(f"    Dedup: removed {removed:,} duplicates, kept {len(unique):,}")
    return unique


def organize_splits():
    print("\n[2/5] Organizing splits (leak-safe)...")
    splits = {k: {'real': [], 'fake': []} for k in ['train', 'val', 'test', 'cross_test']}
    exts = {'.jpg', '.jpeg', '.png', '.webp'}

    for slug, name, role in KAGGLE_DATASETS:
        raw = DATA_DIR / 'raw' / name
        if not raw.exists():
            print(f"  [{name}] Not found, skipping"); continue

        if role == 'cross_test':
            rdirs, fdirs = find_real_fake_dirs(raw)
            rimgs = [str(f) for d in rdirs for f in d.rglob('*') if f.suffix.lower() in exts]
            fimgs = [str(f) for d in fdirs for f in d.rglob('*') if f.suffix.lower() in exts]
            splits['cross_test']['real'].extend(rimgs)
            splits['cross_test']['fake'].extend(fimgs)
            print(f"  [{name}] {len(rimgs):,}R + {len(fimgs):,}F (cross-test, held out)")
            continue

        # Check for pre-existing train/test splits
        has_preset_splits = False
        for split_name in ['train', 'test']:
            for candidate in raw.rglob(split_name):
                if candidate.is_dir():
                    rdirs_s, fdirs_s = find_real_fake_dirs(candidate)
                    if rdirs_s or fdirs_s: has_preset_splits = True; break
            if has_preset_splits: break

        if has_preset_splits:
            print(f"  [{name}] Using ORIGINAL splits (preventing leak):")
            for split_name, target_split in [('train', 'train'), ('valid', 'val'), ('val', 'val'), ('test', 'test')]:
                for candidate in raw.rglob(split_name):
                    if candidate.is_dir():
                        rdirs_s, fdirs_s = find_real_fake_dirs(candidate)
                        rimgs = [str(f) for d in rdirs_s for f in d.rglob('*') if f.suffix.lower() in exts]
                        fimgs = [str(f) for d in fdirs_s for f in d.rglob('*') if f.suffix.lower() in exts]
                        splits[target_split]['real'].extend(rimgs)
                        splits[target_split]['fake'].extend(fimgs)
                        if rimgs or fimgs:
                            print(f"    {split_name}->{target_split}: {len(rimgs):,}R + {len(fimgs):,}F")
                        break
            continue

        # No preset splits: 80/10/10
        rdirs, fdirs = find_real_fake_dirs(raw)
        if not rdirs and not fdirs:
            print(f"  [{name}] No real/fake directories found, skipping"); continue
        rimgs = [str(f) for d in rdirs for f in d.rglob('*') if f.suffix.lower() in exts]
        fimgs = [str(f) for d in fdirs for f in d.rglob('*') if f.suffix.lower() in exts]
        random.shuffle(rimgs); random.shuffle(fimgs)
        print(f"  [{name}] {len(rimgs):,}R + {len(fimgs):,}F (own 80/10/10 split)")
        for imgs, label in [(rimgs, 'real'), (fimgs, 'fake')]:
            n = len(imgs); nt = int(n * 0.8); nv = int(n * 0.1)
            splits['train'][label].extend(imgs[:nt])
            splits['val'][label].extend(imgs[nt:nt+nv])
            splits['test'][label].extend(imgs[nt+nv:])

    # Hash dedup
    print("\n  === HASH DEDUPLICATION ===")
    for sp in splits:
        for label in ['real', 'fake']:
            if len(splits[sp][label]) > 0:
                splits[sp][label] = deduplicate_paths(splits[sp][label])

    # Leak verification
    print("\n  === LEAK VERIFICATION ===")
    all_train = set(splits['train']['real'] + splits['train']['fake'])
    all_val = set(splits['val']['real'] + splits['val']['fake'])
    all_test = set(splits['test']['real'] + splits['test']['fake'])
    all_cross = set(splits['cross_test']['real'] + splits['cross_test']['fake'])
    leak_tv = len(all_train & all_val)
    leak_tt = len(all_train & all_test)
    leak_tc = len(all_train & all_cross)
    leak_vt = len(all_val & all_test)
    print(f"  train ^ val:   {leak_tv} {'OK' if leak_tv == 0 else 'LEAK!'}")
    print(f"  train ^ test:  {leak_tt} {'OK' if leak_tt == 0 else 'LEAK!'}")
    print(f"  train ^ cross: {leak_tc} {'OK' if leak_tc == 0 else 'LEAK!'}")
    print(f"  val   ^ test:  {leak_vt} {'OK' if leak_vt == 0 else 'LEAK!'}")
    if leak_tv + leak_tt + leak_tc + leak_vt > 0:
        print("  DATA LEAKAGE DETECTED - aborting!"); sys.exit(1)

    for sp, data in splits.items():
        p = DATA_DIR / f'{sp}_real.txt'; p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'w') as f: f.write('\n'.join(data['real']))
        with open(DATA_DIR / f'{sp}_fake.txt', 'w') as f: f.write('\n'.join(data['fake']))
        print(f"  {sp}: {len(data['real']):,}R + {len(data['fake']):,}F")
    manifest = {sp: {l: len(d[l]) for l in ['real', 'fake']} for sp, d in splits.items()}
    with open(DATA_DIR / 'manifest.json', 'w') as f: json.dump(manifest, f, indent=2)
    return splits


# Augmentations
TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.6, 1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([
        A.ImageCompression(quality_range=(10, 95)),
        A.GaussianBlur(blur_limit=(3, 11)),
        A.GaussNoise(std_range=(0.04, 0.4)),
        A.MotionBlur(blur_limit=(3, 9)),
    ], p=0.85),
    A.ColorJitter(brightness=0.4, contrast=0.4, saturation=0.4, hue=0.15, p=0.7),
    A.RandomGamma(gamma_limit=(60, 140), p=0.4),
    A.OneOf([
        A.Downscale(scale_range=(0.25, 0.5)),
        A.Downscale(scale_range=(0.5, 0.75)),
    ], p=0.4),
    A.CoarseDropout(num_holes_range=(1, 6), hole_height_range=(8, 40), hole_width_range=(8, 40), p=0.4),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])
VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ToTensorV2(),
])


class AIImageDataset(Dataset):
    IMG_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
    def __init__(self, real_paths, fake_paths, augment):
        self.augment = augment
        self.samples = [(p, 0) for p in real_paths] + [(p, 1) for p in fake_paths]
        random.shuffle(self.samples)
        self.n_real, self.n_fake = len(real_paths), len(fake_paths)
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = np.array(Image.open(path).convert('RGB'))
            if img.shape[0] < 10 or img.shape[1] < 10 or img.mean() < 1: raise ValueError
        except Exception:
            img = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
        return self.augment(image=img)['image'], torch.tensor(label, dtype=torch.float32)
    def class_weights(self):
        labels = np.array([l for _, l in self.samples])
        counts = np.bincount(labels, minlength=2)
        pc = 1.0 / np.maximum(counts, 1)
        return torch.tensor(pc[labels], dtype=torch.float32)


class FrequencyBranchV2(nn.Module):
    """Multi-scale Laplacian pyramid frequency analysis (3 scales)."""
    def __init__(self, out_dim=48):
        super().__init__()
        self.scales = [32, 64, 128]
        self.encoders = nn.ModuleList([nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1), nn.ReLU(True),
            nn.Conv2d(16, 16, 3, padding=1), nn.ReLU(True),
            nn.AdaptiveAvgPool2d(4),
        ) for _ in range(3)])
        self.proj = nn.Linear(16 * 4 * 4 * 3, out_dim)
    def forward(self, x):
        feats = []
        for i, sz in enumerate(self.scales):
            xf = F.interpolate(x, size=(sz, sz), mode='bilinear', align_corners=False)
            hp = xf - F.avg_pool2d(xf, 3, 1, 1)
            feats.append(self.encoders[i](hp).flatten(1))
        return self.proj(torch.cat(feats, 1))


class AIImageDetector(nn.Module):
    def __init__(self, dropout=0.4):
        super().__init__()
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        fd = self.backbone.num_features
        self.freq = FrequencyBranchV2(out_dim=48)
        self.fused = fd + 48
        self.head = nn.Sequential(
            nn.Dropout(dropout), nn.Linear(self.fused, 256),
            nn.GELU(), nn.Dropout(dropout * 0.5), nn.Linear(256, 1))
    def forward(self, x):
        return self.head(torch.cat([self.backbone(x), self.freq(x)], 1)).squeeze(1)


class FocalLossSmoothed(nn.Module):
    def __init__(self, smooth=0.03, gamma=2.0):
        super().__init__(); self.smooth, self.gamma = smooth, gamma
    def forward(self, logits, targets):
        soft = targets * (1 - self.smooth) + 0.5 * self.smooth
        bce = F.binary_cross_entropy_with_logits(logits, soft, reduction='none')
        pt = targets * torch.sigmoid(logits) + (1 - targets) * (1 - torch.sigmoid(logits))
        return ((1 - pt) ** self.gamma * bce).mean()


def train_epoch(model, loader, opt, crit, scaler, sched, epoch):
    model.train(); ls = c = t = 0
    for imgs, labels in tqdm(loader, desc=f'Train E{epoch+1}', leave=False, ncols=100):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs); loss = crit(logits, labels)
        if torch.isnan(loss): continue
        scaler.scale(loss).backward()
        scaler.unscale_(opt); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt); scaler.update(); sched.step()
        ls += loss.item() * len(labels)
        c += ((torch.sigmoid(logits.detach()) > 0.5) == labels.bool()).sum().item()
        t += len(labels)
    return ls / max(t, 1), c / max(t, 1)


@torch.no_grad()
def validate(model, loader):
    model.eval(); probs_all, labels_all = [], []
    for imgs, labels in tqdm(loader, desc='Val', leave=False, ncols=80):
        imgs = imgs.to(DEVICE)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs)
        probs_all.extend(torch.sigmoid(logits).cpu().numpy().tolist())
        labels_all.extend(labels.numpy().tolist())
    p, l = np.array(probs_all), np.array(labels_all)
    if len(set(l.tolist())) <= 1: return 0.0, 0.0, 1.0
    auc = roc_auc_score(l, p); acc = ((p > 0.5) == l).mean()
    fpr, tpr, _ = roc_curve(l, p); fnr = 1 - tpr
    ei = np.argmin(np.abs(fpr - fnr)); eer = (fpr[ei] + fnr[ei]) / 2
    return float(auc), float(acc), float(eer)


def export_onnx(model, path, img_size=224):
    import onnx, onnxruntime as ort
    model.cpu(); dummy = torch.randn(1, 3, img_size, img_size)
    torch.onnx.export(model, dummy, str(path), export_params=True, opset_version=17,
        input_names=['image'], output_names=['logit'],
        dynamic_axes={'image': {0: 'batch'}, 'logit': {0: 'batch'}}, do_constant_folding=True)
    onnx.checker.check_model(onnx.load(str(path)))
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    ort_out = sess.run(None, {'image': dummy.numpy()})[0]
    pt_out = model(dummy).detach().numpy()
    diff = float(np.abs(ort_out.flatten() - pt_out.flatten()).max())
    print(f"  ONNX drift: {diff:.6f}"); assert diff < 0.01
    mb = path.stat().st_size / 1e6; print(f"  Exported: {path} ({mb:.1f} MB)"); return mb


def upload_s3(local, key):
    r = subprocess.run(['aws', 's3', 'cp', str(local), f's3://{S3_BUCKET}/{key}'], capture_output=True, text=True)
    print(f"  {'OK' if r.returncode == 0 else 'FAIL'}: s3://{S3_BUCKET}/{key}")


def main():
    p = argparse.ArgumentParser(description='Train AI-Generated Image Detector')
    p.add_argument('--epochs', type=int, default=NUM_EPOCHS)
    p.add_argument('--batch-size', type=int, default=BATCH_SIZE)
    p.add_argument('--lr', type=float, default=LR)
    p.add_argument('--skip-download', action='store_true')
    p.add_argument('--quick', action='store_true')
    p.add_argument('--output', type=str, default='ai_image_detector_v1.onnx')
    args = p.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True); DATA_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}\n  Deep-Check AI Image Detector v1 - Training\n{'='*60}")
    print(f"  Device: {DEVICE}")
    if torch.cuda.is_available():
        g = torch.cuda.get_device_properties(0)
        print(f"  GPU: {g.name}")
    print(f"  Epochs: {args.epochs} | Batch: {args.batch_size} | LR: {args.lr}")
    print(f"  Patience: {PATIENCE} | Warmup: {WARMUP_EPOCHS}")

    if not args.skip_download:
        print(f"\n[1/5] Downloading datasets..."); download_kaggle_datasets()
    else:
        print(f"\n[1/5] Skipping download")

    splits = organize_splits()

    print(f"\n[3/5] Creating datasets...")
    mx = 5000 if args.quick else 0
    def lp(sp, lb):
        f = DATA_DIR / f'{sp}_{lb}.txt'
        if f.exists():
            paths = [l.strip() for l in open(f) if l.strip()]
            return paths[:mx] if mx else paths
        return splits.get(sp, {}).get(lb, [])

    train_ds = AIImageDataset(lp('train', 'real'), lp('train', 'fake'), TRAIN_AUG)
    val_ds = AIImageDataset(lp('val', 'real'), lp('val', 'fake'), VAL_AUG)
    test_ds = AIImageDataset(lp('test', 'real'), lp('test', 'fake'), VAL_AUG)
    cross_ds = AIImageDataset(lp('cross_test', 'real'), lp('cross_test', 'fake'), VAL_AUG)
    print(f"  Train:{len(train_ds):,} Val:{len(val_ds):,} Test:{len(test_ds):,} Cross:{len(cross_ds):,}")
    if len(train_ds) == 0: print("ERROR: Empty dataset!"); sys.exit(1)

    sampler = WeightedRandomSampler(train_ds.class_weights(), len(train_ds), replacement=True)
    nw = min(4, os.cpu_count() or 2)
    tl = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=nw, pin_memory=True, drop_last=True)
    vl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=nw, pin_memory=True)
    tel = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True)
    cl = DataLoader(cross_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True) if len(cross_ds) > 0 else None

    print(f"\n[4/5] Building model...")
    model = AIImageDetector(dropout=0.4).to(DEVICE)
    np_total = sum(pp.numel() for pp in model.parameters())
    print(f"  Params: {np_total:,} ({np_total/1e6:.1f}M)")

    bb_params = list(model.backbone.parameters())
    other_params = [pp for n, pp in model.named_parameters() if 'backbone' not in n]
    criterion = FocalLossSmoothed(smooth=0.03, gamma=2.0)
    scaler = torch.amp.GradScaler()

    print(f"\n[5/5] Training...")
    best_auc = best_ep = no_imp = 0; onnx_path = OUT_DIR / args.output

    for ep in range(args.epochs):
        t0 = time.time()
        if ep < WARMUP_EPOCHS:
            for pp in bb_params: pp.requires_grad = False
            opt = torch.optim.AdamW(other_params, lr=args.lr, weight_decay=WEIGHT_DECAY)
        elif ep == WARMUP_EPOCHS:
            for pp in bb_params: pp.requires_grad = True
            opt = torch.optim.AdamW([
                {'params': bb_params, 'lr': args.lr * 0.03},
                {'params': other_params, 'lr': args.lr},
            ], weight_decay=WEIGHT_DECAY)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, steps_per_epoch=len(tl), epochs=1, pct_start=0.1)
        tl_loss, tl_acc = train_epoch(model, tl, opt, criterion, scaler, sched, ep)
        va, vacc, veer = validate(model, vl)
        ca = 0
        if cl and (ep + 1) % 5 == 0: ca, _, _ = validate(model, cl)
        ph = "warmup" if ep < WARMUP_EPOCHS else "ft"
        log = f"[E{ep+1:03d}/{args.epochs}] ({ph}) loss={tl_loss:.4f} acc={tl_acc:.3f} | val_auc={va:.6f} eer={veer:.4f}"
        if ca: log += f" | cross={ca:.4f}"
        log += f" | {time.time()-t0:.0f}s"; print(log)
        with open(OUT_DIR / 'history.jsonl', 'a') as f:
            f.write(json.dumps({'ep': ep+1, 'loss': tl_loss, 'acc': tl_acc, 'auc': va, 'eer': veer, 'cross': ca, 't': time.strftime('%H:%M:%S')}) + '\n')
        if va > best_auc:
            best_auc = va; best_ep = ep + 1; no_imp = 0
            torch.save(model.state_dict(), OUT_DIR / 'best.pt'); print(f"  >> New best AUC={va:.6f}")
        else:
            no_imp += 1
            if no_imp >= PATIENCE: print(f"  Early stop (patience={PATIENCE})"); break
        if (ep + 1) % 25 == 0:
            upload_s3(OUT_DIR / 'best.pt', f'ai_image_detector/checkpoint_ep{ep+1}.pt')
            upload_s3(OUT_DIR / 'history.jsonl', 'ai_image_detector/history.jsonl')

    print(f"\n{'='*60}\n  Best AUC={best_auc:.6f} @ epoch {best_ep}\n{'='*60}")
    model.load_state_dict(torch.load(OUT_DIR / 'best.pt', weights_only=False))
    ta, tacc, teer = validate(model, tel)
    print(f"  Test:  AUC={ta:.6f} Acc={tacc:.3f} EER={teer:.4f}")
    cx_auc = cx_eer = 0
    if cl: cx_auc, _, cx_eer = validate(model, cl); print(f"  Cross: AUC={cx_auc:.6f} EER={cx_eer:.4f}")

    print("\nExporting ONNX..."); mb = export_onnx(model, onnx_path)
    print("\nUploading to S3...")
    upload_s3(onnx_path, f'ai_image_detector/{args.output}')
    upload_s3(OUT_DIR / 'history.jsonl', 'ai_image_detector/history.jsonl')
    upload_s3(OUT_DIR / 'best.pt', 'ai_image_detector/best.pt')
    meta = {'v': '1', 'model': 'ai_image_detector_v1', 'arch': 'EfficientNet-B4 + FrequencyBranchV2',
            'task': 'General AI-generated image detection', 'best_auc': best_auc, 'test_auc': ta,
            'cross_auc': cx_auc, 'test_eer': teer, 'cross_eer': cx_eer, 'epochs_trained': best_ep,
            'datasets': [s for s, _, r in KAGGLE_DATASETS if r == 'train'],
            'cross_test_datasets': [s for s, _, r in KAGGLE_DATASETS if r == 'cross_test'],
            'onnx_mb': mb, 'input': {'name': 'image', 'shape': [1, 3, 224, 224], 'format': 'ImageNet-normalized RGB CHW'},
            'output': {'name': 'logit', 'interpretation': 'sigmoid(logit) > 0.5 -> AI-generated'},
            'ts': time.strftime('%Y-%m-%dT%H:%M:%S')}
    with open(OUT_DIR / 'meta.json', 'w') as f: json.dump(meta, f, indent=2)
    upload_s3(OUT_DIR / 'meta.json', 'ai_image_detector/meta.json')
    print(f"\n  Done! Model: s3://{S3_BUCKET}/ai_image_detector/{args.output}")

if __name__ == '__main__':
    main()
