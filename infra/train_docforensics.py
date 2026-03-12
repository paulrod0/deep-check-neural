#!/usr/bin/env python3
"""
train_docforensics.py — DocForensics CNN Training Script
=========================================================
Trains a MobileNetV3-Small model to classify document types and detect manipulation.

Architecture:
  - Base: MobileNetV3-Small (pretrained on ImageNet, torchvision)
  - Two heads:
      1. Document type: softmax over 8 classes
      2. Manipulation score: sigmoid (binary: authentic vs. manipulated)
  - Input: 224×224×3 (ImageNet normalised)
  - Output: doc_type_logits (8), manipulation_logit (1)

Dataset (generated synthetically):
  - Authentic: clean renders with light noise
  - Manipulated: PIL-based modifications (text replacement, copy-paste, color shift)

Training:
  - 50 epochs, AdamW, cosine annealing, label smoothing 0.1
  - Exports to ONNX then uploads to S3

Usage:
  python train_docforensics.py --output-dir /tmp/docforensics --s3-bucket deep-check-models
"""

import argparse
import os
import io
import random
import math
import json
import logging
import subprocess
from pathlib import Path
from typing import Tuple, List, Optional

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from torchvision.models import MobileNet_V3_Small_Weights

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("WARNING: PIL not available, will use dummy dataset")

# ── Config ────────────────────────────────────────────────────────────────────

DOCUMENT_CLASSES = [
    "invoice", "id_card", "passport", "certificate",
    "payslip", "media_photo", "screenshot", "other",
]
NUM_CLASSES  = len(DOCUMENT_CLASSES)
IMAGE_SIZE   = 224
BATCH_SIZE   = 32
NUM_EPOCHS   = 50
LR           = 1e-3
WEIGHT_DECAY = 1e-4
SAMPLES_PER_CLASS = 200   # reduced for reasonable training time; increase for production

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

# ── Model definition ──────────────────────────────────────────────────────────

class DocForensicsModel(nn.Module):
    """MobileNetV3-Small with two output heads."""

    def __init__(self, num_classes: int = NUM_CLASSES):
        super().__init__()
        base = models.mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1)
        # Replace the classifier
        in_features = base.classifier[0].in_features
        self.features    = base.features
        self.avgpool     = base.avgpool
        self.shared_fc   = nn.Sequential(
            nn.Linear(in_features, 256),
            nn.Hardswish(),
            nn.Dropout(0.2),
        )
        self.doc_type_head   = nn.Linear(256, num_classes)
        self.manip_head      = nn.Linear(256, 1)

    def forward(self, x: torch.Tensor):
        x = self.features(x)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        x = self.shared_fc(x)
        doc_type_logits   = self.doc_type_head(x)
        manipulation_logit = self.manip_head(x)
        return doc_type_logits, manipulation_logit


# ── Synthetic dataset ─────────────────────────────────────────────────────────

def _random_text_color():
    return (random.randint(0, 80), random.randint(0, 80), random.randint(0, 80))


