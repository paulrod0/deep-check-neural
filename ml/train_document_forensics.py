#!/usr/bin/env python3
"""
train_document_forensics.py — Document Tampering/Forgery Detector
=================================================================
Detects manipulated document images: Photoshop edits, text changes,
stamp additions, region copy-move, splicing.

Architecture: EfficientNet-B4 + FrequencyBranchV2
Input:  224x224 RGB (document crops)
Output: Binary — P(manipulated)

Hybrid approach:
  1. Download document image datasets from Kaggle
  2. Apply synthetic manipulations (text overlay, stamps, copy-move, splicing)
  3. Same proven training pipeline as deepfake v3

Usage:
  python ml/train_document_forensics.py                        # Full training
  python ml/train_document_forensics.py --epochs 10 --quick    # Quick test
  python ml/train_document_forensics.py --skip-download        # Pre-downloaded
  python ml/train_document_forensics.py --synthetic-only       # Synthetic data only
"""

import os, sys, json, time, random, subprocess, argparse, hashlib
from pathlib import Path

for pkg in ['timm', 'albumentations', 'scikit-learn', 'kaggle', 'opencv-python-headless']:
    try:
        __import__(pkg.replace('-', '_').replace('opencv_python_headless', 'cv2').split('==')[0])
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', pkg], capture_output=True)

import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
import timm
import albumentations as A
from albumentations.pytorch import ToTensorV2
from sklearn.metrics import roc_auc_score, roc_curve
from PIL import Image, ImageDraw, ImageFont

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(it, **kw): return it

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
DATA_DIR     = Path(os.environ.get('DATA_DIR', '/data/document_forensics'))
OUT_DIR      = Path(os.environ.get('OUT_DIR', '/data/output/document_forensics'))

KAGGLE_DATASETS = [
    ('shaz13/real-world-documents-collections', 'real_docs', 'source'),
    ('mrcella22/document-image-dataset', 'doc_images', 'source'),
]


# ═══════════════════════════════════════════════════════════════════════
# SYNTHETIC MANIPULATION ENGINE
# ═══════════════════════════════════════════════════════════════════════

