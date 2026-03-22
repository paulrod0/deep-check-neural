#!/usr/bin/env python3
"""
train_deepfake_v3.py — Multi-Dataset Deepfake Detector v3
==========================================================
Unified training on ALL attack types: GAN, PhotoShop, morphing, video deepfakes.

Architecture: EfficientNet-B4 (1792-dim) + FrequencyBranchV2 (multi-scale, 48-dim)
              + Contrastive head (128-dim, training only) + Focal + SupCon loss

Datasets (auto-downloaded from Kaggle):
  1. xhlulu/140k-real-and-fake-faces       — StyleGAN2
  2. ciplab/real-and-fake-face-detection    — PhotoShop
  3. kshitizbhargava/deepfake-face-images   — StyleGAN
  4. mayankjha146025/fake-face-images-...   — ProGAN/CycleGAN/StarGAN
  5. tbourton/photoshopped-faces            — PhotoShop
  6. phunghieu/deepfake-detection-faces-... — DFDC video frames
  7. sachchitkunichetty/rvf10k              — Cross-domain test (held out)

Usage:
  python ml/train_deepfake_v3.py                          # Full training
  python ml/train_deepfake_v3.py --epochs 10 --quick      # Quick test
  python ml/train_deepfake_v3.py --skip-download          # Pre-downloaded data
"""

import os, sys, json, time, random, subprocess, argparse, shutil
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

SEED = 42
torch.manual_seed(SEED); np.random.seed(SEED); random.seed(SEED)
if torch.cuda.is_available(): torch.cuda.manual_seed_all(SEED)
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

IMG_SIZE     = 224
BATCH_SIZE   = 32
NUM_EPOCHS   = 30
LR           = 3e-4
WEIGHT_DECAY = 1e-4
WARMUP_EPOCHS = 3
PATIENCE     = 10
S3_BUCKET    = os.environ.get('S3_BUCKET', 'deep-check-models')
DATA_DIR     = Path(os.environ.get('DATA_DIR', '/data/deepfake_v3'))
OUT_DIR      = Path(os.environ.get('OUT_DIR', '/data/output/v3'))

KAGGLE_DATASETS = [
    ('xhlulu/140k-real-and-fake-faces', '140k', 'train'),
    ('ciplab/real-and-fake-face-detection', 'ciplab', 'train'),
    ('kshitizbhargava/deepfake-face-images', 'deepfake_imgs', 'train'),
    ('mayankjha146025/fake-face-images-generated-from-different-gans', 'multi_gan', 'train'),
    ('tbourton/photoshopped-faces', 'photoshop', 'train'),
    ('phunghieu/deepfake-detection-faces-sample', 'dfdc_sample', 'train'),
    ('sachchitkunichetty/rvf10k', 'rvf10k', 'cross_test'),
]

# ═══════════════════════════════════════════════════════════════════════
# DATA DOWNLOAD & ORGANIZATION
# ═══════════════════════════════════════════════════════════════════════

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
            print(f"  [{name}] OK — {n:,} images")
        except Exception as e:
            print(f"  [{name}] FAILED: {e}")

def find_real_fake_dirs(base: Path):
    real_dirs, fake_dirs = [], []
    real_kw = ['real','original','genuine','training_real','authentic']
    fake_kw = ['fake','synthetic','manipulated','training_fake','deepfake',
               'stylegan','progan','cyclegan','stargan','gan','photoshop',
               'tampered','morphed','easy_','mid_','hard_']
    for d in base.rglob('*'):
        if not d.is_dir(): continue
        imgs = list(d.glob('*.jpg'))+list(d.glob('*.png'))+list(d.glob('*.jpeg'))
        if len(imgs) < 5: continue
        combined = f"{d.parent.name.lower()}/{d.name.lower()}"
        if any(k in combined for k in real_kw) and not any(k in combined for k in fake_kw):
            real_dirs.append(d)
        elif any(k in combined for k in fake_kw):
            fake_dirs.append(d)
    return real_dirs, fake_dirs

