#!/usr/bin/env python3
"""
Deep-Check V9 — DINOv3 + Modern AI Generators
===============================================

Upgrade from V8: same DINOv3 ViT-L/16 backbone but trained on
BOTH legacy (StyleGAN, FaceSwap) AND modern generators:
- Stable Diffusion XL
- DALL-E 3
- MidJourney v5/v6
- Flux
- Other diffusion models

Architecture: DINOv3 ViT-L/16 frozen + Linear Probe (Phase 1)
              Then unfreeze last 3 blocks (Phase 2)

Key difference from V8:
  V8 data: 315K images — ALL legacy generators → misses modern AI
  V9 data: ~400K+ images — legacy + modern generators → catches everything

Cross-source validation: LFW + UTKFace (real) + modern-val-fakes (fake)
"""

import os, sys, time, hashlib, logging, json, io, random, copy, shutil
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────
@dataclass
class C:
    SZ: int = 224
    BS_FROZEN: int = 512
    BS_FINETUNE: int = 64
    EPOCHS: int = 60
    LR: float = 1e-3
    LR_FINETUNE: float = 1e-5
    WD: float = 0.01
    LABEL_SMOOTH: float = 0.05
    EMA_DECAY: float = 0.999
    UNFREEZE_EPOCH: int = 12
    UNFREEZE_BLOCKS: int = 3
    GRAD_CLIP: float = 1.0
    WORKERS: int = 4
    DATA: Path = Path("/home/ubuntu/data")
    OUT: Path = Path("/home/ubuntu/training/v9_modern")
    METRIC_FILE: str = "metrics.jsonl"
    S3_METRICS: str = "s3://deep-check-models/training/v9_modern/metrics.jsonl"
    S3_BEST: str = "s3://deep-check-models/deepfake/v9/best_v9.pt"
    VAL_SOURCES: list = field(default_factory=lambda: ["lfw", "utkface", "val-fakes", "val-modern-fakes"])


# ── Augmentation ──────────────────────────────────────────────
class JPEGCompr:
    def __init__(self, qr=(20, 95)):
        self.qr = qr
    def __call__(self, img):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=random.randint(*self.qr))
        buf.seek(0)
        return Image.open(buf).convert("RGB")

class GNoise:
    def __init__(self, sr=(0.01, 0.05)):
        self.sr = sr
    def __call__(self, img):
        a = np.array(img).astype(np.float32) / 255
        a = np.clip(a + np.random.normal(0, random.uniform(*self.sr), a.shape).astype(np.float32), 0, 1)
        return Image.fromarray((a * 255).astype(np.uint8))

class DownscaleUpscale:
    def __init__(self, scale_range=(0.25, 0.75)):
        self.sr = scale_range
    def __call__(self, img):
        w, h = img.size
        s = random.uniform(*self.sr)
        small = img.resize((max(32, int(w*s)), max(32, int(h*s))), Image.BILINEAR)
        return small.resize((w, h), Image.BILINEAR)

def get_train_tf(sz):
    return transforms.Compose([
        transforms.RandomResizedCrop(sz, scale=(0.65, 1.0)),
        transforms.RandomHorizontalFlip(0.5),
        transforms.RandomApply([transforms.ColorJitter(0.4, 0.4, 0.3, 0.15)], p=0.5),
        transforms.RandomGrayscale(p=0.1),
        transforms.RandomApply([transforms.GaussianBlur(5, sigma=(0.1, 2.5))], p=0.25),
        transforms.RandomApply([JPEGCompr((20, 85))], p=0.35),
        transforms.RandomApply([GNoise((0.01, 0.05))], p=0.2),
        transforms.RandomApply([DownscaleUpscale((0.25, 0.75))], p=0.15),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        transforms.RandomErasing(p=0.1, scale=(0.02, 0.15)),
    ])

def get_val_tf(sz):
    return transforms.Compose([
        transforms.Resize(int(sz * 1.15)),
        transforms.CenterCrop(sz),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])


# ── Dataset ───────────────────────────────────────────────────
def file_hash(p):
    """Fast dedup using file size + first 4KB hash (avoids reading entire file)."""
    try:
        sz = os.path.getsize(p)
        h = hashlib.md5(str(sz).encode())
        with open(p, "rb") as f:
            h.update(f.read(4096))
        return h.hexdigest()
    except Exception:
        return str(p)

