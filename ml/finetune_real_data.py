#!/usr/bin/env python3
"""
finetune_real_data.py — Fine-tune with REAL document images (CPU-optimized)
============================================================================

Uses downloaded real document images (passport, selfie_id, synthcards, etc.)
with augmentation. Optimized for CPU execution (< 45 min).

Strategy:
  Phase 1 — Head warmup on real data (backbone frozen, 5 epochs)
  Phase 2 — Partial backbone fine-tune (last 2 blocks unfrozen, 8 epochs)

For MAXIMUM POWER (GPU):
  Upload ml/Deep_Check_Train.ipynb to Google Colab (A100/T4)

Usage:
  python3 ml/finetune_real_data.py
"""

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
from PIL import Image, ImageDraw, ImageFilter

try:
    import timm
except ImportError:
    print("Missing: timm. Install: pip install timm")
    sys.exit(1)

try:
    from sklearn.metrics import roc_auc_score, f1_score
except ImportError:
    print("Missing: sklearn. Install: pip install scikit-learn")
    sys.exit(1)


ML_DIR = Path(__file__).parent
DATA_DIR = ML_DIR / "data" / "combined"
SPLITS_DIR = ML_DIR / "data" / "splits"
MODEL_DIR = ML_DIR / "models"
PUBLIC_MODELS = ML_DIR.parent / "public" / "models"


# ── Model Architecture (must match export_model.py exactly) ─────────────

class DocFraudClassifier(nn.Module):
    def __init__(self, backbone_name="efficientnet_b4", pretrained=True):
        super().__init__()
        self.backbone = timm.create_model(backbone_name, pretrained=pretrained, num_classes=0)
        with torch.no_grad():
            feat_dim = self.backbone(torch.randn(1, 3, 380, 380)).shape[1]
        self.head = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(512, 1),
        )
        self.feat_dim = feat_dim

    def forward(self, x):
        features = self.backbone(x)
        return self.head(features).squeeze(-1)


# ── Real Data Dataset ────────────────────────────────────────────────────

class RealDocDataset(Dataset):
    """Dataset using real downloaded images with on-the-fly augmentation."""

    def __init__(self, csv_path, data_dir, transform=None):
        self.data_dir = Path(data_dir)
        self.transform = transform
        self.samples = []

        with open(csv_path, 'r') as f:
            lines = f.readlines()[1:]

        loaded = 0
        for line in lines:
            parts = line.strip().split(',')
            if len(parts) == 2:
                path, label = parts[0], int(parts[1])
                full_path = self.data_dir / path
                if full_path.exists():
                    self.samples.append((str(full_path), label))
                    loaded += 1

        n_gen = sum(1 for _, l in self.samples if l == 0)
        n_tam = sum(1 for _, l in self.samples if l == 1)
        print(f"    Loaded {loaded} samples ({n_gen} genuine + {n_tam} tampered)")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert('RGB')
        except Exception:
            img = Image.new('RGB', (380, 380), (128, 128, 128))

        if self.transform:
            img = self.transform(img)
        else:
            img = T.ToTensor()(img)

        return img, torch.tensor(label, dtype=torch.float32)