class DocumentManipulator:
    @staticmethod
    def text_overlay(img):
        h, w = img.shape[:2]
        pil = Image.fromarray(img); draw = ImageDraw.Draw(pil)
        texts = ["APPROVED", "VOID", "CONFIDENTIAL", "DRAFT", "COPY",
                 "John Smith", "2024-01-15", "$1,250.00", "REF: 78432",
                 "Invoice #12345", "Agreement", "Signature Required"]
        text = random.choice(texts)
        x = random.randint(10, max(11, w - 100)); y = random.randint(10, max(11, h - 30))
        colors = [(0, 0, 0), (0, 0, 128), (128, 0, 0), (50, 50, 50)]
        try: font = ImageFont.load_default(size=random.randint(12, 28))
        except (TypeError, AttributeError): font = ImageFont.load_default()
        draw.text((x, y), text, fill=random.choice(colors), font=font)
        return np.array(pil)

    @staticmethod
    def stamp_addition(img):
        h, w = img.shape[:2]; overlay = img.copy()
        cx, cy = random.randint(w//4, 3*w//4), random.randint(h//4, 3*h//4)
        radius = random.randint(30, min(80, min(h, w)//4))
        color = random.choice([(200, 30, 30), (30, 30, 200), (30, 150, 30)])
        cv2.circle(overlay, (cx, cy), radius, color, random.randint(2, 4))
        stamp_texts = ["APPROVED", "PAID", "RECEIVED", "OFFICIAL", "VERIFIED"]
        text = random.choice(stamp_texts); font_scale = radius / 60.0
        ts = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)[0]
        cv2.putText(overlay, text, (cx - ts[0]//2, cy + ts[1]//2),
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, 2)
        alpha = random.uniform(0.6, 0.9)
        return cv2.addWeighted(overlay, alpha, img, 1 - alpha, 0)

    @staticmethod
    def region_copy_move(img):
        h, w = img.shape[:2]
        ph, pw = random.randint(20, max(21, h//5)), random.randint(20, max(21, w//5))
        sx, sy = random.randint(0, max(1, w-pw-1)), random.randint(0, max(1, h-ph-1))
        patch = img[sy:sy+ph, sx:sx+pw].copy()
        dx, dy = random.randint(0, max(1, w-pw-1)), random.randint(0, max(1, h-ph-1))
        if random.random() > 0.5: patch = cv2.GaussianBlur(patch, (3, 3), 0)
        result = img.copy(); result[dy:dy+ph, dx:dx+pw] = patch
        return result

    @staticmethod
    def splicing(img, donor=None):
        h, w = img.shape[:2]
        if donor is None: donor = img
        dh, dw = donor.shape[:2]
        ph = random.randint(20, max(21, min(h, dh)//4))
        pw = random.randint(20, max(21, min(w, dw)//4))
        sx, sy = random.randint(0, max(1, dw-pw-1)), random.randint(0, max(1, dh-ph-1))
        patch = donor[sy:sy+ph, sx:sx+pw].copy()
        if patch.shape[:2] != (ph, pw): patch = cv2.resize(patch, (pw, ph))
        dx, dy = random.randint(0, max(1, w-pw-1)), random.randint(0, max(1, h-ph-1))
        result = img.copy()
        mask = np.ones((ph, pw, 3), dtype=np.float32)
        border = min(5, ph//4, pw//4)
        if border > 0:
            for i in range(border):
                alpha = (i + 1) / border
                mask[i, :] *= alpha; mask[-i-1, :] *= alpha
                mask[:, i] *= alpha; mask[:, -i-1] *= alpha
        result[dy:dy+ph, dx:dx+pw] = (
            patch.astype(np.float32) * mask +
            result[dy:dy+ph, dx:dx+pw].astype(np.float32) * (1 - mask)
        ).astype(np.uint8)
        return result

    @staticmethod
    def color_shift_region(img):
        h, w = img.shape[:2]
        rh, rw = random.randint(20, max(21, h//3)), random.randint(20, max(21, w//3))
        rx, ry = random.randint(0, max(1, w-rw-1)), random.randint(0, max(1, h-rh-1))
        result = img.copy()
        region = result[ry:ry+rh, rx:rx+rw].astype(np.float32)
        shift = np.array([random.randint(-30, 30) for _ in range(3)], dtype=np.float32)
        result[ry:ry+rh, rx:rx+rw] = np.clip(region + shift, 0, 255).astype(np.uint8)
        return result

    @staticmethod
    def erase_region(img):
        h, w = img.shape[:2]
        rh, rw = random.randint(10, max(11, h//6)), random.randint(30, max(31, w//3))
        rx, ry = random.randint(0, max(1, w-rw-1)), random.randint(0, max(1, h-rh-1))
        result = img.copy()
        white = np.ones((rh, rw, 3), dtype=np.uint8) * random.randint(240, 255)
        noise = np.random.normal(0, 3, (rh, rw, 3)).astype(np.int16)
        result[ry:ry+rh, rx:rx+rw] = np.clip(white.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        return result

    @classmethod
    def apply_random_manipulation(cls, img, donor=None):
        manipulations = [cls.text_overlay, cls.stamp_addition, cls.region_copy_move,
                         lambda x: cls.splicing(x, donor), cls.color_shift_region, cls.erase_region]
        n_ops = random.randint(1, 3)
        selected = random.sample(manipulations, min(n_ops, len(manipulations)))
        result = img.copy()
        for op in selected:
            try: result = op(result)
            except Exception: pass
        return result


def download_kaggle_datasets():
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi(); api.authenticate()
    for slug, name, role in KAGGLE_DATASETS:
        dest = DATA_DIR / 'raw' / name
        if dest.exists() and (list(dest.rglob('*.jpg')) or list(dest.rglob('*.png'))):
            n = sum(1 for f in dest.rglob('*') if f.suffix.lower() in {'.jpg', '.png', '.jpeg'})
            print(f"  [{name}] Already downloaded ({n:,} images)"); continue
        dest.mkdir(parents=True, exist_ok=True)
        print(f"  [{name}] Downloading {slug}...")
        try:
            api.dataset_download_files(slug, path=str(dest), unzip=True)
            n = sum(1 for f in dest.rglob('*') if f.suffix.lower() in {'.jpg', '.png', '.jpeg'})
            print(f"  [{name}] OK - {n:,} images")
        except Exception as e:
            print(f"  [{name}] FAILED: {e}")


def collect_source_images():
    exts = {'.jpg', '.jpeg', '.png', '.webp'}
    all_images = []
    for slug, name, role in KAGGLE_DATASETS:
        raw = DATA_DIR / 'raw' / name
        if raw.exists():
            imgs = [str(f) for f in raw.rglob('*') if f.suffix.lower() in exts]
            all_images.extend(imgs); print(f"  [{name}] {len(imgs):,} source images")
    return all_images


def generate_synthetic_data(source_images, n_per_class=50000):
    print(f"\n  Generating synthetic data: {n_per_class} per class from {len(source_images)} sources...")
    clean_dir = DATA_DIR / 'synthetic' / 'clean'
    manip_dir = DATA_DIR / 'synthetic' / 'manipulated'
    clean_dir.mkdir(parents=True, exist_ok=True); manip_dir.mkdir(parents=True, exist_ok=True)

    existing_clean = len(list(clean_dir.glob('*.jpg')))
    existing_manip = len(list(manip_dir.glob('*.jpg')))
    if existing_clean >= n_per_class * 0.9 and existing_manip >= n_per_class * 0.9:
        print(f"  Already exists: {existing_clean} clean + {existing_manip} manipulated"); return

    manipulator = DocumentManipulator()
    count_clean = count_manip = 0
    for i in range(n_per_class):
        if i % 5000 == 0 and i > 0: print(f"    Generated {i:,}/{n_per_class:,}...")
        src_path = random.choice(source_images)
        try:
            img = cv2.imread(src_path)
            if img is None: continue
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        except Exception: continue
        img = cv2.resize(img, (random.randint(224, 512), random.randint(224, 512)))
        if img.shape[0] > IMG_SIZE and img.shape[1] > IMG_SIZE:
            cy, cx = random.randint(0, img.shape[0]-IMG_SIZE), random.randint(0, img.shape[1]-IMG_SIZE)
            crop = img[cy:cy+IMG_SIZE, cx:cx+IMG_SIZE]
        else: crop = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
        Image.fromarray(crop).save(str(clean_dir / f'clean_{count_clean:06d}.jpg'), quality=random.randint(85, 98))
        count_clean += 1
        donor_path = random.choice(source_images)
        try:
            donor = cv2.imread(donor_path)
            if donor is not None: donor = cv2.cvtColor(donor, cv2.COLOR_BGR2RGB); donor = cv2.resize(donor, (IMG_SIZE, IMG_SIZE))
            else: donor = None
        except Exception: donor = None
        manip = manipulator.apply_random_manipulation(crop, donor)
        Image.fromarray(manip).save(str(manip_dir / f'manip_{count_manip:06d}.jpg'), quality=random.randint(85, 98))
        count_manip += 1
    print(f"  Generated: {count_clean:,} clean + {count_manip:,} manipulated")


def organize_splits():
    print("\n[3/5] Organizing splits (leak-safe)...")
    clean_dir = DATA_DIR / 'synthetic' / 'clean'
    manip_dir = DATA_DIR / 'synthetic' / 'manipulated'
    exts = {'.jpg', '.jpeg', '.png'}
    clean_imgs = sorted([str(f) for f in clean_dir.rglob('*') if f.suffix.lower() in exts])
    manip_imgs = sorted([str(f) for f in manip_dir.rglob('*') if f.suffix.lower() in exts])
    random.shuffle(clean_imgs); random.shuffle(manip_imgs)
    print(f"  Total: {len(clean_imgs):,} clean + {len(manip_imgs):,} manipulated")

    splits = {k: {'real': [], 'fake': []} for k in ['train', 'val', 'test']}
    for imgs, label in [(clean_imgs, 'real'), (manip_imgs, 'fake')]:
        n = len(imgs); nt = int(n * 0.8); nv = int(n * 0.1)
        splits['train'][label] = imgs[:nt]
        splits['val'][label] = imgs[nt:nt+nv]
        splits['test'][label] = imgs[nt+nv:]

    print("\n  === LEAK VERIFICATION ===")
    all_train = set(splits['train']['real'] + splits['train']['fake'])
    all_val = set(splits['val']['real'] + splits['val']['fake'])
    all_test = set(splits['test']['real'] + splits['test']['fake'])
    leak_tv = len(all_train & all_val); leak_tt = len(all_train & all_test); leak_vt = len(all_val & all_test)
    print(f"  train ^ val:  {leak_tv} {'OK' if leak_tv == 0 else 'LEAK!'}")
    print(f"  train ^ test: {leak_tt} {'OK' if leak_tt == 0 else 'LEAK!'}")
    print(f"  val   ^ test: {leak_vt} {'OK' if leak_vt == 0 else 'LEAK!'}")
    if leak_tv + leak_tt + leak_vt > 0: print("  LEAK DETECTED!"); sys.exit(1)

    for sp, data in splits.items():
        p = DATA_DIR / f'{sp}_real.txt'; p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'w') as f: f.write('\n'.join(data['real']))
        with open(DATA_DIR / f'{sp}_fake.txt', 'w') as f: f.write('\n'.join(data['fake']))
        print(f"  {sp}: {len(data['real']):,} clean + {len(data['fake']):,} manipulated")
    manifest = {sp: {l: len(d[l]) for l in ['real', 'fake']} for sp, d in splits.items()}
    with open(DATA_DIR / 'manifest.json', 'w') as f: json.dump(manifest, f, indent=2)
    return splits


# Augmentations
TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.7, 1.0)),
    A.HorizontalFlip(p=0.3),
    A.Perspective(scale=(0.02, 0.06), p=0.3),
    A.OneOf([A.ImageCompression(quality_range=(20, 95)), A.GaussianBlur(blur_limit=(3, 7)),
             A.GaussNoise(std_range=(0.04, 0.25))], p=0.7),
    A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.5),
    A.RandomGamma(gamma_limit=(70, 130), p=0.3),
    A.OneOf([A.Downscale(scale_range=(0.25, 0.5)), A.Downscale(scale_range=(0.5, 0.75))], p=0.3),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]), ToTensorV2(),
])
VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]), ToTensorV2(),
])


class DocumentForensicsDataset(Dataset):
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
            if img.shape[0] < 10 or img.shape[1] < 10: raise ValueError
        except Exception: img = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
        return self.augment(image=img)['image'], torch.tensor(label, dtype=torch.float32)
    def class_weights(self):
        labels = np.array([l for _, l in self.samples])
        counts = np.bincount(labels, minlength=2); pc = 1.0 / np.maximum(counts, 1)
        return torch.tensor(pc[labels], dtype=torch.float32)


class FrequencyBranchV2(nn.Module):
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


class DocumentForensicsDetector(nn.Module):
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
        input_names=['document_image'], output_names=['logit'],
        dynamic_axes={'document_image': {0: 'batch'}, 'logit': {0: 'batch'}}, do_constant_folding=True)
    onnx.checker.check_model(onnx.load(str(path)))
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    ort_out = sess.run(None, {'document_image': dummy.numpy()})[0]
    pt_out = model(dummy).detach().numpy()
    diff = float(np.abs(ort_out.flatten() - pt_out.flatten()).max())
    print(f"  ONNX drift: {diff:.6f}"); assert diff < 0.01
    mb = path.stat().st_size / 1e6; print(f"  Exported: {path} ({mb:.1f} MB)"); return mb


def upload_s3(local, key):
    r = subprocess.run(['aws', 's3', 'cp', str(local), f's3://{S3_BUCKET}/{key}'], capture_output=True, text=True)
    print(f"  {'OK' if r.returncode == 0 else 'FAIL'}: s3://{S3_BUCKET}/{key}")


def main():
    p = argparse.ArgumentParser(description='Train Document Forensics Detector')
    p.add_argument('--epochs', type=int, default=NUM_EPOCHS)
    p.add_argument('--batch-size', type=int, default=BATCH_SIZE)
    p.add_argument('--lr', type=float, default=LR)
    p.add_argument('--skip-download', action='store_true')
    p.add_argument('--quick', action='store_true')
    p.add_argument('--synthetic-only', action='store_true')
    p.add_argument('--synthetic-samples', type=int, default=50000)
    p.add_argument('--output', type=str, default='document_forensics_v1.onnx')
    args = p.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True); DATA_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}\n  Deep-Check Document Forensics Detector v1 - Training\n{'='*60}")
    print(f"  Device: {DEVICE}")
    if torch.cuda.is_available():
        g = torch.cuda.get_device_properties(0); print(f"  GPU: {g.name}")
    print(f"  Epochs: {args.epochs} | Batch: {args.batch_size} | LR: {args.lr}")

    if not args.skip_download:
        print(f"\n[1/5] Downloading document datasets..."); download_kaggle_datasets()
    else: print(f"\n[1/5] Skipping download")

    print(f"\n[2/5] Generating synthetic manipulations...")
    source_images = collect_source_images()
    n_samples = 5000 if args.quick else args.synthetic_samples
    if len(source_images) == 0:
        print("  WARNING: No source images. Generating from noise as fallback.")
        fallback_dir = DATA_DIR / 'raw' / 'fallback'
        fallback_dir.mkdir(parents=True, exist_ok=True)
        for i in range(1000):
            img = np.random.randint(200, 256, (256, 256, 3), dtype=np.uint8)
            for _ in range(random.randint(5, 15)):
                y = random.randint(20, 240)
                cv2.line(img, (20, y), (random.randint(100, 240), y), (0, 0, 0), 1)
            Image.fromarray(img).save(str(fallback_dir / f'doc_{i:04d}.jpg'))
        source_images = [str(f) for f in fallback_dir.glob('*.jpg')]
    generate_synthetic_data(source_images, n_per_class=n_samples)

    splits = organize_splits()

    print(f"\n[4/5] Creating datasets...")
    mx = 5000 if args.quick else 0
    def lp(sp, lb):
        f = DATA_DIR / f'{sp}_{lb}.txt'
        if f.exists():
            paths = [l.strip() for l in open(f) if l.strip()]
            return paths[:mx] if mx else paths
        return splits.get(sp, {}).get(lb, [])

    train_ds = DocumentForensicsDataset(lp('train', 'real'), lp('train', 'fake'), TRAIN_AUG)
    val_ds = DocumentForensicsDataset(lp('val', 'real'), lp('val', 'fake'), VAL_AUG)
    test_ds = DocumentForensicsDataset(lp('test', 'real'), lp('test', 'fake'), VAL_AUG)
    print(f"  Train:{len(train_ds):,} Val:{len(val_ds):,} Test:{len(test_ds):,}")
    if len(train_ds) == 0: print("ERROR: Empty dataset!"); sys.exit(1)

    sampler = WeightedRandomSampler(train_ds.class_weights(), len(train_ds), replacement=True)
    nw = min(4, os.cpu_count() or 2)
    tl = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=nw, pin_memory=True, drop_last=True)
    vl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=nw, pin_memory=True)
    tel = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True)

    print(f"\n[5/5] Building model & training...")
    model = DocumentForensicsDetector(dropout=0.4).to(DEVICE)
    np_total = sum(pp.numel() for pp in model.parameters())
    print(f"  Params: {np_total:,} ({np_total/1e6:.1f}M)")

    bb_params = list(model.backbone.parameters())
    other_params = [pp for n, pp in model.named_parameters() if 'backbone' not in n]
    criterion = FocalLossSmoothed(smooth=0.03, gamma=2.0)
    scaler = torch.amp.GradScaler()
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
        ph = "warmup" if ep < WARMUP_EPOCHS else "ft"
        log = f"[E{ep+1:03d}/{args.epochs}] ({ph}) loss={tl_loss:.4f} acc={tl_acc:.3f} | val_auc={va:.6f} eer={veer:.4f} | {time.time()-t0:.0f}s"
        print(log)
        with open(OUT_DIR / 'history.jsonl', 'a') as f:
            f.write(json.dumps({'ep': ep+1, 'loss': tl_loss, 'acc': tl_acc, 'auc': va, 'eer': veer, 't': time.strftime('%H:%M:%S')}) + '\n')
        if va > best_auc:
            best_auc = va; best_ep = ep + 1; no_imp = 0
            torch.save(model.state_dict(), OUT_DIR / 'best.pt'); print(f"  >> New best AUC={va:.6f}")
        else:
            no_imp += 1
            if no_imp >= PATIENCE: print(f"  Early stop (patience={PATIENCE})"); break
        if (ep + 1) % 25 == 0:
            upload_s3(OUT_DIR / 'best.pt', f'document_forensics/checkpoint_ep{ep+1}.pt')

    print(f"\n{'='*60}\n  Best AUC={best_auc:.6f} @ epoch {best_ep}\n{'='*60}")
    model.load_state_dict(torch.load(OUT_DIR / 'best.pt', weights_only=False))
    ta, tacc, teer = validate(model, tel)
    print(f"  Test:  AUC={ta:.6f} Acc={tacc:.3f} EER={teer:.4f}")

    print("\nExporting ONNX..."); mb = export_onnx(model, onnx_path)
    print("\nUploading to S3...")
    upload_s3(onnx_path, f'document_forensics/{args.output}')
    upload_s3(OUT_DIR / 'history.jsonl', 'document_forensics/history.jsonl')
    upload_s3(OUT_DIR / 'best.pt', 'document_forensics/best.pt')
    meta = {'v': '1', 'model': 'document_forensics_v1', 'arch': 'EfficientNet-B4 + FrequencyBranchV2',
            'task': 'Document tampering detection', 'best_auc': best_auc, 'test_auc': ta,
            'test_eer': teer, 'epochs_trained': best_ep,
            'synthetic_samples': args.synthetic_samples,
            'manipulations': ['text_overlay', 'stamp_addition', 'region_copy_move',
                             'splicing', 'color_shift_region', 'erase_region'],
            'onnx_mb': mb, 'input': {'name': 'document_image', 'shape': [1, 3, 224, 224],
                                      'format': 'ImageNet-normalized RGB CHW'},
            'output': {'name': 'logit', 'interpretation': 'sigmoid(logit) > 0.5 -> manipulated'},
            'ts': time.strftime('%Y-%m-%dT%H:%M:%S')}
    with open(OUT_DIR / 'meta.json', 'w') as f: json.dump(meta, f, indent=2)
    upload_s3(OUT_DIR / 'meta.json', 'document_forensics/meta.json')
    print(f"\n  Done! Model: s3://{S3_BUCKET}/document_forensics/{args.output}")

if __name__ == '__main__':
    main()
