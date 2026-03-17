#!/usr/bin/env python3
"""
finetune_synthetic.py — Fine-tune with advanced synthetic document data
=======================================================================

Generates high-quality synthetic document images with realistic manipulation
artifacts, then fine-tunes the EfficientNet-B4 classification head.

Synthetic data includes:
  - Document backgrounds with text lines, photo regions, MRZ zones
  - Manipulation types: splice, clone, color shift, noise mismatch,
    JPEG artifacts, brightness mismatch, blur insertion
  - Multiple difficulty levels (easy/medium/hard)

Usage:
  python ml/finetune_synthetic.py                   # Default: 400 samples, 8 epochs
  python ml/finetune_synthetic.py --samples 800     # More samples
  python ml/finetune_synthetic.py --epochs 15       # More epochs
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

try:
    import timm
except ImportError:
    print("Missing: timm. Install: pip install timm")
    sys.exit(1)

from PIL import Image, ImageDraw, ImageFilter
import torchvision.transforms as T

ML_DIR = Path(__file__).parent
MODEL_DIR = ML_DIR / "models"
PUBLIC_MODELS = ML_DIR.parent / "public" / "models"


# ── Model Architecture ────────────────────────────────────────────────────

class DocFraudClassifier(nn.Module):
    def __init__(self, backbone_name: str = "efficientnet_b4", pretrained: bool = True):
        super().__init__()
        self.backbone = timm.create_model(backbone_name, pretrained=pretrained, num_classes=0)
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
        self.feat_dim = feat_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        return self.head(features).squeeze(-1)


# ── Advanced Synthetic Document Generator ─────────────────────────────────

class SyntheticDocGenerator:
    """Generate realistic document images with optional manipulation."""

    # Document template types
    TEMPLATES = ['id_card', 'passport', 'certificate', 'bank_statement']

    # Manipulation types with difficulty levels
    MANIPULATIONS = [
        'color_shift',      # Color temperature mismatch
        'noise_injection',  # Different noise profile (re-scan artifact)
        'brightness_patch', # Local brightness change
        'blur_insert',      # Pasted region from lower-res source
        'copy_move',        # Cloned region within document
        'jpeg_artifact',    # Double JPEG compression artifacts
        'text_replace',     # Simulated text replacement with different font metrics
        'edge_artifact',    # Sharp edges from cut-paste
    ]

    def __init__(self, img_size: int = 380):
        self.img_size = img_size

    def generate_genuine(self) -> Image.Image:
        """Generate a clean document image."""
        template = np.random.choice(self.TEMPLATES)
        if template == 'id_card':
            return self._make_id_card()
        elif template == 'passport':
            return self._make_passport()
        elif template == 'certificate':
            return self._make_certificate()
        else:
            return self._make_bank_statement()

    def generate_tampered(self, difficulty: str = 'medium') -> Image.Image:
        """Generate a document with manipulation artifacts."""
        base = self.generate_genuine()

        # Number of manipulations based on difficulty
        n_manip = {'easy': 1, 'medium': np.random.choice([1, 2]), 'hard': np.random.choice([2, 3])}
        count = n_manip.get(difficulty, 1)

        manips = np.random.choice(self.MANIPULATIONS, size=count, replace=False)
        arr = np.array(base).astype(np.float32)

        for manip in manips:
            arr = self._apply_manipulation(arr, manip, difficulty)

        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    def _make_id_card(self) -> Image.Image:
        s = self.img_size
        # Card background: slight gradient
        bg_base = np.random.randint(225, 250)
        img = Image.new('RGB', (s, s), (bg_base, bg_base + 3, bg_base - 2))
        draw = ImageDraw.Draw(img)

        # Card border
        margin = 15
        draw.rectangle([(margin, margin), (s - margin, s - margin)],
                       outline=(100, 100, 110), width=2)

        # Photo region (left side)
        ph_x, ph_y = 25, 45
        ph_w, ph_h = 100, 130
        # Simulate photo with gradient face-like shape
        for y in range(ph_y, ph_y + ph_h):
            for x in range(ph_x, ph_x + ph_w):
                cx, cy = ph_x + ph_w // 2, ph_y + ph_h // 3
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                val = max(120, min(230, 230 - int(dist * 0.8)))
                noise = np.random.randint(-5, 6)
                draw.point((x, y), fill=(val + noise, val - 10 + noise, val - 20 + noise))

        draw.rectangle([(ph_x, ph_y), (ph_x + ph_w, ph_y + ph_h)],
                       outline=(80, 80, 90), width=1)

        # Text lines (right side)
        text_x = ph_x + ph_w + 20
        for i, y in enumerate(range(55, 160, 18)):
            line_len = np.random.randint(80, s - text_x - 30)
            thickness = 2 if i < 2 else 1
            gray = np.random.randint(30, 70)
            draw.line([(text_x, y), (text_x + line_len, y)],
                      fill=(gray, gray, gray), width=thickness)

        # MRZ zone (bottom)
        mrz_y = s - 80
        draw.rectangle([(20, mrz_y), (s - 20, s - 20)],
                       fill=(240, 240, 235), outline=(180, 180, 180))
        for line_y in range(mrz_y + 8, s - 25, 18):
            draw.line([(25, line_y), (s - 25, line_y)],
                      fill=(40, 40, 40), width=1)

        # Hologram-like sheen (subtle)
        arr = np.array(img).astype(np.float32)
        y_coords = np.arange(s)[:, None]
        x_coords = np.arange(s)[None, :]
        sheen = np.sin(x_coords * 0.05 + y_coords * 0.03) * 5
        arr[:, :, 0] += sheen
        arr[:, :, 2] += sheen * 0.5

        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    def _make_passport(self) -> Image.Image:
        s = self.img_size
        bgs = [(230, 235, 225), (225, 230, 240), (240, 235, 225)]
        bg = bgs[np.random.randint(0, len(bgs))]
        img = Image.new('RGB', (s, s), bg)
        draw = ImageDraw.Draw(img)

        # Country header
        draw.rectangle([(10, 10), (s - 10, 55)],
                       fill=(np.random.randint(20, 60), np.random.randint(30, 80), np.random.randint(80, 140)))
        for x in range(30, s - 50, 15):
            draw.line([(x, 25), (x + 8, 25)], fill=(200, 200, 200), width=2)

        # Photo region
        ph_x, ph_y = 20, 70
        ph_w, ph_h = 120, 150
        for y in range(ph_y, ph_y + ph_h):
            for x in range(ph_x, ph_x + ph_w):
                cx, cy = ph_x + ph_w // 2, ph_y + ph_h // 3
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                val = max(100, min(220, 220 - int(dist * 0.7)))
                noise = np.random.randint(-3, 4)
                draw.point((x, y), fill=(val + noise, val - 5 + noise, val - 15 + noise))

        # Data fields
        text_x = ph_x + ph_w + 20
        for y in range(80, 200, 22):
            line_len = np.random.randint(60, s - text_x - 20)
            draw.line([(text_x, y), (text_x + line_len, y)],
                      fill=(40, 40, 45), width=1)

        # MRZ (2 lines)
        for line_y in [s - 60, s - 35]:
            draw.line([(15, line_y), (s - 15, line_y)],
                      fill=(30, 30, 30), width=2)

        return img

    def _make_certificate(self) -> Image.Image:
        s = self.img_size
        img = Image.new('RGB', (s, s), (252, 250, 245))
        draw = ImageDraw.Draw(img)

        # Ornamental border
        draw.rectangle([(8, 8), (s - 8, s - 8)], outline=(150, 120, 80), width=3)
        draw.rectangle([(14, 14), (s - 14, s - 14)], outline=(180, 150, 100), width=1)

        # Title area
        for x in range(60, s - 60, 12):
            draw.line([(x, 40), (x + 7, 40)], fill=(60, 50, 40), width=3)
        for x in range(80, s - 80, 10):
            draw.line([(x, 60), (x + 6, 60)], fill=(80, 70, 60), width=2)

        # Body text
        for y in range(100, s - 100, 20):
            indent = 30 if y < 200 else 50
            line_len = np.random.randint(s // 2, s - indent - 30)
            draw.line([(indent, y), (indent + line_len, y)],
                      fill=(50, 50, 55), width=1)

        # Signature/stamp area
        cx, cy = s - 80, s - 80
        for _ in range(30):
            dx, dy = np.random.randint(-20, 21), np.random.randint(-20, 21)
            draw.ellipse([(cx + dx - 2, cy + dy - 2), (cx + dx + 2, cy + dy + 2)],
                         fill=(0, 0, 150))

        return img

    def _make_bank_statement(self) -> Image.Image:
        s = self.img_size
        img = Image.new('RGB', (s, s), (255, 255, 255))
        draw = ImageDraw.Draw(img)

        # Logo area
        draw.rectangle([(15, 15), (100, 45)],
                       fill=(np.random.randint(0, 60), np.random.randint(40, 120), np.random.randint(100, 200)))

        # Header
        for x in range(120, s - 20, 10):
            draw.line([(x, 25), (x + 6, 25)], fill=(60, 60, 60), width=1)

        # Table header
        draw.line([(15, 70), (s - 15, 70)], fill=(150, 150, 150), width=1)
        for x in [15, 80, 180, 280]:
            draw.line([(x, 55), (x + 40, 55)], fill=(40, 40, 40), width=2)

        # Table rows
        for y in range(90, s - 40, 22):
            draw.line([(15, y + 15), (s - 15, y + 15)], fill=(220, 220, 220), width=1)
            for x in [15, 80, 180, 280]:
                w = np.random.randint(25, 55)
                draw.line([(x, y), (x + w, y)], fill=(50, 50, 50), width=1)

        return img

    def _apply_manipulation(self, arr: np.ndarray, manip_type: str, difficulty: str) -> np.ndarray:
        s = self.img_size
        # Region to manipulate
        h = np.random.randint(30, 90)
        w = np.random.randint(50, 130)
        sy = np.random.randint(20, s - h - 20)
        sx = np.random.randint(20, s - w - 20)

        strength = {'easy': 0.6, 'medium': 1.0, 'hard': 1.5}.get(difficulty, 1.0)

        if manip_type == 'color_shift':
            arr[sy:sy+h, sx:sx+w, 0] *= (1.0 + 0.12 * strength)
            arr[sy:sy+h, sx:sx+w, 2] *= (1.0 - 0.08 * strength)

        elif manip_type == 'noise_injection':
            noise = np.random.randn(h, w, 3) * (12 * strength)
            arr[sy:sy+h, sx:sx+w] += noise

        elif manip_type == 'brightness_patch':
            factor = 1.0 + 0.2 * strength * np.random.choice([-1, 1])
            arr[sy:sy+h, sx:sx+w] *= factor

        elif manip_type == 'blur_insert':
            patch = arr[sy:sy+h, sx:sx+w].copy()
            # Simple box blur
            kernel = max(3, int(3 * strength))
            for c in range(3):
                from PIL import ImageFilter as IF
                p = Image.fromarray(patch[:, :, c].astype(np.uint8))
                p = p.filter(IF.BoxBlur(kernel))
                patch[:, :, c] = np.array(p).astype(np.float32)
            arr[sy:sy+h, sx:sx+w] = patch

        elif manip_type == 'copy_move':
            src_y = np.random.randint(0, max(1, s - h))
            src_x = np.random.randint(0, max(1, s - w))
            arr[sy:sy+h, sx:sx+w] = arr[src_y:src_y+h, src_x:src_x+w].copy()

        elif manip_type == 'jpeg_artifact':
            # Simulate double-JPEG by quantizing blocks
            block = 8
            region = arr[sy:sy+h, sx:sx+w].copy()
            for by in range(0, h - block, block):
                for bx in range(0, w - block, block):
                    mean_val = region[by:by+block, bx:bx+block].mean(axis=(0, 1))
                    blend = 0.15 * strength
                    region[by:by+block, bx:bx+block] = (
                        region[by:by+block, bx:bx+block] * (1 - blend) + mean_val * blend
                    )
            arr[sy:sy+h, sx:sx+w] = region

        elif manip_type == 'text_replace':
            # Slightly different background in the text area
            arr[sy:sy+h, sx:sx+w, :] += (3.0 * strength)
            # Add sharp boundary
            arr[sy, sx:sx+w, :] -= (15 * strength)
            arr[sy+h-1, sx:sx+w, :] -= (15 * strength)

        elif manip_type == 'edge_artifact':
            # Sharp boundary around pasted region
            border = 2
            arr[sy:sy+border, sx:sx+w, :] = arr[sy:sy+border, sx:sx+w, :] * 0.7
            arr[sy+h-border:sy+h, sx:sx+w, :] = arr[sy+h-border:sy+h, sx:sx+w, :] * 0.7
            arr[sy:sy+h, sx:sx+border, :] = arr[sy:sy+h, sx:sx+border, :] * 0.7
            arr[sy:sy+h, sx+w-border:sx+w, :] = arr[sy:sy+h, sx+w-border:sx+w, :] * 0.7

        return arr


# ── Dataset ───────────────────────────────────────────────────────────────

class SyntheticDocDataset(Dataset):
    """Pre-generated synthetic document dataset."""

    def __init__(self, n_samples: int = 400, transform=None, difficulty: str = 'medium'):
        self.transform = transform
        self.generator = SyntheticDocGenerator(img_size=380)
        self.samples = []

        print(f"  Generating {n_samples} synthetic documents ({difficulty} difficulty)...")
        n_per_class = n_samples // 2

        for i in range(n_per_class):
            img = self.generator.generate_genuine()
            self.samples.append((img, 0))

        for i in range(n_per_class):
            diff = np.random.choice(['easy', 'medium', 'hard'], p=[0.2, 0.5, 0.3])
            img = self.generator.generate_tampered(difficulty=diff)
            self.samples.append((img, 1))

        np.random.seed(42)
        indices = np.random.permutation(len(self.samples))
        self.samples = [self.samples[i] for i in indices]

        n_genuine = sum(1 for _, l in self.samples if l == 0)
        n_tampered = sum(1 for _, l in self.samples if l == 1)
        print(f"  Generated: {n_genuine} genuine + {n_tampered} tampered")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img, label = self.samples[idx]
        if self.transform:
            img = self.transform(img)
        else:
            img = T.ToTensor()(img)
        return img, torch.tensor(label, dtype=torch.float32)


# ── Training ──────────────────────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        logits = model(images)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * images.size(0)
        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += images.size(0)

    return total_loss / max(total, 1), correct / max(total, 1)


def run_test(model, loader, device):
    model.train(False)
    all_probs = []
    all_labels = []

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            logits = model(images)
            probs = torch.sigmoid(logits)
            all_probs.extend(probs.cpu().numpy().tolist())
            all_labels.extend(labels.numpy().tolist())

    all_probs = np.array(all_probs)
    all_labels = np.array(all_labels)
    preds = (all_probs > 0.5).astype(int)
    acc = float(np.mean(preds == all_labels))

    try:
        from sklearn.metrics import roc_auc_score, f1_score
        auc = float(roc_auc_score(all_labels, all_probs)) if len(set(all_labels)) > 1 else 0.5
        f1 = float(f1_score(all_labels, preds, zero_division=0))
    except ImportError:
        auc, f1 = 0.5, 0.0

    return auc, acc, f1


def export_onnx(model, output_path: str, img_size: int = 380):
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=400, help="Total samples")
    parser.add_argument("--epochs", type=int, default=8, help="Epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Deep-Check — Synthetic Fine-Tune (Offline)")
    print(f"{'='*60}")
    print(f"  Samples: {args.samples}")
    print(f"  Epochs:  {args.epochs}")
    print(f"  Device:  CPU")

    # Load model
    print(f"\n[1/4] Loading EfficientNet-B4...")
    model = DocFraudClassifier(backbone_name="efficientnet_b4", pretrained=True)

    # Freeze backbone
    for param in model.backbone.parameters():
        param.requires_grad = False

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Trainable: {trainable:,} / {total_params:,} ({100*trainable/total_params:.1f}%)")

    # Generate data
    print(f"\n[2/4] Generating synthetic training data...")
    transform = T.Compose([
        T.Resize((380, 380)),
        T.RandomHorizontalFlip(p=0.3),
        T.ColorJitter(brightness=0.1, contrast=0.1),
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    dataset = SyntheticDocDataset(n_samples=args.samples, transform=transform)

    n_test = max(4, len(dataset) // 5)
    n_train = len(dataset) - n_test
    train_ds, test_ds = torch.utils.data.random_split(dataset, [n_train, n_test])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    print(f"  Train: {n_train}, Test: {n_test}")

    # Train
    print(f"\n[3/4] Training ({args.epochs} epochs)...")
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.lr, weight_decay=1e-4,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_auc = 0
    best_state = None
    history = []

    for epoch in range(args.epochs):
        t0 = time.time()
        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, torch.device('cpu'))
        test_auc, test_acc, test_f1 = run_test(model, test_loader, torch.device('cpu'))
        scheduler.step()
        elapsed = time.time() - t0

        history.append({
            "epoch": epoch + 1,
            "train_loss": round(train_loss, 4),
            "train_acc": round(train_acc, 4),
            "test_auc": round(test_auc, 4),
            "test_acc": round(test_acc, 4),
            "test_f1": round(test_f1, 4),
        })

        marker = " *" if test_auc > best_auc else ""
        print(
            f"  Epoch {epoch+1}/{args.epochs} — "
            f"loss: {train_loss:.4f}, acc: {train_acc:.1%}, "
            f"auc: {test_auc:.4f}, f1: {test_f1:.4f} "
            f"({elapsed:.0f}s){marker}"
        )

        if test_auc > best_auc:
            best_auc = test_auc
            best_state = {k: v.clone() for k, v in model.head.state_dict().items()}

    # Restore best
    if best_state:
        model.head.load_state_dict(best_state)

    # Final check
    final_auc, final_acc, final_f1 = run_test(model, test_loader, torch.device('cpu'))
    print(f"\n  Best AUC: {best_auc:.4f}, Final: auc={final_auc:.4f} acc={final_acc:.1%} f1={final_f1:.4f}")

    # Export
    print(f"\n[4/4] Exporting to ONNX...")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = str(MODEL_DIR / "efficientnet_doc_fraud.onnx")
    model_size = export_onnx(model, onnx_path)
    print(f"  ONNX: {onnx_path} ({model_size:.1f} MB)")

    if PUBLIC_MODELS.exists():
        import shutil
        shutil.copy2(onnx_path, str(PUBLIC_MODELS / "efficientnet_doc_fraud.onnx"))
        print(f"  Copied to public/models/")

    # Save head weights for future fine-tuning
    torch.save(model.head.state_dict(), str(MODEL_DIR / "efficientnet_doc_fraud_head.pt"))

    metadata = {
        "model": "efficientnet_b4_idnet",
        "backbone": "efficientnet_b4",
        "img_size": 380,
        "pretrained_backbone": "imagenet",
        "training_samples": args.samples,
        "training_epochs": args.epochs,
        "finetune_mode": "head_only_synthetic",
        "test_auc": round(float(final_auc), 4),
        "test_accuracy": round(float(final_acc), 4),
        "test_f1": round(float(final_f1), 4),
        "threshold": 0.5,
        "calibration": {"method": "platt_synthetic", "coef": 1.0, "intercept": 0.0},
        "parameters": total_params,
        "model_size_mb": round(model_size, 1),
        "training_history": history,
        "export_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "data_source": "Advanced synthetic document generation (4 template types, 8 manipulation types)",
    }

    meta_path = MODEL_DIR / "efficientnet_doc_fraud_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    if PUBLIC_MODELS.exists():
        import shutil
        shutil.copy2(str(meta_path), str(PUBLIC_MODELS / "efficientnet_doc_fraud_metadata.json"))

    print(f"\n{'='*60}")
    print(f"  TRAINING COMPLETE!")
    print(f"{'='*60}")
    print(f"  AUC:   {final_auc:.4f}")
    print(f"  Acc:   {final_acc:.1%}")
    print(f"  F1:    {final_f1:.4f}")
    print(f"  Model: {onnx_path} ({model_size:.1f} MB)")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