def scan_dataset(root):
    MAPS = [
        # REAL
        ("celeba/img_align_celeba/**", 0),
        ("celeba-hq/**", 0),
        ("lfw/**", 0),
        ("utkface/**", 0),
        ("human-faces/**", 0),
        ("140k-faces/**/real/**", 0),
        ("140k-faces/**/training_real/**", 0),
        ("cifake/**/REAL/**", 0),
        ("gender-real/**", 0),
        ("ffhq-real/**", 0),
        ("ffhq-256/**", 0),

        # LEGACY FAKE
        ("deepfake-faces/**", 1),
        ("140k-faces/**/fake/**", 1),
        ("140k-faces/**/training_fake/**", 1),
        ("cifake/**/FAKE/**", 1),
        ("val-fakes/**", 1),

        # ═══ MODERN FAKE — Specific paths from actual dataset structure ═══

        # FF-GenAI: dataset/real and dataset/fake
        ("ai-modern/ffgenai/dataset/real/**", 0),
        ("ai-modern/ffgenai/dataset/fake/**", 1),

        # OpenFake: openfake_dataset/{train,test}/{real,fake}
        ("ai-modern/openfake/**/real/**", 0),
        ("ai-modern/openfake/**/fake/**", 1),

        # RealFake 512: HybridForensics_Dataset_High/{Real,Fake_Diffusion,Fake_GAN}
        ("ai-modern/realfake512/**/Real/**", 0),
        ("ai-modern/realfake512/**/Fake_Diffusion/**", 1),  # MidJourney + SDXL
        ("ai-modern/realfake512/**/Fake_GAN/**", 1),        # ProGAN + StyleGAN3

        # Catch-all for any other modern datasets
        ("ai-modern/**/fake/**", 1),
        ("ai-modern/**/FAKE/**", 1),
        ("ai-modern/**/Fake/**", 1),
        ("ai-modern/**/generated/**", 1),
        ("ai-modern/**/synthetic/**", 1),

        # Modern val fakes
        ("val-modern-fakes/**", 1),
    ]

    exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    data = defaultdict(list)
    hashes = set()
    import glob as g

    for pat, lab in MAPS:
        ms = g.glob(str(root / pat), recursive=True)
        src = pat.split("/")[0]
        cnt = 0
        for m in ms:
            p = Path(m)
            if not p.is_file() or p.suffix.lower() not in exts:
                continue
            if p.stat().st_size < 1024:
                continue
            h = file_hash(str(p))
            if h in hashes:
                continue
            hashes.add(h)
            data[src].append((str(p), lab))
            cnt += 1
        if cnt > 0:
            lab_name = "REAL" if lab == 0 else "FAKE"
            log.info(f"  {pat}: {cnt} images ({lab_name})")

    return data


def split_data(data, val_sources):
    train, val = [], []
    val_src = set(s.lower() for s in val_sources)

    for src, items in data.items():
        if src.lower() in val_src or any(vs in src.lower() for vs in val_src):
            val.extend(items)
        else:
            train.extend(items)

    return train, val


class FaceDataset(Dataset):
    def __init__(self, items, tf):
        self.items = items
        self.tf = tf

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        try:
            img = Image.open(path).convert("RGB")
            img = self.tf(img)
            return img, label
        except Exception:
            j = random.randint(0, len(self.items) - 1)
            path2, label2 = self.items[j]
            img = Image.open(path2).convert("RGB")
            return self.tf(img), label2


# ── Model ─────────────────────────────────────────────────────
class DINOv3Classifier(nn.Module):
    def __init__(self, dropout=0.15):
        super().__init__()
        self.backbone = timm.create_model(
            "vit_large_patch16_dinov3.lvd1689m",
            pretrained=True,
            num_classes=0,
            dynamic_img_size=True,
            img_size=224,
        )
        feat_dim = self.backbone.num_features
        self.head = nn.Sequential(
            nn.LayerNorm(feat_dim),
            nn.Dropout(dropout),
            nn.Linear(feat_dim, 1),
        )
        for p in self.backbone.parameters():
            p.requires_grad = False
        log.info(f"DINOv3 ViT-L/16: {feat_dim}D features, backbone FROZEN")

    def forward(self, x):
        feat = self.backbone(x)
        return self.head(feat).squeeze(-1)

    def unfreeze_last_n(self, n=3):
        blocks = self.backbone.blocks
        total = len(blocks)
        for i in range(total - n, total):
            for p in blocks[i].parameters():
                p.requires_grad = True
        if hasattr(self.backbone, 'norm'):
            for p in self.backbone.norm.parameters():
                p.requires_grad = True
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        total_p = sum(p.numel() for p in self.parameters())
        log.info(f"Unfroze last {n} blocks: {trainable/1e6:.1f}M / {total_p/1e6:.1f}M trainable")


# ── EMA ───────────────────────────────────────────────────────
class EMA:
    def __init__(self, model, decay=0.999):
        self.decay = decay
        self.shadow = {k: v.clone() for k, v in model.state_dict().items()}

    def update(self, model):
        for k, v in model.state_dict().items():
            self.shadow[k] = self.decay * self.shadow[k] + (1 - self.decay) * v

    def apply(self, model):
        model.load_state_dict(self.shadow)


