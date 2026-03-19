#!/usr/bin/env python3
"""
Deep-Check — Priority 2+3: Fine-tune on DFDC + CelebDF-v2
==========================================================
Incremental fine-tuning pipeline. Run AFTER finetune_faceforensics.py.

DFDC (Meta): 100K+ clips, Kaggle competition. Accept rules first.
CelebDF-v2: 590 real + 5,639 fakes. Request via GitHub form (no academic email).

Usage:
  python infra/finetune_dfdc_celebdf.py --prepare --dataset dfdc \
    --raw-dir /data/dfdc_raw --data-dir /data/dfdc_frames

  python infra/finetune_dfdc_celebdf.py --train --dataset dfdc \
    --data-dir /data/dfdc_frames --checkpoint checkpoints/ff_best.pt

  python infra/finetune_dfdc_celebdf.py --train --dataset combined \
    --dfdc-dir /data/dfdc_frames --celebdf-dir /data/celebdf_frames \
    --checkpoint checkpoints/ff_best.pt

Veritas Engine v3 — Deep-Check
"""

import os, sys, json, time, random, argparse
from pathlib import Path
import numpy as np

try:
    import torch, torch.nn as nn, torch.nn.functional as F
    from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler, ConcatDataset
    import timm
    import albumentations as A
    from albumentations.pytorch import ToTensorV2
    from PIL import Image
    from tqdm import tqdm
    from sklearn.metrics import roc_auc_score, roc_curve
    import cv2
except ImportError as e:
    print(f"ERROR: {e}")
    sys.exit(1)

torch.manual_seed(42); np.random.seed(42); random.seed(42)
if torch.cuda.is_available(): torch.cuda.manual_seed_all(42)
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

IMG_SIZE = 224; BATCH_SIZE = 32
LR_HEAD = 1e-4; LR_BACKBONE = 1e-5
WEIGHT_DECAY = 1e-4; LABEL_SMOOTH = 0.03
WARMUP_EPOCHS = 2; MAX_EPOCHS = 30; PATIENCE = 7

# ─── Model ────────────────────────────────────────────────────────────────────

class FrequencyBranch(nn.Module):
    def __init__(self, out_dim=32):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1), nn.ReLU(True),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(True),
            nn.AdaptiveAvgPool2d(8))
        self.proj = nn.Linear(32*8*8, out_dim)
    def forward(self, x):
        xf = F.interpolate(x, size=(64,64), mode='bilinear', align_corners=False)
        return self.proj(self.encoder(xf - F.avg_pool2d(xf, 3, 1, 1)).flatten(1))

class DeepfakeDetector(nn.Module):
    def __init__(self, dropout=0.4):
        super().__init__()
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        fd = self.backbone.num_features
        self.freq = FrequencyBranch(32)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(fd+32,256),
                                  nn.GELU(), nn.Dropout(dropout*0.5), nn.Linear(256,1))
    def forward(self, x):
        return self.head(torch.cat([self.backbone(x), self.freq(x)], 1)).squeeze(1)
    @torch.no_grad()
    def predict_proba(self, x): return torch.sigmoid(self.forward(x))

# ─── Augmentation ─────────────────────────────────────────────────────────────

TRAIN_AUG = A.Compose([
    A.RandomResizedCrop(size=(IMG_SIZE,IMG_SIZE), scale=(0.75,1.0)),
    A.HorizontalFlip(p=0.5),
    A.OneOf([A.ImageCompression(quality_range=(20,95)),
             A.GaussianBlur(blur_limit=(3,9)),
             A.GaussNoise(std_range=(0.04,0.30))], p=0.8),
    A.ColorJitter(0.3,0.3,0.2,0.15, p=0.6),
    A.CoarseDropout(num_holes_range=(1,6), hole_height_range=(8,24),
                    hole_width_range=(8,24), p=0.4),
    A.Normalize([.485,.456,.406],[.229,.224,.225]), ToTensorV2()])
VAL_AUG = A.Compose([A.Resize(IMG_SIZE,IMG_SIZE),
    A.Normalize([.485,.456,.406],[.229,.224,.225]), ToTensorV2()])

# ─── Face extraction ─────────────────────────────────────────────────────────