def organize_splits():
    print("\n[2/5] Organizing splits...")
    splits = {k: {'real':[],'fake':[]} for k in ['train','val','test','cross_test']}
    for slug, name, role in KAGGLE_DATASETS:
        raw = DATA_DIR / 'raw' / name
        if not raw.exists(): print(f"  [{name}] Not found"); continue
        rdirs, fdirs = find_real_fake_dirs(raw)
        if not rdirs and not fdirs: continue
        rimgs = [str(f) for d in rdirs for f in d.rglob('*') if f.suffix.lower() in {'.jpg','.jpeg','.png'}]
        fimgs = [str(f) for d in fdirs for f in d.rglob('*') if f.suffix.lower() in {'.jpg','.jpeg','.png'}]
        random.shuffle(rimgs); random.shuffle(fimgs)
        print(f"  [{name}] {len(rimgs):,} real + {len(fimgs):,} fake ({role})")
        if role == 'cross_test':
            splits['cross_test']['real'].extend(rimgs)
            splits['cross_test']['fake'].extend(fimgs)
        else:
            for imgs, label in [(rimgs,'real'),(fimgs,'fake')]:
                n = len(imgs); nt = int(n*0.8); nv = int(n*0.1)
                splits['train'][label].extend(imgs[:nt])
                splits['val'][label].extend(imgs[nt:nt+nv])
                splits['test'][label].extend(imgs[nt+nv:])
    for sp, data in splits.items():
        p = DATA_DIR / f'{sp}_real.txt'; p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'w') as f: f.write('\n'.join(data['real']))
        with open(DATA_DIR / f'{sp}_fake.txt', 'w') as f: f.write('\n'.join(data['fake']))
        print(f"  {sp}: {len(data['real']):,}R + {len(data['fake']):,}F")
    manifest = {sp: {l: len(d[l]) for l in ['real','fake']} for sp, d in splits.items()}
    with open(DATA_DIR/'manifest.json','w') as f: json.dump(manifest, f, indent=2)
    return splits

# ═══════════════════════════════════════════════════════════════════════
# AUGMENTATIONS
# ═══════════════════════════════════════════════════════════════════════

TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE, IMG_SIZE), scale=(0.7, 1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([
        A.ImageCompression(quality_range=(20, 95)),
        A.GaussianBlur(blur_limit=(3, 11)),
        A.GaussNoise(std_range=(0.04, 0.35)),
        A.MotionBlur(blur_limit=(3, 9)),
    ], p=0.85),
    A.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.15, p=0.7),
    A.RandomGamma(gamma_limit=(60, 140), p=0.4),
    A.OneOf([
        A.Downscale(scale_range=(0.25, 0.5)),
        A.Downscale(scale_range=(0.5, 0.75)),
    ], p=0.4),
    A.CoarseDropout(num_holes_range=(1, 6), hole_height_range=(8, 32),
                    hole_width_range=(8, 32), p=0.4),
    A.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]),
    ToTensorV2(),
])
VAL_AUG = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]),
    ToTensorV2(),
])

# ═══════════════════════════════════════════════════════════════════════
# DATASET
# ═══════════════════════════════════════════════════════════════════════

class MultiSourceFaceDataset(Dataset):
    IMG_EXTS = {'.jpg','.jpeg','.png','.webp'}
    def __init__(self, real_paths, fake_paths, augment):
        self.augment = augment
        self.samples = [(p,0) for p in real_paths] + [(p,1) for p in fake_paths]
        random.shuffle(self.samples)
        self.n_real, self.n_fake = len(real_paths), len(fake_paths)
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = np.array(Image.open(path).convert('RGB'))
            if img.shape[0]<10 or img.shape[1]<10 or img.mean()<1: raise ValueError
        except Exception:
            img = np.zeros((IMG_SIZE,IMG_SIZE,3), dtype=np.uint8)
        return self.augment(image=img)['image'], torch.tensor(label, dtype=torch.float32)
    def class_weights(self):
        labels = np.array([l for _,l in self.samples])
        counts = np.bincount(labels, minlength=2)
        pc = 1.0/np.maximum(counts, 1)
        return torch.tensor(pc[labels], dtype=torch.float32)

# ═══════════════════════════════════════════════════════════════════════
# MODEL
# ═══════════════════════════════════════════════════════════════════════

