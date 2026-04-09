#!/usr/bin/env python3
"""
Deep-Check Doc Forensics V2c — DINOv2 + ELA (warm restart from V2b)
====================================================================
V2c improvements over V2b:
- Includes invoice/receipt data (Invoices Real and Forged dataset)
- Warm restart from V2b checkpoint (AUC 0.998, EER 1.87%)
- Document-specific augmentations (JPEG compression, resize, rotation)
- Higher weight on document-type images vs natural images
- Target: accuracy >= 90% on mixed docs+invoices, recall >= 95%

Data:
  CASIA 2.0:      7,492 authentic + 5,125 tampered (images)
  Invoices:       312 real + 312 forged (document-specific)
  forensics-rf:   Sets 1-3 train, Set 4 val

Usage:
  python3 train_doc_v2c.py
"""

import os, sys, time, hashlib, logging, json, random, copy, math
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict

import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm
import glob as globmod

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)


@dataclass
class C:
    SZ: int = 224
    BS_FROZEN: int = 16
    BS_FINETUNE: int = 8
    EPOCHS: int = 30
    LR: float = 5e-4
    LR_FINETUNE: float = 3e-5
    LR_FINETUNE_HEAD: float = 3e-4
    WD: float = 0.01
    LABEL_SMOOTH: float = 0.03
    EMA_DECAY: float = 0.999
    UNFREEZE_EPOCH: int = 2  # Fast unfreeze for warm restart
    UNFREEZE_BLOCKS: int = 8
    GRAD_CLIP: float = 1.0
    WORKERS: int = 4
    FOCAL_GAMMA: float = 2.0
    DATA: Path = Path("/home/ubuntu/data")
    CHECKPOINT: str = "/home/ubuntu/training/doc_v2c/best_doc_v2c.pt"  # Warm restart from V2c
    OUT: Path = Path("/home/ubuntu/training/doc_v2c_warm")
    S3_BEST: str = "s3://deep-check-models/training/doc_v2c/best_doc_v2c_warm.pt"
    S3_METRICS: str = "s3://deep-check-models/training/doc_v2c/metrics_warm.jsonl"
    INVOICE_REAL: Path = Path("/home/ubuntu/data/invoices/Real")
    INVOICE_FORGED: Path = Path("/home/ubuntu/data/invoices/Forged")
    INVOICE_OVERSAMPLE: int = 8


MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def compute_ela(img_bgr, quality=90):
    _, buf = cv2.imencode('.jpg', img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    resaved = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return np.clip(cv2.absdiff(img_bgr, resaved).astype(np.float32) * 15, 0, 255).astype(np.uint8)


def compute_multi_ela(img_bgr):
    e90 = compute_ela(img_bgr, 90).astype(np.float32)
    e70 = compute_ela(img_bgr, 70).astype(np.float32)
    e50 = compute_ela(img_bgr, 50).astype(np.float32)
    return np.clip((e90 + e70 + e50) / 3.0, 0, 255).astype(np.uint8)


def get_train_tf(sz):
    return transforms.Compose([
        transforms.RandomResizedCrop(sz, scale=(0.5, 1.0)),
        transforms.RandomHorizontalFlip(0.5),
        transforms.RandomVerticalFlip(0.1),
        transforms.RandomApply([transforms.ColorJitter(0.3, 0.3, 0.2, 0.1)], p=0.3),
        transforms.RandomGrayscale(p=0.05),
        transforms.RandomApply([transforms.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.15),
    ])

def get_val_tf(sz):
    return transforms.Compose([
        transforms.Resize(int(sz * 1.15)),
        transforms.CenterCrop(sz),
    ])


def doc_augment(img_bgr):
    h, w = img_bgr.shape[:2]
    if random.random() < 0.3:
        q = random.randint(50, 95)
        _, buf = cv2.imencode('.jpg', img_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        img_bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if random.random() < 0.2:
        angle = random.uniform(-5, 5)
        M = cv2.getRotationMatrix2D((w/2, h/2), angle, 1.0)
        img_bgr = cv2.warpAffine(img_bgr, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
    return img_bgr


def file_hash(p):
    try:
        sz = os.path.getsize(p)
        h = hashlib.md5(str(sz).encode())
        with open(p, "rb") as f:
            h.update(f.read(4096))
        return h.hexdigest()
    except Exception:
        return str(p)


def scan_dataset(root, invoice_real=None, invoice_forged=None, invoice_oversample=8):
    MAPS = [
        ("casia/**/Au/**", 0), ("casia/**/Tp/**", 1),
        ("casia/**/authentic/**", 0), ("casia/**/tampered/**", 1),
        ("casia-extra/**/Au/**", 0), ("casia-extra/**/Tp/**", 1),
        ("forensics-rf/Data Set 1/**/real/**", 0), ("forensics-rf/Data Set 1/**/fake/**", 1),
        ("forensics-rf/Data Set 2/**/real/**", 0), ("forensics-rf/Data Set 2/**/fake/**", 1),
        ("forensics-rf/Data Set 3/**/real/**", 0), ("forensics-rf/Data Set 3/**/fake/**", 1),
        ("forensics-rf/Data Set 4/**/real/**", 0), ("forensics-rf/Data Set 4/**/fake/**", 1),
        ("cg1050/**/CG/**", 1), ("cg1050/**/PG/**", 0),
    ]
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    data = defaultdict(list)
    hashes = set()

    for pat, lab in MAPS:
        src_key = pat.split("/")[0]
        if "Set 4" in pat:
            src_key = "set4"
        for m in globmod.glob(str(root / pat), recursive=True):
            p = Path(m)
            if not p.is_file() or p.suffix.lower() not in exts or p.stat().st_size < 1024:
                continue
            h = file_hash(str(p))
            if h in hashes:
                continue
            hashes.add(h)
            data[src_key].append((str(p), lab))

    inv_count = 0
    if invoice_real and Path(invoice_real).exists():
        for f in Path(invoice_real).iterdir():
            if f.suffix.lower() in exts:
                for _ in range(invoice_oversample):
                    data["invoices_train"].append((str(f), 0))
                inv_count += 1
    if invoice_forged and Path(invoice_forged).exists():
        for f in Path(invoice_forged).iterdir():
            if f.suffix.lower() in exts:
                for _ in range(invoice_oversample):
                    data["invoices_train"].append((str(f), 1))
                inv_count += 1

    log.info(f"Invoice images: {inv_count} unique, x{invoice_oversample} oversampled")
    for k, v in data.items():
        r = sum(1 for _, l in v if l == 0)
        f = sum(1 for _, l in v if l == 1)
        log.info(f"  {k}: {len(v)} (real={r}, fake={f})")
    return data


class DocDataset(Dataset):
    def __init__(self, samples, sz=224, transform=None, is_train=True):
        self.samples = samples
        self.sz = sz
        self.tf = transform
        self.is_train = is_train

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = cv2.imread(path)
            if img is None:
                raise ValueError(f"Cannot read {path}")
            if self.is_train and random.random() < 0.3:
                img = doc_augment(img)
            ela = compute_multi_ela(img)
            ela_rgb = cv2.cvtColor(ela, cv2.COLOR_BGR2RGB)
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            pil_rgb = Image.fromarray(img_rgb)
            pil_ela = Image.fromarray(ela_rgb)
            if self.tf:
                seed = random.randint(0, 2**32)
                torch.manual_seed(seed)
                pil_rgb = self.tf(pil_rgb)
                torch.manual_seed(seed)
                pil_ela = self.tf(pil_ela)
            pil_rgb = transforms.Resize((self.sz, self.sz))(pil_rgb)
            pil_ela = transforms.Resize((self.sz, self.sz))(pil_ela)
            rgb = (np.array(pil_rgb).astype(np.float32) / 255.0 - MEAN) / STD
            ela_arr = (np.array(pil_ela).astype(np.float32) / 255.0 - MEAN) / STD
            combined = np.concatenate([rgb, ela_arr], axis=2).transpose(2, 0, 1)
            return torch.from_numpy(combined).float(), torch.tensor(label, dtype=torch.float32)
        except Exception as e:
            log.warning(f"Error loading {path}: {e}")
            return torch.zeros(6, self.sz, self.sz), torch.tensor(0, dtype=torch.float32)


class DocModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = timm.create_model("vit_large_patch14_dinov2.lvd142m", pretrained=True, num_classes=0, dynamic_img_size=True, img_size=224)
        old_pe = self.backbone.patch_embed.proj
        new_pe = nn.Conv2d(6, old_pe.out_channels, old_pe.kernel_size, stride=old_pe.stride, padding=old_pe.padding)
        with torch.no_grad():
            new_pe.weight[:, :3] = old_pe.weight
            new_pe.weight[:, 3:] = 0
            if old_pe.bias is not None:
                new_pe.bias = old_pe.bias
        self.backbone.patch_embed.proj = new_pe
        fd = self.backbone.num_features
        self.head = nn.Sequential(nn.LayerNorm(fd), nn.Linear(fd, 512), nn.GELU(), nn.Dropout(0.2), nn.Linear(512, 1))

    def forward(self, x):
        return self.head(self.backbone(x)).squeeze(-1)


class EMA:
    def __init__(self, model, decay=0.999):
        self.decay = decay
        self.shadow = {k: v.clone().detach() for k, v in model.state_dict().items()}

    def update(self, model):
        for k, v in model.state_dict().items():
            self.shadow[k] = self.decay * self.shadow[k].to(v.device) + (1 - self.decay) * v.detach()

    def apply(self, model):
        model.load_state_dict(self.shadow, strict=False)


def focal_loss(logits, targets, gamma=2.0, smooth=0.03):
    t = targets * (1 - smooth) + (1 - targets) * smooth
    p = torch.sigmoid(logits)
    bce = F.binary_cross_entropy_with_logits(logits, t, reduction='none')
    pt = t * p + (1 - t) * (1 - p)
    return (bce * (1 - pt) ** gamma).mean()


def compute_metrics(logits, labels):
    from sklearn.metrics import roc_auc_score, roc_curve
    from scipy.optimize import brentq
    from scipy.interpolate import interp1d
    p = torch.sigmoid(logits).cpu().numpy()
    y = labels.cpu().numpy()
    try:
        auc = roc_auc_score(y, p)
    except ValueError:
        auc = 0.5
    fpr, tpr, _ = roc_curve(y, p)
    try:
        eer = brentq(lambda x: 1. - x - interp1d(fpr, tpr)(x), 0., 1.)
    except ValueError:
        eer = 0.5
    acc = ((p > 0.5) == y).mean()
    return auc, eer, acc


def train():
    cfg = C()
    cfg.OUT.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info(f"Device: {device}")

    data = scan_dataset(cfg.DATA, str(cfg.INVOICE_REAL), str(cfg.INVOICE_FORGED), cfg.INVOICE_OVERSAMPLE)

    val_keys = ["set4"]
    train_samples, val_samples = [], []
    for k, samples in data.items():
        if k in val_keys:
            val_samples.extend(samples)
        elif k == "invoices_train":
            random.shuffle(samples)
            split = int(len(samples) * 0.8)
            train_samples.extend(samples[:split])
            val_samples.extend(samples[split:])
        else:
            train_samples.extend(samples)

    random.shuffle(train_samples)
    random.shuffle(val_samples)
    n_real = sum(1 for _, l in train_samples if l == 0)
    n_fake = sum(1 for _, l in train_samples if l == 1)
    log.info(f"Train: {len(train_samples)} (real={n_real}, fake={n_fake})")
    log.info(f"Val: {len(val_samples)}")

    weights = []
    w0 = len(train_samples) / (2 * max(1, n_real))
    w1 = len(train_samples) / (2 * max(1, n_fake))
    for _, l in train_samples:
        weights.append(w1 if l == 1 else w0)
    sampler = WeightedRandomSampler(weights, len(train_samples), replacement=True)

    train_ds = DocDataset(train_samples, cfg.SZ, get_train_tf(cfg.SZ), True)
    val_ds = DocDataset(val_samples, cfg.SZ, get_val_tf(cfg.SZ), False)

    model = DocModel().to(device)
    if os.path.exists(cfg.CHECKPOINT):
        log.info(f"Loading V2b: {cfg.CHECKPOINT}")
        ckpt = torch.load(cfg.CHECKPOINT, map_location=device, weights_only=False)
        state = ckpt.get("model_state_dict", ckpt.get("model_state", {}))
        model.load_state_dict(state, strict=False)
        log.info("V2b loaded (warm restart)")
    else:
        log.info("No checkpoint, training from scratch")

    for p in model.backbone.parameters():
        p.requires_grad = False
    model.backbone.patch_embed.proj.requires_grad_(True)

    ema = EMA(model, cfg.EMA_DECAY)
    best_auc, best_eer = 0, 1.0

    for epoch in range(1, cfg.EPOCHS + 1):
        if epoch == cfg.UNFREEZE_EPOCH:
            log.info(f"Unfreezing {cfg.UNFREEZE_BLOCKS} blocks")
            for b in list(model.backbone.blocks)[-cfg.UNFREEZE_BLOCKS:]:
                for p in b.parameters():
                    p.requires_grad = True
            model.backbone.norm.requires_grad_(True)

        is_frozen = epoch < cfg.UNFREEZE_EPOCH
        bs = cfg.BS_FROZEN if is_frozen else cfg.BS_FINETUNE
        lr = cfg.LR if is_frozen else cfg.LR_FINETUNE

        if epoch == 1 or epoch == cfg.UNFREEZE_EPOCH:
            param_groups = [
                {"params": [p for n, p in model.named_parameters() if "head" in n and p.requires_grad], "lr": cfg.LR if is_frozen else cfg.LR_FINETUNE_HEAD},
                {"params": [p for n, p in model.named_parameters() if "head" not in n and p.requires_grad], "lr": lr},
            ]
            optimizer = torch.optim.AdamW(param_groups, weight_decay=cfg.WD)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=len(train_samples)//bs*(cfg.EPOCHS-epoch+1), eta_min=1e-7)

        train_loader = DataLoader(train_ds, batch_size=bs, sampler=sampler, num_workers=cfg.WORKERS, pin_memory=True, drop_last=True)

        model.train()
        total_loss, n_batches = 0, 0
        all_logits, all_labels = [], []
        t0 = time.time()

        for bi, (x, y) in enumerate(train_loader):
            x, y = x.to(device), y.to(device)
            logits = model(x)
            loss = focal_loss(logits, y, cfg.FOCAL_GAMMA, cfg.LABEL_SMOOTH)
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), cfg.GRAD_CLIP)
            optimizer.step()
            scheduler.step()
            ema.update(model)
            total_loss += loss.item()
            n_batches += 1
            all_logits.append(logits.detach())
            all_labels.append(y.detach())
            if (bi + 1) % 50 == 0:
                log.info(f"  batch {bi+1}/{len(train_loader)}: loss={loss.item():.4f}")

        train_loss = total_loss / max(1, n_batches)
        train_auc, train_eer, train_acc = compute_metrics(torch.cat(all_logits), torch.cat(all_labels))

        model.eval()
        val_loader = DataLoader(val_ds, batch_size=bs, shuffle=False, num_workers=cfg.WORKERS, pin_memory=True)
        vl, vy = [], []
        with torch.no_grad():
            for x, y in val_loader:
                vl.append(model(x.to(device)))
                vy.append(y.to(device))
        vl, vy = torch.cat(vl), torch.cat(vy)
        val_auc, val_eer, val_acc = compute_metrics(vl, vy)
        val_loss = focal_loss(vl, vy, cfg.FOCAL_GAMMA).item()

        phase = "P1-FROZEN" if is_frozen else "P2-UNFREEZE"
        log.info(f"Epoch {epoch}/{cfg.EPOCHS} [{phase}] loss={train_loss:.4f} auc={train_auc:.4f} | val_auc={val_auc:.4f} val_eer={val_eer:.4f} val_acc={val_acc:.4f} | gap={train_auc-val_auc:.3f} {time.time()-t0:.0f}s")

        metrics = {"epoch": epoch, "phase": phase, "train_loss": train_loss, "train_auc": train_auc, "val_loss": val_loss, "val_auc": val_auc, "val_eer": val_eer, "val_acc": val_acc, "lr": optimizer.param_groups[0]["lr"], "time_s": time.time()-t0}
        with open(cfg.OUT / "metrics.jsonl", "a") as f:
            f.write(json.dumps(metrics) + "\n")
            f.flush()

        if val_auc > best_auc or (val_auc == best_auc and val_eer < best_eer):
            best_auc, best_eer = val_auc, val_eer
            # Save model directly (no EMA) — EMA was causing inference issues
            torch.save({"model_state_dict": model.state_dict(), "config": {"version": "v2c", "epoch": epoch, "val_auc": val_auc, "val_eer": val_eer, "val_acc": val_acc}, "epoch": epoch}, cfg.OUT / "best_doc_v2c.pt")
            log.info(f"  ** BEST: AUC={val_auc:.4f} EER={val_eer:.4f} ACC={val_acc:.4f}")
            os.system(f"aws s3 cp {cfg.OUT}/best_doc_v2c.pt {cfg.S3_BEST} --region eu-west-1 --quiet")
            os.system(f"aws s3 cp {cfg.OUT}/metrics.jsonl {cfg.S3_METRICS} --region eu-west-1 --quiet")

    log.info(f"Done. Best AUC={best_auc:.4f} EER={best_eer:.4f}")


if __name__ == "__main__":
    train()