def extract_faces(video_path, output_dir, max_frames=30, margin=0.3):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened(): return 0
    tot = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if tot <= 0: cap.release(); return 0
    indices = np.linspace(0, tot-1, min(max_frames, tot), dtype=int)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    os.makedirs(output_dir, exist_ok=True)
    saved = 0; stem = Path(video_path).stem
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ret, frame = cap.read()
        if not ret: continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.3, 5, minSize=(64,64))
        if len(faces) > 0:
            x,y,w,h = max(faces, key=lambda f: f[2]*f[3])
            mx,my = int(w*margin), int(h*margin)
            face = frame[max(0,y-my):min(frame.shape[0],y+h+my),
                         max(0,x-mx):min(frame.shape[1],x+w+mx)]
        else:
            hf,wf = frame.shape[:2]; s = min(hf,wf)//2; cx,cy = wf//2, hf//2
            face = frame[cy-s:cy+s, cx-s:cx+s]
        if face.size == 0: continue
        face = cv2.resize(face, (IMG_SIZE, IMG_SIZE))
        cv2.imwrite(os.path.join(output_dir, f"{stem}_f{idx:04d}.jpg"), face,
                    [cv2.IMWRITE_JPEG_QUALITY, 95])
        saved += 1
    cap.release()
    return saved

def prepare_dfdc(raw_dir, output_dir, fpv=20):
    raw_dir, output_dir = Path(raw_dir), Path(output_dir)
    stats = {'real': 0, 'fake': 0}
    for part in sorted(raw_dir.glob('dfdc_train_part_*')):
        meta_file = part / 'metadata.json'
        if not meta_file.exists(): continue
        with open(meta_file) as f: meta = json.load(f)
        print(f"\n  {part.name}...")
        for fn, info in tqdm(meta.items(), desc=part.name, leave=False):
            v = part / fn
            if not v.exists(): continue
            lbl = 'fake' if info.get('label') == 'FAKE' else 'real'
            stats[lbl] += extract_faces(str(v), str(output_dir/lbl/part.name/v.stem), fpv)
    with open(output_dir/'dfdc_stats.json','w') as f: json.dump(stats, f, indent=2)
    print(f"\n  DFDC: {stats['real']:,} real + {stats['fake']:,} fake")

def prepare_celebdf(raw_dir, output_dir, fpv=30):
    raw_dir, output_dir = Path(raw_dir), Path(output_dir)
    stats = {'real': 0, 'fake': 0}
    for src in ['Celeb-real', 'YouTube-real']:
        d = raw_dir / src
        if not d.exists(): continue
        print(f"\n  {src}...")
        for v in tqdm(sorted(d.glob('*.mp4')), desc=src):
            stats['real'] += extract_faces(str(v), str(output_dir/'real'/src/v.stem), fpv)
    synth = raw_dir / 'Celeb-synthesis'
    if synth.exists():
        print(f"\n  Celeb-synthesis...")
        for v in tqdm(sorted(synth.glob('*.mp4')), desc='Synthesis'):
            stats['fake'] += extract_faces(str(v), str(output_dir/'fake'/'synthesis'/v.stem), fpv)
    with open(output_dir/'celebdf_stats.json','w') as f: json.dump(stats, f, indent=2)
    print(f"\n  CelebDF: {stats['real']:,} real + {stats['fake']:,} fake")

# ─── Dataset ──────────────────────────────────────────────────────────────────

class FrameDataset(Dataset):
    EXTS = {'.jpg','.jpeg','.png'}
    def __init__(self, data_dir, split='train', augment=None):
        self.augment = augment or (TRAIN_AUG if split=='train' else VAL_AUG)
        self.samples = []
        data_dir = Path(data_dir)
        for lbl_name, lbl_id in [('real',0),('fake',1)]:
            d = data_dir / lbl_name
            if not d.exists(): continue
            files = [str(f) for f in d.rglob('*') if f.suffix.lower() in self.EXTS]
            random.shuffle(files)
            self.samples.extend([(f, lbl_id) for f in files])
        random.shuffle(self.samples)
        n = len(self.samples)
        if split == 'train': self.samples = self.samples[:int(n*0.8)]
        elif split == 'val': self.samples = self.samples[int(n*0.8):int(n*0.9)]
        else: self.samples = self.samples[int(n*0.9):]
        nr = sum(1 for _,l in self.samples if l==0)
        nf = sum(1 for _,l in self.samples if l==1)
        print(f"  [{split}] {nr:,} real + {nf:,} fake = {len(self.samples):,}")
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try: img = np.array(Image.open(path).convert('RGB'))
        except: img = np.zeros((IMG_SIZE,IMG_SIZE,3), dtype=np.uint8)
        return self.augment(image=img)['image'], torch.tensor(label, dtype=torch.float32)
    def class_weights(self):
        labels = np.array([l for _,l in self.samples])
        counts = np.bincount(labels, minlength=2)
        w = 1.0 / np.maximum(counts, 1)
        return torch.tensor(w[labels], dtype=torch.float32)