def _make_white_document(doc_class: str, size: Tuple[int,int] = (600, 800)) -> Image.Image:
    """Generate a synthetic white-background document."""
    img = Image.new("RGB", size, color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Title
    title_map = {
        "invoice":     "FACTURA / INVOICE",
        "id_card":     "DOCUMENTO NACIONAL DE IDENTIDAD",
        "passport":    "PASSPORT / PASAPORTE",
        "certificate": "CERTIFICADO",
        "payslip":     "NOMINA / PAYSLIP",
        "media_photo": None,
        "screenshot":  None,
        "other":       "DOCUMENTO",
    }
    title = title_map.get(doc_class, "DOCUMENTO")
    if title:
        draw.rectangle([20, 20, size[0]-20, 80], fill=(20, 60, 140))
        draw.text((size[0]//2, 50), title, fill=(255,255,255), anchor="mm")

    # Random text lines
    for y in range(100, size[1]-50, 22):
        line_len = random.randint(30, size[0]-60)
        draw.line([(30, y), (30 + line_len, y)], fill=_random_text_color(), width=2)

    # For invoices, add a table
    if doc_class == "invoice":
        for row in range(250, 500, 30):
            for col in range(30, size[0]-30, (size[0]-60)//4):
                draw.rectangle([col, row, col+80, row+25], outline=(200,200,200))
                val = f"{random.uniform(10, 999):.2f}"
                draw.text((col+5, row+5), val, fill=(0,0,0))

    return img


def _apply_manipulation(img: Image.Image) -> Image.Image:
    """Apply a random manipulation to the image."""
    manip_type = random.choice(["color_shift", "copy_paste", "jpeg_recompress", "text_replace"])

    if manip_type == "color_shift":
        # Shift a rectangular region's color
        w, h = img.size
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        x2, y2 = x1 + random.randint(50, w//3), y1 + random.randint(20, h//4)
        region = img.crop((x1, y1, x2, y2))
        # Slight color adjustment
        factor = random.uniform(0.85, 1.15)
        adjusted = region.point(lambda p: min(255, int(p * factor)))
        img_copy = img.copy()
        img_copy.paste(adjusted, (x1, y1))
        return img_copy

    elif manip_type == "copy_paste":
        # Copy a region and paste it elsewhere
        w, h = img.size
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        x2, y2 = x1 + random.randint(30, 100), y1 + random.randint(20, 60)
        region = img.crop((x1, y1, x2, y2))
        px, py = random.randint(0, w - (x2-x1)), random.randint(0, h - (y2-y1))
        img_copy = img.copy()
        img_copy.paste(region, (px, py))
        return img_copy

    elif manip_type == "jpeg_recompress":
        # JPEG re-compression artifact
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=random.randint(50, 75))
        buf.seek(0)
        return Image.open(buf).copy()

    else:
        # Overwrite text in a region with new value
        img_copy = img.copy()
        draw = ImageDraw.Draw(img_copy)
        w, h = img_copy.size
        x = random.randint(30, w - 100)
        y = random.randint(100, h - 50)
        draw.rectangle([x, y, x+80, y+20], fill=(255,255,255))
        draw.text((x+2, y+2), f"{random.uniform(100, 9999):.2f}", fill=(0,0,0))
        return img_copy


def _add_scan_noise(img: Image.Image) -> Image.Image:
    """Add realistic scan noise to a document image."""
    import random as rnd
    w, h = img.size
    arr = bytearray(img.tobytes())
    for i in range(0, len(arr), 3):
        noise = rnd.randint(-8, 8)
        arr[i]   = max(0, min(255, arr[i]   + noise))
        arr[i+1] = max(0, min(255, arr[i+1] + noise))
        arr[i+2] = max(0, min(255, arr[i+2] + noise))
    return Image.frombytes("RGB", (w, h), bytes(arr))


class DocForensicsDataset(Dataset):
    """Synthetic document forensics dataset."""

    def __init__(self, samples_per_class: int = SAMPLES_PER_CLASS, train: bool = True):
        self.samples: List[Tuple[str, int, int]] = []  # (doc_class, class_idx, is_manipulated)
        self.train = train
        self.transform = transforms.Compose([
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            transforms.RandomHorizontalFlip() if train else transforms.Lambda(lambda x: x),
            transforms.RandomRotation(5) if train else transforms.Lambda(lambda x: x),
            transforms.ColorJitter(brightness=0.1, contrast=0.1) if train else transforms.Lambda(lambda x: x),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        for class_idx, doc_class in enumerate(DOCUMENT_CLASSES):
            # 50% authentic, 50% manipulated
            for is_manip in [0, 1]:
                for _ in range(samples_per_class // 2):
                    self.samples.append((doc_class, class_idx, is_manip))
        random.shuffle(self.samples)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        doc_class, class_idx, is_manip = self.samples[idx]
        if PIL_AVAILABLE:
            img = _make_white_document(doc_class)
            if is_manip:
                img = _apply_manipulation(img)
            else:
                img = _add_scan_noise(img)
        else:
            # Dummy: random noise image
            import numpy as np
            img = Image.fromarray(
                np.random.randint(200, 256, (256, 256, 3), dtype='uint8')
            )
        tensor = self.transform(img)
        return tensor, class_idx, is_manip


# ── Training loop ─────────────────────────────────────────────────────────────

def train(args: argparse.Namespace) -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Training on device: {device}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Dataset
    train_dataset = DocForensicsDataset(samples_per_class=args.samples_per_class, train=True)
    val_dataset   = DocForensicsDataset(samples_per_class=max(20, args.samples_per_class // 5), train=False)
    train_loader  = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True,  num_workers=4)
    val_loader    = DataLoader(val_dataset,   batch_size=BATCH_SIZE, shuffle=False, num_workers=4)

    # Model
    model = DocForensicsModel(num_classes=NUM_CLASSES).to(device)

    # Loss functions
    cls_criterion   = nn.CrossEntropyLoss(label_smoothing=0.1)
    manip_criterion = nn.BCEWithLogitsLoss()

    # Optimiser + scheduler
    optimizer = optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_val_acc = 0.0

    for epoch in range(1, args.epochs + 1):
        # Train
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        for images, labels, is_manip in train_loader:
            images   = images.to(device)
            labels   = labels.to(device)
            is_manip = is_manip.float().to(device)

            optimizer.zero_grad()
            doc_logits, manip_logit = model(images)
            loss = cls_criterion(doc_logits, labels) + manip_criterion(manip_logit.squeeze(), is_manip)
            loss.backward()
            optimizer.step()

            train_loss    += loss.item()
            preds          = doc_logits.argmax(dim=1)
            train_correct += (preds == labels).sum().item()
            train_total   += labels.size(0)

        scheduler.step()

        # Validate every 5 epochs
        if epoch % 5 == 0 or epoch == args.epochs:
            model.eval()
            val_correct, val_total = 0, 0
            with torch.no_grad():
                for images, labels, _ in val_loader:
                    images = images.to(device)
                    labels = labels.to(device)
                    doc_logits, _ = model(images)
                    preds = doc_logits.argmax(dim=1)
                    val_correct += (preds == labels).sum().item()
                    val_total   += labels.size(0)

            val_acc = val_correct / max(1, val_total)
            log.info(
                f"Epoch {epoch}/{args.epochs} | "
                f"Train loss: {train_loss/len(train_loader):.4f} | "
                f"Train acc: {train_correct/max(1,train_total):.3f} | "
                f"Val acc: {val_acc:.3f}"
            )

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                torch.save(model.state_dict(), output_dir / "best_model.pt")

    log.info(f"Best validation accuracy: {best_val_acc:.3f}")

    # Export to ONNX
    model.load_state_dict(torch.load(output_dir / "best_model.pt", map_location=device))
    model.eval()

    dummy_input = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE).to(device)
    onnx_path   = output_dir / "model.onnx"

    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_path),
        opset_version=17,
        input_names=["input"],
        output_names=["doc_type_logits", "manipulation_logit"],
        dynamic_axes={"input": {0: "batch_size"}},
        do_constant_folding=True,
    )
    log.info(f"ONNX model saved to: {onnx_path}")

    # Save class labels
    labels_path = output_dir / "class_labels.json"
    with open(labels_path, "w") as f:
        json.dump(DOCUMENT_CLASSES, f)
    log.info(f"Class labels saved to: {labels_path}")

    # Upload to S3 if requested
    if args.s3_bucket:
        s3_prefix = args.s3_prefix or "docforensics"
        for fname in ["model.onnx", "class_labels.json"]:
            local  = output_dir / fname
            remote = f"s3://{args.s3_bucket}/{s3_prefix}/{fname}"
            log.info(f"Uploading {fname} to {remote}")
            ret = subprocess.run(["aws", "s3", "cp", str(local), remote], capture_output=True)
            if ret.returncode != 0:
                log.error(f"Upload failed: {ret.stderr.decode()}")
            else:
                log.info(f"Uploaded: {remote}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train DocForensics CNN")
    parser.add_argument("--output-dir",        default="/tmp/docforensics")
    parser.add_argument("--s3-bucket",         default="deep-check-models")
    parser.add_argument("--s3-prefix",         default="docforensics")
    parser.add_argument("--epochs",            type=int, default=NUM_EPOCHS)
    parser.add_argument("--samples-per-class", type=int, default=SAMPLES_PER_CLASS)
    args = parser.parse_args()
    train(args)