class FrequencyBranchV2(nn.Module):
    """Multi-scale Laplacian pyramid frequency analysis (3 scales)."""
    def __init__(self, out_dim=48):
        super().__init__()
        self.scales = [32, 64, 128]
        self.encoders = nn.ModuleList([nn.Sequential(
            nn.Conv2d(3,16,3,padding=1), nn.ReLU(True),
            nn.Conv2d(16,16,3,padding=1), nn.ReLU(True),
            nn.AdaptiveAvgPool2d(4),
        ) for _ in range(3)])
        self.proj = nn.Linear(16*4*4*3, out_dim)
    def forward(self, x):
        feats = []
        for i, sz in enumerate(self.scales):
            xf = F.interpolate(x, size=(sz,sz), mode='bilinear', align_corners=False)
            hp = xf - F.avg_pool2d(xf, 3, 1, 1)
            feats.append(self.encoders[i](hp).flatten(1))
        return self.proj(torch.cat(feats, 1))

class DeepfakeDetectorV3(nn.Module):
    def __init__(self, dropout=0.4):
        super().__init__()
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        fd = self.backbone.num_features  # 1792
        self.freq = FrequencyBranchV2(out_dim=48)
        self.fused = fd + 48  # 1840
        self.head = nn.Sequential(
            nn.Dropout(dropout), nn.Linear(self.fused, 256),
            nn.GELU(), nn.Dropout(dropout*0.5), nn.Linear(256,1))
        self.contrastive = nn.Sequential(
            nn.Linear(self.fused, 256), nn.ReLU(True), nn.Linear(256, 128))
    def forward(self, x):
        c = torch.cat([self.backbone(x), self.freq(x)], 1)
        return self.head(c).squeeze(1)
    def forward_with_emb(self, x):
        c = torch.cat([self.backbone(x), self.freq(x)], 1)
        return self.head(c).squeeze(1), F.normalize(self.contrastive(c), dim=1)

# ═══════════════════════════════════════════════════════════════════════
# LOSS
# ═══════════════════════════════════════════════════════════════════════

class CompositeLoss(nn.Module):
    def __init__(self, smooth=0.03, gamma=2.0, con_w=0.1, tau=0.07):
        super().__init__()
        self.smooth, self.gamma, self.con_w, self.tau = smooth, gamma, con_w, tau
    def forward(self, logits, targets, emb=None):
        soft = targets*(1-self.smooth)+0.5*self.smooth
        bce = F.binary_cross_entropy_with_logits(logits, soft, reduction='none')
        pt = targets*torch.sigmoid(logits)+(1-targets)*(1-torch.sigmoid(logits))
        loss = ((1-pt)**self.gamma * bce).mean()
        if emb is not None and self.con_w > 0:
            loss = loss + self.con_w * self._supcon(emb, targets)
        return loss
    def _supcon(self, emb, labels):
        sim = torch.mm(emb, emb.t()) / self.tau
        mask = (labels.unsqueeze(0)==labels.unsqueeze(1)).float(); mask.fill_diagonal_(0)
        mx = sim.max(1, keepdim=True).values
        exp = torch.exp(sim - mx)
        den = exp.sum(1, keepdim=True) - exp.diag().unsqueeze(1)
        lp = sim - mx - torch.log(den + 1e-6)
        ps = mask.sum(1)
        l = -(mask * lp).sum(1) / (ps + 1e-6)
        v = ps > 0
        return l[v].mean() if v.any() else torch.tensor(0.0, device=emb.device)

# ═══════════════════════════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════════════════════════

def train_epoch(model, loader, opt, crit, scaler, sched, epoch, warmup):
    model.train(); use_con = epoch >= warmup
    ls = c = t = 0
    for imgs, labels in tqdm(loader, desc=f'Train E{epoch+1}', leave=False, ncols=100):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            if use_con:
                logits, emb = model.forward_with_emb(imgs)
                loss = crit(logits, labels, emb)
            else:
                logits = model(imgs); loss = crit(logits, labels)
        if torch.isnan(loss): continue
        scaler.scale(loss).backward()
        scaler.unscale_(opt); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt); scaler.update(); sched.step()
        ls += loss.item()*len(labels); c += ((torch.sigmoid(logits.detach())>0.5)==labels.bool()).sum().item()
        t += len(labels)
    return ls/max(t,1), c/max(t,1)

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
    auc = roc_auc_score(l, p) if len(set(l.tolist()))>1 else 0
    acc = ((p>0.5)==l).mean()
    fpr, tpr, _ = roc_curve(l, p); fnr = 1-tpr
    ei = np.argmin(np.abs(fpr-fnr)); eer = (fpr[ei]+fnr[ei])/2
    return float(auc), float(acc), float(eer)

