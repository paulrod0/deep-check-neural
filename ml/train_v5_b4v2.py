#!/usr/bin/env python3
"""
Deep-Check V5 Training — ANTI-OVERFITTING VERSION
Key fixes:
1. Cross-source validation (train on datasets A,B,C — validate on D,E)
2. Heavy augmentation (JPEG sim, blur, noise, cutout, mixup, color jitter)
3. Strong regularization (dropout 0.5, weight decay 0.1, EMA, label smoothing 0.1)
4. Hash-based dedup across ALL sets
"""

import os, sys, time, hashlib, logging, json, io, random
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Tuple, Dict
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

@dataclass
class C:
    SZ: int = 224
    BS: int = 64           # Bigger batch for stable gradients
    EPOCHS: int = 150
    LR_BB: float = 1e-3    # Backbone LR — 10x higher
    LR_HEAD: float = 3e-3  # Head LR — 3x higher
    WD: float = 0.05       # Less WD to learn faster
    DROPOUT: float = 0.4   # Less dropout
    LABEL_SMOOTH: float = 0.1
    MIXUP_ALPHA: float = 0.3
    CUTMIX_ALPHA: float = 1.0
    MIXUP_PROB: float = 0.5
    EMA_DECAY: float = 0.9995
    GRAD_CLIP: float = 2.0
    WARMUP: int = 5        # Linear warmup epochs
    WORKERS: int = 4
    DATA: Path = Path("/home/ubuntu/data")
    OUT: Path = Path("/home/ubuntu/training/v5_b4v2")
    METRIC_FILE: str = "metrics.jsonl"
    VAL_SOURCES: list = field(default_factory=lambda: ["lfw", "utkface", "ffhq-stylegan"])

class JPEGCompression:
    def __init__(self, qr=(30, 95)): self.qr = qr
    def __call__(self, img):
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=random.randint(*self.qr))
        buf.seek(0)
        return Image.open(buf).convert('RGB')

class GaussianNoise:
    def __init__(self, sr=(0.01, 0.05)): self.sr = sr
    def __call__(self, img):
        a = np.array(img).astype(np.float32)/255
        a = np.clip(a + np.random.normal(0, random.uniform(*self.sr), a.shape).astype(np.float32), 0, 1)
        return Image.fromarray((a*255).astype(np.uint8))

class RandomDownUp:
    def __init__(self, sr=(0.25, 0.75)): self.sr = sr
    def __call__(self, img):
        s = random.uniform(*self.sr)
        w, h = img.size
        small = img.resize((max(int(w*s),16), max(int(h*s),16)), Image.BILINEAR)
        return small.resize((w, h), Image.BILINEAR)

def get_train_transform(sz):
    return transforms.Compose([
        transforms.RandomResizedCrop(sz, scale=(0.6, 1.0), ratio=(0.8, 1.2)),
        transforms.RandomHorizontalFlip(0.5),
        transforms.RandomApply([transforms.ColorJitter(0.4, 0.4, 0.4, 0.15)], p=0.6),
        transforms.RandomGrayscale(p=0.15),
        transforms.RandomApply([transforms.GaussianBlur(5, sigma=(0.1, 3.0))], p=0.3),
        transforms.RandomApply([JPEGCompression((20, 85))], p=0.4),
        transforms.RandomApply([GaussianNoise((0.01, 0.06))], p=0.3),
        transforms.RandomApply([RandomDownUp((0.25, 0.6))], p=0.2),
        transforms.RandomRotation(15),
        transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
        transforms.RandomErasing(p=0.25, scale=(0.02, 0.2)),
    ])

def get_val_transform(sz):
    return transforms.Compose([
        transforms.Resize(int(sz*1.1)),
        transforms.CenterCrop(sz),
        transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
    ])

def fast_hash(p):
    h = hashlib.md5()
    with open(p, 'rb') as f: h.update(f.read(8192))
    return h.hexdigest()