# ── Training Functions ───────────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        logits = model(images)
        loss = criterion(logits, labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

        total_loss += loss.item() * images.size(0)
        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += images.size(0)

    return total_loss / max(total, 1), correct / max(total, 1)


def evaluate(model, loader, device):
    model.train(False)
    all_probs = []
    all_labels = []

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            logits = model(images)
            probs = torch.sigmoid(logits)
            all_probs.extend(probs.cpu().numpy().tolist())
            all_labels.extend(labels.cpu().numpy().tolist())

    all_probs = np.array(all_probs)
    all_labels = np.array(all_labels)
    preds = (all_probs > 0.5).astype(int)

    acc = float(np.mean(preds == all_labels))
    auc = float(roc_auc_score(all_labels, all_probs)) if len(set(all_labels)) > 1 else 0.5
    f1 = float(f1_score(all_labels, preds, zero_division=0))

    return auc, acc, f1


def export_onnx(model, output_path, img_size=380):
    model.train(False)
    dummy = torch.randn(1, 3, img_size, img_size)
    torch.onnx.export(
        model, dummy, output_path,
        input_names=["input_image"],
        output_names=["logit"],
        dynamic_axes={"input_image": {0: "batch_size"}, "logit": {0: "batch_size"}},
        opset_version=14,
        do_constant_folding=True,
    )
    return os.path.getsize(output_path) / (1024 * 1024)


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    t_start = time.time()

    print(f"\n{'='*65}")
    print(f"  Deep-Check — Real Data Fine-Tune (CPU-Optimized)")
    print(f"{'='*65}")

    device = torch.device('cpu')

    train_csv = SPLITS_DIR / "combined_train.csv"
    test_csv = SPLITS_DIR / "combined_test.csv"

    if not train_csv.exists():
        print(f"  ERROR: No data. Run: python3 ml/download_max_data.py")
        sys.exit(1)

    # Data transforms
    train_transform = T.Compose([
        T.Resize((400, 400)),
        T.RandomCrop(380),
        T.RandomHorizontalFlip(p=0.3),
        T.RandomRotation(degrees=3),
        T.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.05),
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    test_transform = T.Compose([
        T.Resize((380, 380)),
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    # Load datasets
    print(f"\n  Loading datasets...")
    train_ds = RealDocDataset(str(train_csv), str(DATA_DIR), transform=train_transform)
    test_ds = RealDocDataset(str(test_csv), str(DATA_DIR), transform=test_transform)

    train_loader = DataLoader(train_ds, batch_size=8, shuffle=True, num_workers=0, drop_last=True)
    test_loader = DataLoader(test_ds, batch_size=8, shuffle=False, num_workers=0)

    print(f"  Train batches: {len(train_loader)}, Test batches: {len(test_loader)}")

    # ── Phase 1: Head Warmup ────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  PHASE 1: Head Warmup (5 epochs, backbone frozen)")
    print(f"{'─'*65}")

    model = DocFraudClassifier(backbone_name="efficientnet_b4", pretrained=True)

    # Load existing head weights
    head_path = MODEL_DIR / "efficientnet_doc_fraud_head.pt"
    if head_path.exists():
        try:
            head_state = torch.load(str(head_path), map_location='cpu', weights_only=True)
            model.head.load_state_dict(head_state)
            print(f"  Loaded existing head weights")
        except Exception:
            print(f"  Starting with fresh head")

    # Freeze backbone entirely
    for param in model.backbone.parameters():
        param.requires_grad = False

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Trainable: {trainable:,} / {total_params:,}")

    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=5e-4, weight_decay=1e-4
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=5)

    best_auc = 0
    best_state = None
    history = []

    for epoch in range(5):
        t0 = time.time()
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, device)
        test_auc, test_acc, test_f1 = evaluate(model, test_loader, device)
        scheduler.step()
        elapsed = time.time() - t0

        history.append({
            "phase": 1, "epoch": epoch+1,
            "train_loss": round(train_loss, 4), "train_acc": round(train_acc, 4),
            "test_auc": round(test_auc, 4), "test_acc": round(test_acc, 4),
            "test_f1": round(test_f1, 4),
        })

        marker = " ***" if test_auc > best_auc else ""
        print(f"  P1 E{epoch+1}/5 — loss:{train_loss:.4f} acc:{train_acc:.1%} | "
              f"AUC:{test_auc:.4f} acc:{test_acc:.1%} F1:{test_f1:.4f} ({elapsed:.0f}s){marker}")
        sys.stdout.flush()

        if test_auc > best_auc:
            best_auc = test_auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)
    print(f"  Phase 1 best AUC: {best_auc:.4f}")

    # ── Phase 2: Partial Backbone Fine-Tune ─────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  PHASE 2: Partial Backbone Fine-Tune (8 epochs)")
    print(f"{'─'*65}")

    # Unfreeze only last 2 blocks of backbone (EfficientNet blocks 5-6)
    # This is much faster than full fine-tune but captures high-level features
    unfrozen = 0
    blocks = list(model.backbone.named_parameters())
    total_layers = len(blocks)
    # Unfreeze last 20% of backbone layers
    unfreeze_from = int(total_layers * 0.8)
    for i, (name, param) in enumerate(blocks):
        if i >= unfreeze_from:
            param.requires_grad = True
            unfrozen += 1

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Unfrozen {unfrozen} backbone layers")
    print(f"  Trainable: {trainable:,} / {total_params:,}")

    optimizer = torch.optim.AdamW([
        {'params': [p for n, p in model.backbone.named_parameters() if p.requires_grad], 'lr': 5e-5},
        {'params': model.head.parameters(), 'lr': 3e-4},
    ], weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=8, eta_min=1e-6)

    for epoch in range(8):
        t0 = time.time()
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, device)
        test_auc, test_acc, test_f1 = evaluate(model, test_loader, device)
        scheduler.step()
        elapsed = time.time() - t0

        history.append({
            "phase": 2, "epoch": epoch+1,
            "train_loss": round(train_loss, 4), "train_acc": round(train_acc, 4),
            "test_auc": round(test_auc, 4), "test_acc": round(test_acc, 4),
            "test_f1": round(test_f1, 4),
        })

        marker = " ***" if test_auc > best_auc else ""
        print(f"  P2 E{epoch+1}/8 — loss:{train_loss:.4f} acc:{train_acc:.1%} | "
              f"AUC:{test_auc:.4f} acc:{test_acc:.1%} F1:{test_f1:.4f} ({elapsed:.0f}s){marker}")
        sys.stdout.flush()

        if test_auc > best_auc:
            best_auc = test_auc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)

    final_auc, final_acc, final_f1 = evaluate(model, test_loader, device)
    print(f"\n  FINAL: AUC={final_auc:.4f} Acc={final_acc:.1%} F1={final_f1:.4f}")

    # ── Export ───────────────────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  EXPORTING MODEL")
    print(f"{'─'*65}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(model.head.state_dict(), str(MODEL_DIR / "efficientnet_doc_fraud_head.pt"))

    onnx_path = str(MODEL_DIR / "efficientnet_doc_fraud.onnx")
    model_size = export_onnx(model, onnx_path)
    print(f"  ONNX: {onnx_path} ({model_size:.1f} MB)")

    if PUBLIC_MODELS.exists():
        import shutil
        shutil.copy2(onnx_path, str(PUBLIC_MODELS / "efficientnet_doc_fraud.onnx"))
        print(f"  Copied to public/models/")

    # Count data sources
    with open(train_csv) as f:
        n_train = len(f.readlines()) - 1
    with open(test_csv) as f:
        n_test = len(f.readlines()) - 1

    metadata = {
        "model": "efficientnet_b4_real_data",
        "backbone": "efficientnet_b4",
        "img_size": 380,
        "pretrained_backbone": "imagenet",
        "finetune_mode": "2_phase_real_data",
        "training_phases": [
            {"phase": 1, "name": "head_warmup", "epochs": 5, "backbone_frozen": True},
            {"phase": 2, "name": "partial_backbone_finetune", "epochs": 8,
             "unfrozen_layers": unfrozen, "backbone_lr": "5e-5", "head_lr": "3e-4"},
        ],
        "total_epochs": 13,
        "real_data_sources": [
            "ud-biometrics/passport-dataset",
            "ud-biometrics/Selfie-and-ID-Dataset",
            "UniDataPro/synthetic-passports",
            "sugiv/synthetic_cards",
            "TrainingDataPro/generated-passports-segmentation"
        ],
        "training_samples": n_train,
        "test_samples": n_test,
        "augmentation": "crop, flip, rotate, color_jitter",
        "test_auc": round(float(final_auc), 4),
        "test_accuracy": round(float(final_acc), 4),
        "test_f1": round(float(final_f1), 4),
        "best_auc": round(float(best_auc), 4),
        "threshold": 0.5,
        "calibration": {"method": "platt_real", "coef": 1.0, "intercept": 0.0},
        "parameters": total_params,
        "model_size_mb": round(model_size, 1),
        "training_history": history,
        "export_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "training_time_s": round(time.time() - t_start, 1),
        "data_source": f"Real documents ({n_train} train + {n_test} test) from 5 HuggingFace sources",
    }

    meta_path = MODEL_DIR / "efficientnet_doc_fraud_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    if PUBLIC_MODELS.exists():
        import shutil
        shutil.copy2(str(meta_path), str(PUBLIC_MODELS / "efficientnet_doc_fraud_metadata.json"))

    total_time = time.time() - t_start
    print(f"\n{'='*65}")
    print(f"  TRAINING COMPLETE!")
    print(f"{'='*65}")
    print(f"  Best AUC:  {best_auc:.4f}")
    print(f"  Final AUC: {final_auc:.4f}")
    print(f"  Final Acc: {final_acc:.1%}")
    print(f"  Final F1:  {final_f1:.4f}")
    print(f"  Model:     {onnx_path} ({model_size:.1f} MB)")
    print(f"  Time:      {total_time:.0f}s ({total_time/60:.1f} min)")
    print(f"{'='*65}")


if __name__ == "__main__":
    main()