# ─── Training ─────────────────────────────────────────────────────────────────

class SmoothBCE(nn.Module):
    def __init__(self, s=0.03): super().__init__(); self.s = s
    def forward(self, logits, targets):
        return F.binary_cross_entropy_with_logits(logits, targets*(1-self.s)+0.5*self.s)

def train_epoch(model, loader, opt, crit, scaler):
    model.train(); lsum=c=t=0
    for imgs, labels in tqdm(loader, desc='Train', leave=False):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type=DEVICE.type, dtype=torch.float16):
            logits = model(imgs); loss = crit(logits, labels)
        scaler.scale(loss).backward()
        scaler.unscale_(opt); nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt); scaler.update()
        lsum += loss.item()*len(labels)
        c += ((torch.sigmoid(logits.detach())>0.5)==labels.bool()).sum().item()
        t += len(labels)
    return lsum/t, c/t

@torch.no_grad()
def run_test(model, loader):
    model.eval(); ys, ps = [], []
    for imgs, labels in tqdm(loader, desc='Test', leave=False):
        ps.extend(model.predict_proba(imgs.to(DEVICE)).cpu().numpy())
        ys.extend(labels.numpy())
    y, p = np.array(ys), np.array(ps)
    auc = roc_auc_score(y, p)
    acc = ((p>0.5).astype(int)==y.astype(int)).mean()
    fpr,tpr,_ = roc_curve(y, p)
    eer = float(fpr[int(np.nanargmin(np.abs(1-tpr-fpr)))])
    return auc, acc, eer