def scan_dataset(root):
    """
    Explicit directory-to-label mapping. No keyword guessing.
    """
    # Explicit mapping: (glob_pattern relative to DATA) -> label
    # Label: 0=real, 1=fake
    MAPPINGS = [
        # REAL datasets
        ("ffhq-real/**", 0),
        ("celeba/img_align_celeba/**", 0),
        ("celeba-hq/**", 0),
        ("lfw/**", 0),
        ("utkface/**", 0),
        ("widerface/WIDER_train/**", 0),
        ("widerface-extra/**", 0),
        ("human-faces/**", 0),
        ("landscape-real/**", 0),  # scenes, not faces, but real
        # REAL subdirectories in mixed datasets
        ("140k-faces/**/real/**", 0),
        ("140k-faces/**/training_real/**", 0),
        ("cifake/**/REAL/**", 0),
        ("gravex-200k/**/real/**", 0),
        ("faceforensics/**/original_sequences/**", 0),
        ("faceforensics/**/youtube/**", 0),
        ("real-and-fake-face/**/real/**", 0),
        ("real-and-fake-face/**/training_real/**", 0),
        # FAKE datasets
        ("stylegan-faces/**", 1),
        ("ffhq-stylegan/**", 1),   # 70K StyleGAN-generated faces
        ("deepfake-faces/**", 1),
        ("ai-faces-hq/**", 1),
        # FAKE subdirectories in mixed datasets
        ("140k-faces/**/fake/**", 1),
        ("140k-faces/**/training_fake/**", 1),
        ("cifake/**/FAKE/**", 1),
        ("gravex-200k/**/ai_images/**", 1),
        ("faceforensics/**/manipulated_sequences/**", 1),
        ("faceforensics/**/Deepfakes/**", 1),
        ("faceforensics/**/Face2Face/**", 1),
        ("faceforensics/**/FaceSwap/**", 1),
        ("faceforensics/**/NeuralTextures/**", 1),
        ("faceforensics/**/FaceShifter/**", 1),
        ("real-and-fake-face/**/fake/**", 1),
        ("real-and-fake-face/**/training_fake/**", 1),
    ]
    exts = {'.jpg','.jpeg','.png','.bmp','.webp'}
    data = defaultdict(list)
    import glob as globmod

    for pattern, label in MAPPINGS:
        full_pattern = str(root / pattern)
        matches = globmod.glob(full_pattern, recursive=True)
        count = 0
        # Determine source name from pattern
        source = pattern.split('/')[0]
        for m in matches:
            p = Path(m)
            if not p.is_file(): continue
            if p.suffix.lower() not in exts: continue
            if p.stat().st_size < 1000: continue
            data[source].append((p, label))
            count += 1
        if count > 0:
            lbl = "real" if label == 0 else "fake"
            log.info(f"  {pattern}: {count} {lbl}")

    # Summary per source
    for src in sorted(data.keys()):
        items = data[src]
        nr = sum(1 for _,l in items if l==0)
        nf = sum(1 for _,l in items if l==1)
        log.info(f"  {src}: {nr} real + {nf} fake")

    return data

def build_splits(cfg):
    log.info("Scanning datasets...")
    data = scan_dataset(cfg.DATA)
    train_items, val_items = [], []
    for src, items in data.items():
        if src in cfg.VAL_SOURCES:
            val_items.extend(items)
            log.info(f"  VAL: {src} ({len(items)})")
        else:
            train_items.extend(items)
            log.info(f"  TRAIN: {src} ({len(items)})")
    log.info(f"Before dedup: {len(train_items)} train, {len(val_items)} val")
    th = set()
    tc = []
    for p, l in train_items:
        h = fast_hash(p)
        if h not in th: th.add(h); tc.append((p, l))
    vh = set()
    vc = []
    for p, l in val_items:
        h = fast_hash(p)
        if h not in vh and h not in th: vh.add(h); vc.append((p, l))
    log.info(f"After dedup: {len(tc)} train, {len(vc)} val")
    tr = [(p,l) for p,l in tc if l==0]
    tf = [(p,l) for p,l in tc if l==1]
    mc = min(len(tr), len(tf))
    if mc == 0: log.error("No data!"); sys.exit(1)
    random.shuffle(tr); random.shuffle(tf)
    tb = tr[:mc] + tf[:mc]; random.shuffle(tb)
    vr = [(p,l) for p,l in vc if l==0]
    vf = [(p,l) for p,l in vc if l==1]
    vm = min(len(vr), len(vf))
    if vm == 0:
        log.warning(f"Val unbalanced: {len(vr)} real, {len(vf)} fake")
        vb = vc
    else:
        random.shuffle(vr); random.shuffle(vf)
        vb = vr[:vm] + vf[:vm]; random.shuffle(vb)
    log.info(f"Final: {len(tb)} train ({mc}/class), {len(vb)} val ({vm}/class)")
    return tb, vb