# ═══════════════════════════════════════════════════════════════════════
# ONNX EXPORT
# ═══════════════════════════════════════════════════════════════════════

def export_onnx(model, path, img_size=224):
    import onnx, onnxruntime as ort
    model.eval(); model.cpu()
    dummy = torch.randn(1, 3, img_size, img_size)
    torch.onnx.export(model, dummy, str(path), export_params=True, opset_version=17,
        input_names=['face_image'], output_names=['logit'],
        dynamic_axes={'face_image':{0:'batch'},'logit':{0:'batch'}}, do_constant_folding=True)
    onnx.checker.check_model(onnx.load(str(path)))
    sess = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    ort_out = sess.run(None, {'face_image': dummy.numpy()})[0]
    pt_out = model(dummy).detach().numpy()
    diff = float(np.abs(ort_out.flatten()-pt_out.flatten()).max())
    print(f"  ONNX drift: {diff:.6f}")
    assert diff < 0.01
    mb = path.stat().st_size/1e6; print(f"  Exported: {path} ({mb:.1f} MB)")
    return mb

def upload_s3(local, key):
    r = subprocess.run(['aws','s3','cp',str(local),f's3://{S3_BUCKET}/{key}'],capture_output=True,text=True)
    print(f"  {'OK' if r.returncode==0 else 'FAIL'}: s3://{S3_BUCKET}/{key}")

# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--epochs', type=int, default=NUM_EPOCHS)
    p.add_argument('--batch-size', type=int, default=BATCH_SIZE)
    p.add_argument('--lr', type=float, default=LR)
    p.add_argument('--skip-download', action='store_true')
    p.add_argument('--quick', action='store_true')
    p.add_argument('--output', type=str, default='deepfake_pixel_v3.onnx')
    args = p.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}\n  Deep-Check Deepfake v3 — Multi-Dataset Training\n{'='*60}")
    print(f"  Device: {DEVICE}")
    if torch.cuda.is_available():
        g = torch.cuda.get_device_properties(0)
        print(f"  GPU: {g.name} | VRAM: {g.total_mem/1e9:.1f}GB" if hasattr(g,'total_mem') else f"  GPU: {g.name}")
    print(f"  Epochs: {args.epochs} | Batch: {args.batch_size} | LR: {args.lr}")

    if not args.skip_download:
        print(f"\n[1/5] Downloading datasets..."); download_kaggle_datasets()
    else:
        print(f"\n[1/5] Skipping download")

    splits = organize_splits()

    print(f"\n[3/5] Creating datasets...")
    mx = 5000 if args.quick else 0
    def lp(sp, lb):
        f = DATA_DIR/f'{sp}_{lb}.txt'
        if f.exists():
            paths = [l.strip() for l in open(f) if l.strip()]
            return paths[:mx] if mx else paths
        return splits.get(sp,{}).get(lb,[])

    train_ds = MultiSourceFaceDataset(lp('train','real'), lp('train','fake'), TRAIN_AUG)
    val_ds = MultiSourceFaceDataset(lp('val','real'), lp('val','fake'), VAL_AUG)
    test_ds = MultiSourceFaceDataset(lp('test','real'), lp('test','fake'), VAL_AUG)
    cross_ds = MultiSourceFaceDataset(lp('cross_test','real'), lp('cross_test','fake'), VAL_AUG)
    print(f"  Train:{len(train_ds):,} Val:{len(val_ds):,} Test:{len(test_ds):,} Cross:{len(cross_ds):,}")

    sampler = WeightedRandomSampler(train_ds.class_weights(), len(train_ds), replacement=True)
    tl = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=4, pin_memory=True, drop_last=True)
    vl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=4, pin_memory=True)
    tel = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True)
    cl = DataLoader(cross_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True) if len(cross_ds)>0 else None

    print(f"\n[4/5] Building model...")
    model = DeepfakeDetectorV3(dropout=0.4).to(DEVICE)
    np_total = sum(pp.numel() for pp in model.parameters())
    print(f"  Params: {np_total:,} ({np_total/1e6:.1f}M)")

    bb_params = list(model.backbone.parameters())
    other_params = [pp for n,pp in model.named_parameters() if 'backbone' not in n]
    criterion = CompositeLoss(); scaler = torch.amp.GradScaler()

    print(f"\n[5/5] Training...")
    best_auc = best_ep = no_imp = 0; onnx_path = OUT_DIR/args.output

    for ep in range(args.epochs):
        t0 = time.time()
        if ep < WARMUP_EPOCHS:
            for pp in bb_params: pp.requires_grad = False
            opt = torch.optim.AdamW(other_params, lr=args.lr, weight_decay=WEIGHT_DECAY)
        elif ep == WARMUP_EPOCHS:
            for pp in bb_params: pp.requires_grad = True
            opt = torch.optim.AdamW([
                {'params': bb_params, 'lr': args.lr*0.03},
                {'params': other_params, 'lr': args.lr},
            ], weight_decay=WEIGHT_DECAY)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, steps_per_epoch=len(tl), epochs=1, pct_start=0.1)
        tl_loss, tl_acc = train_epoch(model, tl, opt, criterion, scaler, sched, ep, WARMUP_EPOCHS)
        va, vacc, veer = validate(model, vl)
        ca = 0
        if cl and (ep+1)%3==0: ca,_,_ = validate(model, cl)
        ph = "warmup" if ep<WARMUP_EPOCHS else "ft"
        log = f"[E{ep+1:02d}/{args.epochs}] ({ph}) loss={tl_loss:.4f} acc={tl_acc:.3f} | val_auc={va:.4f} eer={veer:.4f}"
        if ca: log += f" | cross={ca:.4f}"
        log += f" | {time.time()-t0:.0f}s"
        print(log)
        with open(OUT_DIR/'history.jsonl','a') as f:
            f.write(json.dumps({'ep':ep+1,'loss':tl_loss,'acc':tl_acc,'auc':va,'eer':veer,'cross':ca,'t':time.strftime('%H:%M:%S')})+'\n')
        if va > best_auc:
            best_auc = va; best_ep = ep+1; no_imp = 0
            torch.save(model.state_dict(), OUT_DIR/'best.pt')
            print(f"  >> New best AUC={va:.4f}")
        else:
            no_imp += 1
            if no_imp >= PATIENCE: print(f"  Early stop (patience={PATIENCE})"); break

    print(f"\n{'='*60}\n  Best AUC={best_auc:.4f} @ epoch {best_ep}\n{'='*60}")
    model.load_state_dict(torch.load(OUT_DIR/'best.pt', weights_only=False))
    ta, tacc, teer = validate(model, tel)
    print(f"  Test:  AUC={ta:.4f} Acc={tacc:.3f} EER={teer:.4f}")
    cx_auc = 0
    if cl: cx_auc,_,ceer = validate(model, cl); print(f"  Cross: AUC={cx_auc:.4f} EER={ceer:.4f}")

    print("\nExporting ONNX..."); mb = export_onnx(model, onnx_path)
    print("\nUploading S3...")
    upload_s3(onnx_path, 'deepfake/deepfake_pixel_v3.onnx')
    upload_s3(OUT_DIR/'history.jsonl', 'deepfake/v3_history.jsonl')
    meta = {'v':'3','arch':'EfficientNet-B4+FreqV2+SupCon','best_auc':best_auc,
            'test_auc':ta,'cross_auc':cx_auc,'test_eer':teer,'epochs':best_ep,
            'datasets':[s for s,_,r in KAGGLE_DATASETS if r=='train'],
            'onnx_mb':mb,'ts':time.strftime('%Y-%m-%dT%H:%M:%S')}
    with open(OUT_DIR/'meta.json','w') as f: json.dump(meta,f,indent=2)
    upload_s3(OUT_DIR/'meta.json', 'deepfake/v3_meta.json')
    print(f"\n  Done! aws s3 cp s3://{S3_BUCKET}/deepfake/deepfake_pixel_v3.onnx .")

if __name__ == '__main__':
    main()