# ── Training ──────────────────────────────────────────────────
def compute_metrics(logits, labels):
    from sklearn.metrics import roc_auc_score, roc_curve
    probs = torch.sigmoid(logits).cpu().numpy()
    labels_np = labels.cpu().numpy()

    try:
        auc = roc_auc_score(labels_np, probs)
    except ValueError:
        auc = 0.5

    try:
        fpr, tpr, _ = roc_curve(labels_np, probs)
        fnr = 1 - tpr
        idx = np.nanargmin(np.abs(fpr - fnr))
        eer = float(fpr[idx])
    except Exception:
        eer = 0.5

    preds = (probs > 0.5).astype(int)
    acc = float((preds == labels_np).mean())

    return {"auc": auc, "eer": eer, "acc": acc}


def train_epoch(model, loader, optimizer, criterion, scaler, device, cfg):
    model.train()
    total_loss = 0
    all_logits, all_labels = [], []

    for i, (imgs, labels) in enumerate(loader):
        imgs, labels = imgs.to(device), labels.to(device).float()

        with torch.amp.autocast("cuda"):
            logits = model(imgs)
            loss = criterion(logits, labels)

        optimizer.zero_grad()
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.GRAD_CLIP)
        scaler.step(optimizer)
        scaler.update()

        total_loss += loss.item()
        all_logits.append(logits.detach())
        all_labels.append(labels.detach())

        if (i + 1) % 50 == 0:
            log.info(f"  batch {i+1}/{len(loader)}: loss={loss.item():.4f}")

    all_logits = torch.cat(all_logits)
    all_labels = torch.cat(all_labels)
    metrics = compute_metrics(all_logits, all_labels)
    metrics["loss"] = total_loss / len(loader)
    return metrics


