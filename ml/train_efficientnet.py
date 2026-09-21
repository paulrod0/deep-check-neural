#!/usr/bin/env python3
"""
train_efficientnet.py — Train EfficientNet-B4 Document Fraud Classifier
========================================================================

Fine-tunes EfficientNet-B4 (pretrained ImageNet) on IDNet-2025 for:
  - Binary classification: genuine (0) vs tampered (1)

Architecture:
  Input: 380x380 RGB (EfficientNet-B4 native)
  Backbone: EfficientNet-B4 (pretrained, timm)
  Head: Dropout(0.3) -> Linear(1792, 512) -> ReLU -> Dropout(0.2) -> Linear(512, 1)
  Output: logit -> sigmoid -> P(tampered)

Usage:
  pip install -r ml/requirements.txt
  python ml/download_datasets.py --idnet --subset 20 --splits
  python ml/train_efficientnet.py --epochs 25 --batch-size 32 --lr 1e-4
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

# ── Safe imports ─────────────────────────────────────────────────────────────

def safe_import(module_name: str, package_name: str = None):
    try:
        return __import__(module_name)
    except ImportError:
        pkg = package_name or module_name
        print(f"Missing: {module_name}. Install: pip install {pkg}")
        sys.exit(1)

torch = safe_import("torch")
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

torchvision = safe_import("torchvision")
timm = safe_import("timm")
from PIL import Image

from sklearn.metrics import roc_auc_score, accuracy_score, precision_recall_fscore_support

try:
    import albumentations as A
    from albumentations.pytorch import ToTensorV2
    HAS_ALBUM = True
except ImportError:
    HAS_ALBUM = False

# ── Paths ────────────────────────────────────────────────────────────────────

ML_DIR    = Path(__file__).parent
DATA_DIR  = ML_DIR / "data"
MODEL_DIR = ML_DIR / "models"
SPLIT_DIR = DATA_DIR / "splits"


# ── Dataset ──────────────────────────────────────────────────────────────────

class DocFraudDataset(Dataset):
    def __init__(self, csv_path: Path, data_root: Path, transform=None, subset: int = 0):
        self.data_root = data_root
        self.transform = transform
        self.samples = []

        with open(csv_path) as f:
            lines = f.readlines()[1:]

        for line in lines:
            parts = line.strip().split(",")
            if len(parts) >= 2:
                self.samples.append((parts[0], int(parts[1])))

        if 0 < subset < len(self.samples):
            rng = np.random.RandomState(42)
            indices = rng.choice(len(self.samples), subset, replace=False)
            self.samples = [self.samples[i] for i in indices]

        labels = [s[1] for s in self.samples]
        self.n_genuine = labels.count(0)
        self.n_tampered = labels.count(1)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        rel_path, label = self.samples[idx]
        img_path = self.data_root / rel_path

        try:
            img = Image.open(img_path).convert("RGB")
        except Exception:
            img = Image.new("RGB", (380, 380), (0, 0, 0))

        if self.transform:
            if HAS_ALBUM:
                img_np = np.array(img)
                augmented = self.transform(image=img_np)
                img_tensor = augmented["image"]
            else:
                img_tensor = self.transform(img)
        else:
            img_tensor = torchvision.transforms.ToTensor()(img)

        return img_tensor, torch.tensor(label, dtype=torch.float32)


# ── Transforms ───────────────────────────────────────────────────────────────

def get_train_transform(img_size: int = 380):
    if HAS_ALBUM:
        return A.Compose([
            A.RandomResizedCrop(height=img_size, width=img_size, scale=(0.8, 1.0)),
            A.HorizontalFlip(p=0.3),
            A.Perspective(scale=(0.02, 0.06), p=0.3),
            A.OneOf([
                A.GaussNoise(var_limit=(10, 50), p=1),
                A.GaussianBlur(blur_limit=(3, 5), p=1),
                A.MotionBlur(blur_limit=5, p=1),
            ], p=0.3),
            A.OneOf([
                A.ImageCompression(quality_lower=50, quality_upper=90, p=1),
                A.Downscale(scale_min=0.5, scale_max=0.9, p=1),
            ], p=0.3),
            A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.05, p=0.3),
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2(),
        ])
    return torchvision.transforms.Compose([
        torchvision.transforms.Resize((img_size, img_size)),
        torchvision.transforms.RandomHorizontalFlip(p=0.3),
        torchvision.transforms.ToTensor(),
        torchvision.transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])


def get_val_transform(img_size: int = 380):
    if HAS_ALBUM:
        return A.Compose([
            A.Resize(img_size, img_size),
            A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ToTensorV2(),
        ])
    return torchvision.transforms.Compose([
        torchvision.transforms.Resize((img_size, img_size)),
        torchvision.transforms.ToTensor(),
        torchvision.transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])


# ── Model ────────────────────────────────────────────────────────────────────

class DocFraudClassifier(nn.Module):
    """EfficientNet-B4 + binary fraud classification head."""

    def __init__(self, backbone: str = "efficientnet_b4", pretrained: bool = True):
        super().__init__()
        self.backbone = timm.create_model(backbone, pretrained=pretrained, num_classes=0)

        with torch.no_grad():
            dummy = torch.randn(1, 3, 380, 380)
            feat_dim = self.backbone(dummy).shape[1]

        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(512, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        return self.head(features).squeeze(-1)


# ── Focal Loss ───────────────────────────────────────────────────────────────

class FocalLoss(nn.Module):
    def __init__(self, alpha: float = 0.25, gamma: float = 2.0):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce = nn.functional.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        probs = torch.sigmoid(logits)
        p_t = targets * probs + (1 - targets) * (1 - probs)
        alpha_t = targets * self.alpha + (1 - targets) * (1 - self.alpha)
        focal_weight = alpha_t * (1 - p_t) ** self.gamma
        return (focal_weight * bce).mean()


# ── Training ─────────────────────────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, optimizer, scaler, device):
    model.train()
    total_loss = 0
    all_preds, all_labels = [], []

    for batch_idx, (images, labels) in enumerate(loader):
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()

        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            logits = model(images)
            loss = criterion(logits, labels)

        if scaler:
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            optimizer.step()

        total_loss += loss.item()
        all_preds.extend(torch.sigmoid(logits).detach().cpu().numpy())
        all_labels.extend(labels.cpu().numpy())

        if (batch_idx + 1) % 50 == 0:
            print(f"    Batch {batch_idx + 1}/{len(loader)}, loss={loss.item():.4f}")

    preds, labels_np = np.array(all_preds), np.array(all_labels)
    try:
        auc = roc_auc_score(labels_np, preds)
    except ValueError:
        auc = 0.5

    return total_loss / len(loader), auc, accuracy_score(labels_np, (preds > 0.5).astype(int))


@torch.no_grad()
def evaluate_model(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    all_preds, all_labels = [], []

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        logits = model(images)
        total_loss += criterion(logits, labels).item()
        all_preds.extend(torch.sigmoid(logits).cpu().numpy())
        all_labels.extend(labels.cpu().numpy())

    preds, labels_np = np.array(all_preds), np.array(all_labels)
    try:
        auc = roc_auc_score(labels_np, preds)
    except ValueError:
        auc = 0.5

    acc = accuracy_score(labels_np, (preds > 0.5).astype(int))
    prec, rec, f1, _ = precision_recall_fscore_support(
        labels_np, (preds > 0.5).astype(int), average="binary", zero_division=0
    )
    return total_loss / max(len(loader), 1), auc, acc, prec, rec, f1, preds, labels_np


# ── ONNX Export ──────────────────────────────────────────────────────────────

def export_onnx(model, save_path: Path, img_size: int = 380):
    model.cpu()
    dummy = torch.randn(1, 3, img_size, img_size)

    torch.onnx.export(
        model, dummy, str(save_path),
        opset_version=17,
        input_names=["input_image"],
        output_names=["fraud_logit"],
        dynamic_axes={"input_image": {0: "batch_size"}, "fraud_logit": {0: "batch_size"}},
    )

    import onnx
    onnx.checker.check_model(onnx.load(str(save_path)))
    size_mb = save_path.stat().st_size / (1024 * 1024)
    print(f"  ONNX exported: {save_path} ({size_mb:.1f} MB)")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--img-size", type=int, default=380)
    parser.add_argument("--backbone", type=str, default="efficientnet_b4")
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--subset", type=int, default=0)
    parser.add_argument("--no-export", action="store_true")
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu" if args.cpu else ("cuda" if torch.cuda.is_available() else "cpu"))

    print(f"\n{'='*60}")
    print(f"  Deep-Check — EfficientNet-B4 Fraud Classifier")
    print(f"{'='*60}")
    print(f"  Device: {device} | Backbone: {args.backbone}")
    print(f"  Epochs: {args.epochs} | Batch: {args.batch_size} | LR: {args.lr}")

    data_root = DATA_DIR / "idnet"
    train_csv = SPLIT_DIR / "idnet_train.csv"
    if not train_csv.exists():
        print("\nSplits not found! Run: python ml/download_datasets.py --idnet --splits")
        sys.exit(1)

    # Datasets
    train_ds = DocFraudDataset(train_csv, data_root, get_train_transform(args.img_size), subset=args.subset)
    val_ds = DocFraudDataset(SPLIT_DIR / "idnet_val.csv", data_root, get_val_transform(args.img_size), subset=max(args.subset // 5, 0))
    test_ds = DocFraudDataset(SPLIT_DIR / "idnet_test.csv", data_root, get_val_transform(args.img_size), subset=max(args.subset // 5, 0))

    print(f"  Train: {len(train_ds)} ({train_ds.n_genuine}G / {train_ds.n_tampered}T)")
    print(f"  Val: {len(val_ds)} | Test: {len(test_ds)}")

    nw = 0 if args.cpu else min(4, os.cpu_count() or 1)
    train_loader = DataLoader(train_ds, args.batch_size, shuffle=True, num_workers=nw, pin_memory=device.type == "cuda")
    val_loader = DataLoader(val_ds, args.batch_size, num_workers=nw, pin_memory=device.type == "cuda")
    test_loader = DataLoader(test_ds, args.batch_size, num_workers=nw, pin_memory=device.type == "cuda")

    # Model
    model = DocFraudClassifier(args.backbone).to(device)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Params: {total_params:,}")

    pos_ratio = train_ds.n_tampered / max(len(train_ds), 1)
    criterion = FocalLoss(alpha=max(0.25, min(0.75, 1 - pos_ratio)))
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, args.epochs, eta_min=args.lr * 0.01)
    scaler = torch.amp.GradScaler("cuda") if device.type == "cuda" else None

    # Train
    best_auc = 0
    patience_counter = 0
    history = []

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        tr_loss, tr_auc, tr_acc = train_one_epoch(model, train_loader, criterion, optimizer, scaler, device)
        v_loss, v_auc, v_acc, v_prec, v_rec, v_f1, _, _ = evaluate_model(model, val_loader, criterion, device)
        scheduler.step()

        print(f"  E{epoch:3d} | tr_loss={tr_loss:.4f} tr_auc={tr_auc:.4f} | "
              f"v_loss={v_loss:.4f} v_auc={v_auc:.4f} v_f1={v_f1:.4f} | {time.time()-t0:.1f}s")

        history.append({"epoch": epoch, "train_loss": tr_loss, "train_auc": tr_auc,
                       "val_loss": v_loss, "val_auc": v_auc, "val_f1": v_f1})

        if v_auc > best_auc:
            best_auc = v_auc
            patience_counter = 0
            torch.save({
                "epoch": epoch, "model_state_dict": model.state_dict(),
                "val_auc": v_auc, "config": {"backbone": args.backbone, "img_size": args.img_size},
            }, MODEL_DIR / "efficientnet_doc_fraud.pt")
            print(f"    Best model saved (auc={v_auc:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= 5:
                print(f"    Early stopping at epoch {epoch}")
                break

    # Test
    ckpt = torch.load(MODEL_DIR / "efficientnet_doc_fraud.pt", map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    _, t_auc, t_acc, t_prec, t_rec, t_f1, _, _ = evaluate_model(model, test_loader, criterion, device)

    print(f"\n  Test: AUC={t_auc:.4f} Acc={t_acc:.4f} P={t_prec:.4f} R={t_rec:.4f} F1={t_f1:.4f}")

    metrics = {
        "model": args.backbone, "img_size": args.img_size,
        "train_samples": len(train_ds), "test_auc": round(t_auc, 4),
        "test_accuracy": round(t_acc, 4), "test_f1": round(t_f1, 4),
        "test_precision": round(t_prec, 4), "test_recall": round(t_rec, 4),
        "threshold": 0.5, "calibration": {"method": "platt", "coef": 1.0, "intercept": 0.0},
        "history": history,
    }
    with open(MODEL_DIR / "training_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    if not args.no_export:
        export_onnx(model, MODEL_DIR / "efficientnet_doc_fraud.onnx", args.img_size)

        import shutil
        public = Path(__file__).parent.parent / "public" / "models"
        public.mkdir(parents=True, exist_ok=True)
        shutil.copy2(MODEL_DIR / "efficientnet_doc_fraud.onnx", public / "efficientnet_doc_fraud.onnx")
        shutil.copy2(MODEL_DIR / "training_metrics.json", public / "efficientnet_doc_fraud_metadata.json")
        print(f"  Copied to {public}")

    print(f"\n  Done! Best AUC={best_auc:.4f}, Test AUC={t_auc:.4f}")


if __name__ == "__main__":
    main()