class FaceDataset(Dataset):
    def __init__(self, items, transform):
        self.items = items; self.transform = transform
    def __len__(self): return len(self.items)
    def __getitem__(self, idx):
        p, l = self.items[idx]
        try:
            img = Image.open(p).convert('RGB')
            return self.transform(img), l
        except Exception:
            return self.__getitem__(random.randint(0, len(self.items)-1))

class FrequencyBranch(nn.Module):
    def __init__(self):
        super().__init__()
        lap = torch.tensor([[0,1,0],[1,-4,1],[0,1,0]], dtype=torch.float32)
        self.register_buffer('lap3', lap.view(1,1,3,3).repeat(3,1,1,1))
        lap5 = torch.zeros(5,5)
        lap5[0,2]=lap5[4,2]=lap5[2,0]=lap5[2,4]=1
        lap5[1,2]=lap5[3,2]=lap5[2,1]=lap5[2,3]=2; lap5[2,2]=-12
        self.register_buffer('lap5', lap5.view(1,1,5,5).repeat(3,1,1,1))
        self.conv = nn.Sequential(
            nn.Conv2d(6,32,3,padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.Conv2d(32,64,3,stride=2,padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten())

    def forward(self, x):
        l3 = F.conv2d(x, self.lap3, padding=1, groups=3)
        l5 = F.conv2d(x, self.lap5, padding=2, groups=3)
        return self.conv(torch.cat([l3, l5], dim=1))

class DeepCheckV5(nn.Module):
    def __init__(self, dropout=0.5):
        super().__init__()
        import timm
        self.backbone = timm.create_model('efficientnet_b4', pretrained=True, num_classes=0)
        bb_dim = self.backbone.num_features
        self.freq = FrequencyBranch()
        self.head = nn.Sequential(
            nn.Linear(bb_dim+64, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(512, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(128, 1))

    def forward(self, x):
        return self.head(torch.cat([self.backbone(x), self.freq(x)], dim=1)).squeeze(-1)

class EMA:
    def __init__(self, model, decay=0.999):
        self.decay = decay
        self.shadow = {k: v.clone().detach() for k, v in model.state_dict().items()}
    def update(self, model):
        for k, v in model.state_dict().items():
            self.shadow[k] = self.decay * self.shadow[k] + (1-self.decay) * v
    def apply(self, model): model.load_state_dict(self.shadow)
    def state_dict(self): return self.shadow

def mixup_data(x, y, alpha=0.4):
    lam = np.random.beta(alpha, alpha) if alpha > 0 else 1
    idx = torch.randperm(x.size(0), device=x.device)
    return lam*x + (1-lam)*x[idx], y, y[idx], lam

def cutmix_data(x, y, alpha=1.0):
    lam = np.random.beta(alpha, alpha) if alpha > 0 else 1
    idx = torch.randperm(x.size(0), device=x.device)
    _, _, H, W = x.shape
    cr = np.sqrt(1.-lam); cw, ch = int(W*cr), int(H*cr)
    cx, cy = np.random.randint(W), np.random.randint(H)
    x1,y1 = np.clip(cx-cw//2,0,W), np.clip(cy-ch//2,0,H)
    x2,y2 = np.clip(cx+cw//2,0,W), np.clip(cy+ch//2,0,H)
    mx = x.clone(); mx[:,:,y1:y2,x1:x2] = x[idx,:,y1:y2,x1:x2]
    lam = 1-((x2-x1)*(y2-y1)/(W*H))
    return mx, y, y[idx], lam

def mix_criterion(crit, pred, ya, yb, lam):
    return lam*crit(pred, ya.float()) + (1-lam)*crit(pred, yb.float())

class LabelSmoothBCE(nn.Module):
    def __init__(self, s=0.1):
        super().__init__(); self.s = s; self.bce = nn.BCEWithLogitsLoss()
    def forward(self, logits, targets):
        return self.bce(logits, targets*(1-self.s) + 0.5*self.s)

def train_epoch(model, loader, opt, crit, scaler, dev, cfg, epoch):
    model.train()
    tl, correct, total = 0, 0, 0
    for bi, (imgs, labs) in enumerate(loader):
        imgs, labs = imgs.to(dev), labs.to(dev)
        use_mix = random.random() < 0.5 and epoch > 5
        if use_mix:
            if random.random() < cfg.MIXUP_PROB:
                imgs, la, lb, lam = mixup_data(imgs, labs, cfg.MIXUP_ALPHA)
            else:
                imgs, la, lb, lam = cutmix_data(imgs, labs, cfg.CUTMIX_ALPHA)
        opt.zero_grad()
        with torch.amp.autocast('cuda'):
            logits = model(imgs)
            loss = mix_criterion(crit, logits, la, lb, lam) if use_mix else crit(logits, labs.float())
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.GRAD_CLIP)
        scaler.step(opt); scaler.update()
        tl += loss.item()*imgs.size(0)
        if not use_mix:
            correct += ((torch.sigmoid(logits)>0.5).long()==labs).sum().item()
        total += imgs.size(0)
        if bi % 200 == 0: log.info(f"  batch {bi}/{len(loader)} loss={loss.item():.4f}")
    return tl/total, correct/total if total > 0 else 0

@torch.no_grad()
def validate(model, loader, crit, dev):
    model.eval()
    tl, correct, total = 0, 0, 0
    ap, al = [], []
    for imgs, labs in loader:
        imgs, labs = imgs.to(dev), labs.to(dev)
        with torch.amp.autocast('cuda'):
            logits = model(imgs)
            loss = crit(logits, labs.float())
        probs = torch.sigmoid(logits)
        tl += loss.item()*imgs.size(0)
        correct += ((probs>0.5).long()==labs).sum().item()
        total += imgs.size(0)
        ap.extend(probs.cpu().numpy()); al.extend(labs.cpu().numpy())
    from sklearn.metrics import roc_auc_score, roc_curve
    ap, al = np.array(ap), np.array(al)
    try:
        auc = roc_auc_score(al, ap)
        fpr, tpr, _ = roc_curve(al, ap)
        fnr = 1-tpr; ei = np.nanargmin(np.abs(fpr-fnr))
        eer = (fpr[ei]+fnr[ei])/2
    except: auc, eer = 0.5, 0.5
    return tl/total, correct/total, auc, eer

def export_onnx(model, path, dev):
    model.eval()
    torch.onnx.export(model, torch.randn(1,3,224,224,device=dev), str(path),
        input_names=["face_image"], output_names=["logit"],
        dynamic_axes={"face_image":{0:"batch"},"logit":{0:"batch"}}, opset_version=17)
    log.info(f"ONNX: {path} ({path.stat().st_size/1024/1024:.1f}MB)")

def main():
    cfg = C(); cfg.OUT.mkdir(parents=True, exist_ok=True)
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {dev}")

    # Clear old metrics
    mf = cfg.OUT / cfg.METRIC_FILE
    if mf.exists(): mf.unlink()

    train_items, val_items = build_splits(cfg)
    train_ds = FaceDataset(train_items, get_train_transform(cfg.SZ))
    val_ds = FaceDataset(val_items, get_val_transform(cfg.SZ))
    train_loader = DataLoader(train_ds, batch_size=cfg.BS, shuffle=True, num_workers=cfg.WORKERS, pin_memory=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.BS*2, shuffle=False, num_workers=cfg.WORKERS, pin_memory=True)
    log.info(f"Train: {len(train_ds)}, Val: {len(val_ds)}")

    model = DeepCheckV5(dropout=cfg.DROPOUT).to(dev)
    log.info(f"Params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")

    crit = LabelSmoothBCE(cfg.LABEL_SMOOTH).to(dev)
    bb_params = list(model.backbone.parameters())
    hd_params = list(model.freq.parameters()) + list(model.head.parameters())
    opt = torch.optim.AdamW([
        {'params': bb_params, 'lr': cfg.LR_BB},       # 10x higher than v1
        {'params': hd_params, 'lr': cfg.LR_HEAD},      # 3x higher than v1
    ], weight_decay=cfg.WD)
    # Linear warmup + cosine decay
    def lr_lambda(e):
        if e < cfg.WARMUP: return (e + 1) / cfg.WARMUP
        progress = (e - cfg.WARMUP) / (cfg.EPOCHS - cfg.WARMUP)
        return max(0.5 * (1 + np.cos(np.pi * progress)), 1e-6 / cfg.LR_BB)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)
    scaler = torch.amp.GradScaler('cuda')
    ema = EMA(model, cfg.EMA_DECAY)
    best_auc, patience = 0, 0

    for epoch in range(1, cfg.EPOCHS+1):
        t0 = time.time()
        tl, ta = train_epoch(model, train_loader, opt, crit, scaler, dev, cfg, epoch)
        sched.step(); ema.update(model)

        orig = {k: v.clone() for k, v in model.state_dict().items()}
        ema.apply(model)
        vl, va, auc, eer = validate(model, val_loader, crit, dev)
        model.load_state_dict(orig)

        lr = opt.param_groups[0]['lr']; dt = time.time()-t0
        log.info(f"E {epoch}/{cfg.EPOCHS} TL:{tl:.4f} TA:{ta:.4f} VL:{vl:.4f} VA:{va:.4f} AUC:{auc:.6f} EER:{eer:.4f} LR:{lr:.6f} {dt:.0f}s")

        with open(mf, "a") as f:
            f.write(json.dumps({"epoch":epoch,"train_loss":tl,"train_acc":ta,"val_loss":vl,"val_acc":va,"auc":auc,"eer":eer,"lr":lr,"time":dt})+"\n")

        if auc > best_auc:
            best_auc = auc; patience = 0
            ema.apply(model)
            torch.save(model.state_dict(), cfg.OUT/"best_v5.pt")
            model.load_state_dict(orig)
            log.info(f"  >>> BEST AUC:{auc:.6f} EER:{eer:.4f}")
            try:
                ema.apply(model)
                export_onnx(model, cfg.OUT/"deepfake_pixel_v5.onnx", dev)
                model.load_state_dict(orig)
            except Exception as e:
                log.warning(f"  ONNX fail: {e}"); model.load_state_dict(orig)
        else:
            patience += 1
            if patience >= 25:
                log.info(f"Early stop at {epoch}"); break

        if epoch % 10 == 0:
            torch.save({'epoch':epoch,'model':model.state_dict(),'ema':ema.state_dict(),'opt':opt.state_dict(),'sched':sched.state_dict(),'best_auc':best_auc}, cfg.OUT/f"ckpt_e{epoch}.pt")

    log.info(f"Done. Best AUC: {best_auc:.6f}")
    best = torch.load(cfg.OUT/"best_v5.pt", weights_only=True)
    model.load_state_dict(best)
    try: export_onnx(model, cfg.OUT/"deepfake_pixel_v5_final.onnx", dev)
    except Exception as e: log.warning(f"Final ONNX fail: {e}")
    os.system(f"aws s3 cp {cfg.OUT}/best_v5.pt s3://deep-check-models/deepfake/v5/best_v5.pt")
    if (cfg.OUT/"deepfake_pixel_v5_final.onnx").exists():
        os.system(f"aws s3 cp {cfg.OUT}/deepfake_pixel_v5_final.onnx s3://deep-check-models/deepfake/v5/deepfake_pixel_v5.onnx")

if __name__ == "__main__":
    main()