def finetune(args):
    ds_name = args.dataset.upper()
    print(f"\n{'='*60}\n  Deep-Check — {ds_name} Fine-tuning\n  Device: {DEVICE}\n{'='*60}\n")

    if args.dataset == 'combined':
        print("DFDC:"); dt = FrameDataset(args.dfdc_dir,'train'); dv = FrameDataset(args.dfdc_dir,'val')
        print("\nCelebDF:"); ct = FrameDataset(args.celebdf_dir,'train'); cv_ = FrameDataset(args.celebdf_dir,'val')
        train_ds = ConcatDataset([dt, ct]); val_ds = ConcatDataset([dv, cv_])
        test_ds = FrameDataset(args.celebdf_dir, 'test')
        weights = torch.cat([dt.class_weights(), ct.class_weights()])
    else:
        dd = args.dfdc_dir if args.dataset=='dfdc' else args.celebdf_dir
        if not dd: dd = args.data_dir
        train_ds = FrameDataset(dd,'train'); val_ds = FrameDataset(dd,'val')
        test_ds = FrameDataset(dd,'test'); weights = train_ds.class_weights()

    sampler = WeightedRandomSampler(weights, len(weights))
    tl = DataLoader(train_ds, BATCH_SIZE, sampler=sampler, num_workers=4, pin_memory=True)
    vl = DataLoader(val_ds, BATCH_SIZE*2, shuffle=False, num_workers=4)
    el = DataLoader(test_ds, BATCH_SIZE*2, shuffle=False, num_workers=4)

    model = DeepfakeDetector(0.4).to(DEVICE)
    if args.checkpoint and os.path.exists(args.checkpoint):
        ckpt = torch.load(args.checkpoint, map_location=DEVICE, weights_only=False)
        model.load_state_dict(ckpt.get('state', ckpt), strict=False)
        print(f"Loaded {args.checkpoint}")

    for p in model.backbone.parameters(): p.requires_grad = False
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR_HEAD, weight_decay=WEIGHT_DECAY)
    crit = SmoothBCE(LABEL_SMOOTH)
    scaler = torch.amp.GradScaler('cuda', enabled=DEVICE.type=='cuda')
    best_auc = 0.0; pat = 0; os.makedirs('checkpoints', exist_ok=True)
    ckpt_file = f'checkpoints/{args.dataset}_best.pt'
    total = WARMUP_EPOCHS + MAX_EPOCHS; history = []

    for ep in range(1, total+1):
        if ep == WARMUP_EPOCHS+1:
            print("\n--- Full fine-tune ---")
            for p in model.backbone.parameters(): p.requires_grad = True
            opt = torch.optim.AdamW([
                {'params': model.backbone.parameters(), 'lr': LR_BACKBONE},
                {'params': model.freq.parameters(), 'lr': LR_HEAD},
                {'params': model.head.parameters(), 'lr': LR_HEAD}], weight_decay=WEIGHT_DECAY)

        t0 = time.time()
        tl_, ta = train_epoch(model, tl, opt, crit, scaler)
        va, vacc, veer = run_test(model, vl)
        ok = va > best_auc
        if ok:
            best_auc = va; pat = 0
            torch.save({'epoch':ep,'state':model.state_dict(),'val_auc':va,
                        'val_eer':veer,'dataset':args.dataset}, ckpt_file)
        else: pat += 1
        print(f"Ep {ep:3d}/{total} | loss {tl_:.4f} | acc {ta:.3f} | "
              f"AUC {va:.4f} | EER {veer:.3f} | {time.time()-t0:.0f}s{' ★' if ok else ''}")
        history.append({'ep':ep,'loss':round(tl_,4),'auc':round(va,4),'eer':round(veer,4)})
        if ep > WARMUP_EPOCHS and pat >= PATIENCE:
            print(f"\nEarly stop ep {ep}"); break

    ckpt = torch.load(ckpt_file, map_location=DEVICE, weights_only=False)
    model.load_state_dict(ckpt['state'])
    tauc, tacc, teer = run_test(model, el)
    print(f"\n{ds_name} TEST: AUC={tauc:.4f} ACC={tacc:.4f} EER={teer:.4f}")

    model.eval()
    dummy = torch.randn(1,3,IMG_SIZE,IMG_SIZE, device=DEVICE)
    torch.onnx.export(model, dummy, args.output, export_params=True, opset_version=17,
                      input_names=['face_image'], output_names=['logit'],
                      dynamic_axes={'face_image':{0:'batch'},'logit':{0:'batch'}})
    sz = os.path.getsize(args.output)/1e6
    meta = {'model': f'deepfake_pixel_v3_{args.dataset}',
            'arch': 'EfficientNet-B4+FrequencyBranch',
            'chain': f'ImageNet->StyleGAN2->FF++->{ds_name}',
            'metrics': {'auc':round(tauc,4),'acc':round(tacc,4),'eer':round(teer,4)},
            'size_mb': round(sz,1), 'exported': time.strftime('%Y-%m-%dT%H:%M:%SZ')}
    with open(args.output.replace('.onnx','_metadata.json'),'w') as f: json.dump(meta,f,indent=2)
    with open(f'checkpoints/{args.dataset}_history.json','w') as f: json.dump(history,f,indent=2)
    print(f"\nDONE — {args.output} ({sz:.1f}MB)")
    print(f"Chain: ImageNet -> StyleGAN2 -> FF++ -> {ds_name}")

if __name__ == '__main__':
    pa = argparse.ArgumentParser()
    pa.add_argument('--prepare', action='store_true')
    pa.add_argument('--train', action='store_true')
    pa.add_argument('--dataset', choices=['dfdc','celebdf','combined'], default='dfdc')
    pa.add_argument('--raw-dir', default=None)
    pa.add_argument('--data-dir', default=None)
    pa.add_argument('--dfdc-dir', default=None)
    pa.add_argument('--celebdf-dir', default=None)
    pa.add_argument('--checkpoint', default=None)
    pa.add_argument('--output', default='deepfake_pixel_v3.onnx')
    pa.add_argument('--frames-per-video', type=int, default=20)
    args = pa.parse_args()
    if args.prepare:
        if args.dataset == 'dfdc': prepare_dfdc(args.raw_dir, args.data_dir, args.frames_per_video)
        elif args.dataset == 'celebdf': prepare_celebdf(args.raw_dir, args.data_dir, args.frames_per_video)
    elif args.train: finetune(args)
    else: pa.print_help()