@torch.no_grad()
def val_epoch(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    all_logits, all_labels = [], []

    for imgs, labels in loader:
        imgs, labels = imgs.to(device), labels.to(device).float()
        with torch.amp.autocast("cuda"):
            logits = model(imgs)
            loss = criterion(logits, labels)
        total_loss += loss.item()
        all_logits.append(logits)
        all_labels.append(labels)

    all_logits = torch.cat(all_logits)
    all_labels = torch.cat(all_labels)
    metrics = compute_metrics(all_logits, all_labels)
    metrics["loss"] = total_loss / max(len(loader), 1)
    return metrics


def main():
    cfg = C()
    cfg.OUT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {device}")

    log.info("Scanning datasets...")
    data = scan_dataset(cfg.DATA)

    total_real = sum(1 for items in data.values() for _, l in items if l == 0)
    total_fake = sum(1 for items in data.values() for _, l in items if l == 1)
    log.info(f"Total: {total_real} real + {total_fake} fake = {total_real + total_fake}")

    modern_fake = sum(1 for items in data.values() for p, l in items
                      if l == 1 and "ai-modern" in p)
    log.info(f"Modern AI fakes: {modern_fake}")

    train_items, val_items = split_data(data, cfg.VAL_SOURCES)
    random.shuffle(train_items)

    train_real = sum(1 for _, l in train_items if l == 0)
    train_fake = sum(1 for _, l in train_items if l == 1)
    val_real = sum(1 for _, l in val_items if l == 0)
    val_fake = sum(1 for _, l in val_items if l == 1)
    log.info(f"Train: {train_real} real + {train_fake} fake = {len(train_items)}")
    log.info(f"Val:   {val_real} real + {val_fake} fake = {len(val_items)}")

    if len(val_items) == 0:
        log.error("No validation data! Check VAL_SOURCES config.")
        sys.exit(1)

    labels = [l for _, l in train_items]
    class_counts = [labels.count(0), labels.count(1)]
    weights = [1.0 / class_counts[l] for l in labels]
    sampler = WeightedRandomSampler(weights, len(train_items), replacement=True)

    train_ds = FaceDataset(train_items, get_train_tf(cfg.SZ))
    val_ds = FaceDataset(val_items, get_val_tf(cfg.SZ))

    train_loader = DataLoader(train_ds, batch_size=cfg.BS_FROZEN, sampler=sampler,
                              num_workers=cfg.WORKERS, pin_memory=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.BS_FROZEN,
                            num_workers=cfg.WORKERS, pin_memory=True)

    model = DINOv3Classifier(dropout=0.15).to(device)
    ema = EMA(model, decay=cfg.EMA_DECAY)

    criterion = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor([train_real / max(train_fake, 1)]).to(device)
    )

    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=cfg.LR, weight_decay=cfg.WD,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=cfg.UNFREEZE_EPOCH, eta_min=cfg.LR * 0.01
    )
    scaler = torch.amp.GradScaler("cuda")

    best_auc = 0
    best_epoch = 0

    log.info(f"\n{'='*60}")
    log.info(f"V9 TRAINING START — DINOv3 + Modern Generators")
    log.info(f"{'='*60}")

    for epoch in range(1, cfg.EPOCHS + 1):
        t0 = time.time()

        if epoch == cfg.UNFREEZE_EPOCH:
            log.info(f"\n{'='*60}")
            log.info(f"PHASE 2: Unfreezing last {cfg.UNFREEZE_BLOCKS} blocks")
            log.info(f"{'='*60}")
            model.unfreeze_last_n(cfg.UNFREEZE_BLOCKS)

            train_loader = DataLoader(
                train_ds, batch_size=cfg.BS_FINETUNE, sampler=sampler,
                num_workers=cfg.WORKERS, pin_memory=True, drop_last=True,
            )

            backbone_params = [p for n, p in model.backbone.named_parameters() if p.requires_grad]
            head_params = list(model.head.parameters())
            optimizer = torch.optim.AdamW([
                {"params": backbone_params, "lr": cfg.LR_FINETUNE},
                {"params": head_params, "lr": cfg.LR_FINETUNE * 10},
            ], weight_decay=cfg.WD)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=cfg.EPOCHS - cfg.UNFREEZE_EPOCH, eta_min=1e-7,
            )

        train_m = train_epoch(model, train_loader, optimizer, criterion, scaler, device, cfg)
        ema.update(model)

        orig_sd = {k: v.clone() for k, v in model.state_dict().items()}
        ema.apply(model)
        val_m = val_epoch(model, val_loader, criterion, device)
        model.load_state_dict(orig_sd)

        scheduler.step()
        elapsed = time.time() - t0
        lr = optimizer.param_groups[0]["lr"]

        phase = "FROZEN" if epoch < cfg.UNFREEZE_EPOCH else "FINETUNE"
        log.info(
            f"Epoch {epoch:02d} [{phase}] "
            f"train_loss={train_m['loss']:.4f} train_auc={train_m['auc']:.4f} "
            f"val_loss={val_m['loss']:.4f} val_auc={val_m['auc']:.4f} val_eer={val_m['eer']:.4f} "
            f"lr={lr:.2e} time={elapsed:.0f}s"
        )

        metric = {
            "epoch": epoch, "phase": phase,
            "train_loss": train_m["loss"], "train_auc": train_m["auc"],
            "val_loss": val_m["loss"], "val_auc": val_m["auc"], "val_eer": val_m["eer"],
            "val_acc": val_m["acc"], "lr": lr, "time_s": elapsed,
            "modern_fakes": modern_fake,
        }
        with open(cfg.OUT / cfg.METRIC_FILE, "a") as f:
            f.write(json.dumps(metric) + "\n")

        try:
            os.system(f"aws s3 cp {cfg.OUT / cfg.METRIC_FILE} {cfg.S3_METRICS} --quiet")
        except Exception:
            pass

        if val_m["auc"] > best_auc:
            best_auc = val_m["auc"]
            best_epoch = epoch
            ckpt = {
                "epoch": epoch,
                "model_state": model.state_dict(),
                "ema_state": ema.shadow,
                "optimizer_state": optimizer.state_dict(),
                "val_auc": val_m["auc"],
                "val_eer": val_m["eer"],
                "config": {
                    "backbone": "vit_large_patch16_dinov3.lvd1689m",
                    "version": "V9-modern",
                    "modern_fakes": modern_fake,
                    "total_train": len(train_items),
                },
            }
            torch.save(ckpt, cfg.OUT / "best_v9.pt")
            log.info(f"  * New best AUC={best_auc:.6f} at epoch {epoch}")

            try:
                os.system(f"aws s3 cp {cfg.OUT / 'best_v9.pt'} {cfg.S3_BEST} --quiet")
            except Exception:
                pass

        if epoch % 5 == 0:
            torch.save({
                "epoch": epoch,
                "model_state": model.state_dict(),
                "ema_state": ema.shadow,
                "optimizer_state": optimizer.state_dict(),
            }, cfg.OUT / "latest_v9.pt")

        if epoch > cfg.UNFREEZE_EPOCH + 15 and epoch - best_epoch > 15:
            log.info(f"Early stopping: no improvement for 15 epochs (best={best_epoch})")
            break

    log.info(f"\n{'='*60}")
    log.info(f"TRAINING COMPLETE — Best AUC={best_auc:.6f} at epoch {best_epoch}")
    log.info(f"{'='*60}")


if __name__ == "__main__":
    main()
