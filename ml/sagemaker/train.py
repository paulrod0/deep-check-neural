#!/usr/bin/env python3
"""
SageMaker Training Script for Deep-Check Document Fraud Classifier
====================================================================

Runs inside a SageMaker Training Job container. Downloads data from S3,
trains EfficientNet-B4 in 3 phases, exports ONNX model back to S3.

Supports continuous learning: loads previous head weights when available.

Environment variables (set by SageMaker):
  SM_CHANNEL_TRAINING  — path to training data (S3 → local)
  SM_MODEL_DIR         — path to save trained model (local → S3)
  SM_OUTPUT_DATA_DIR   — path for output artifacts
  SM_NUM_GPUS          — number of GPUs available
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as T
from PIL import Image

# Install timm if not present (SageMaker container)
try:
    import timm
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'timm'], check=True)
    import timm

from sklearn.metrics import roc_auc_score, f1_score, accuracy_score


# ── Model Architecture ────────────────────────────────────────────────────

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
        return self.head(self.backbone(x)).squeeze(-1)


# ── Dataset ───────────────────────────────────────────────────────────────

class DocDataset(Dataset):
    def __init__(self, root_dir, transform=None):
        self.transform = transform
        self.samples = []
        root = Path(root_dir)
        for d, label in [('genuine', 0), ('tampered', 1)]:
            p = root / d
            if p.exists():
                for f in sorted(p.glob('*.jpg')) + sorted(p.glob('*.png')):
                    self.samples.append((str(f), label))
        np.random.seed(42)
        np.random.shuffle(self.samples)

    def __len__(self): return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert('RGB')
        except Exception:
            img = Image.new('RGB', (380, 380), (128, 128, 128))
        if self.transform:
            img = self.transform(img)
        return img, torch.tensor(label, dtype=torch.float32)


# ── Focal Loss ────────────────────────────────────────────────────────────

class FocalLoss(nn.Module):
    def __init__(self, alpha=1.0, gamma=2.0):
        super().__init__()
        self.alpha, self.gamma = alpha, gamma

    def forward(self, logits, targets):
        bce = nn.functional.binary_cross_entropy_with_logits(logits, targets, reduction='none')
        pt = torch.exp(-bce)
        return (self.alpha * (1 - pt) ** self.gamma * bce).mean()


# ── Training helpers ──────────────────────────────────────────────────────

def evaluate(model, loader, device):
    model.train(False)
    all_probs, all_labels = [], []
    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device)
            if device.type == 'cuda':
                with torch.amp.autocast('cuda'):
                    logits = model(images)
            else:
                logits = model(images)
            all_probs.extend(torch.sigmoid(logits).cpu().numpy().tolist())
            all_labels.extend(labels.numpy().tolist())
    p, l = np.array(all_probs), np.array(all_labels)
    preds = (p > 0.5).astype(int)
    auc = float(roc_auc_score(l, p)) if len(set(l)) > 1 else 0.5
    return auc, float(accuracy_score(l, preds)), float(f1_score(l, preds, zero_division=0))


def train_phase(model, loader, test_loader, criterion, optimizer, scheduler,
                device, scaler, n_epochs, phase_name, best_auc, model_dir, history):
    for epoch in range(n_epochs):
        t0 = time.time()
        model.train()
        total_loss, correct, total = 0, 0, 0
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            if scaler:
                with torch.amp.autocast('cuda'):
                    logits = model(images)
                    loss = criterion(logits, labels)
                scaler.scale(loss).backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                scaler.step(optimizer)
                scaler.update()
            else:
                logits = model(images)
                loss = criterion(logits, labels)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
            total_loss += loss.item() * images.size(0)
            preds = (torch.sigmoid(logits) > 0.5).float()
            correct += (preds == labels).sum().item()
            total += images.size(0)
        if scheduler:
            scheduler.step()

        auc, acc, f1 = evaluate(model, test_loader, device)
        marker = ' ***' if auc > best_auc else ''
        print(f"  {phase_name} E{epoch+1}/{n_epochs} — loss:{total_loss/total:.4f} "
              f"acc:{correct/total:.1%} | AUC:{auc:.4f} F1:{f1:.4f} ({time.time()-t0:.0f}s){marker}")
        history.append({'phase': phase_name, 'epoch': epoch+1,
                        'auc': round(auc, 4), 'acc': round(acc, 4), 'f1': round(f1, 4)})
        if auc > best_auc:
            best_auc = auc
            torch.save(model.state_dict(), str(Path(model_dir) / 'best_model.pt'))
    return best_auc


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=str, default='ml/data/combined')
    parser.add_argument('--model-dir', type=str, default='ml/models')
    parser.add_argument('--output-dir', type=str, default='ml/output')
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--warmup-epochs', type=int, default=5)
    parser.add_argument('--finetune-epochs', type=int, default=15)
    parser.add_argument('--mining-epochs', type=int, default=5)
    args = parser.parse_args()

    t_start = time.time()
    training_dir = Path(__file__).parent.parent.parent / args.data_dir \
        if not Path(args.data_dir).is_absolute() else Path(args.data_dir)
    # SageMaker overrides
    training_dir = Path(args.data_dir) if 'SM_CHANNEL_TRAINING' not in vars() else training_dir
    sm_training = Path(vars().get('SM_CHANNEL_TRAINING', str(training_dir)))
    sm_model = Path(vars().get('SM_MODEL_DIR', args.model_dir))
    sm_output = Path(vars().get('SM_OUTPUT_DATA_DIR', args.output_dir))

    for d in [sm_model, sm_output]:
        d.mkdir(parents=True, exist_ok=True)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    n_gpus = max(1, torch.cuda.device_count()) if device.type == 'cuda' else 0
    print(f"Device: {device}, GPUs: {n_gpus}")

    # Transforms
    train_tf = T.Compose([
        T.Resize((400, 400)), T.RandomCrop(380), T.RandomHorizontalFlip(0.3),
        T.RandomRotation(5), T.ColorJitter(0.2, 0.2, 0.15, 0.03),
        T.RandomPerspective(0.1, p=0.2), T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        T.RandomErasing(p=0.15, scale=(0.02, 0.1)),
    ])
    test_tf = T.Compose([
        T.Resize((380, 380)), T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    ds = DocDataset(str(sm_training), transform=train_tf)
    n_test = max(50, len(ds) // 5)
    n_train = len(ds) - n_test
    train_ds, _ = torch.utils.data.random_split(ds, [n_train, n_test])
    test_ds = torch.utils.data.Subset(DocDataset(str(sm_training), test_tf),
                                       list(range(n_train, len(ds))))

    bs = args.batch_size * max(1, n_gpus)
    nw = 4 if device.type == 'cuda' else 0
    train_loader = DataLoader(train_ds, bs, True, num_workers=nw, pin_memory=True, drop_last=True)
    test_loader = DataLoader(test_ds, bs, False, num_workers=nw, pin_memory=True)
    print(f"Train: {n_train}, Test: {n_test}")

    # Model
    model = DocFraudClassifier().to(device)
    head_path = sm_training / 'previous_head.pt'
    if head_path.exists():
        try:
            model.head.load_state_dict(torch.load(str(head_path), map_location='cpu', weights_only=True))
            print("Loaded previous head for continuous learning")
        except Exception:
            pass
    if n_gpus > 1:
        model = nn.DataParallel(model)

    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    bce = nn.BCEWithLogitsLoss()
    focal = FocalLoss()
    best_auc = 0
    history = []

    # Phase 1: Head warmup
    print(f"\n{'='*60}\nPHASE 1: Head Warmup\n{'='*60}")
    for p in model.parameters(): p.requires_grad = False
    bm = model.module if hasattr(model, 'module') else model
    for p in bm.head.parameters(): p.requires_grad = True
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=5e-4, weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.warmup_epochs)
    best_auc = train_phase(model, train_loader, test_loader, bce, opt, sch, device, scaler,
                           args.warmup_epochs, 'P1', best_auc, str(sm_model), history)

    # Phase 2: Full fine-tune
    print(f"\n{'='*60}\nPHASE 2: Full Fine-Tune\n{'='*60}")
    for p in model.parameters(): p.requires_grad = True
    opt = torch.optim.AdamW([
        {'params': bm.backbone.parameters(), 'lr': 1e-5},
        {'params': bm.head.parameters(), 'lr': 1e-4},
    ], weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.finetune_epochs, eta_min=1e-7)
    best_auc = train_phase(model, train_loader, test_loader, bce, opt, sch, device, scaler,
                           args.finetune_epochs, 'P2', best_auc, str(sm_model), history)

    # Phase 3: Hard negative mining
    print(f"\n{'='*60}\nPHASE 3: Hard Negative Mining\n{'='*60}")
    bp = sm_model / 'best_model.pt'
    if bp.exists():
        model.load_state_dict(torch.load(str(bp), map_location=device))
    opt = torch.optim.AdamW([
        {'params': bm.backbone.parameters(), 'lr': 3e-6},
        {'params': bm.head.parameters(), 'lr': 3e-5},
    ], weight_decay=1e-4)
    best_auc = train_phase(model, train_loader, test_loader, focal, opt, None, device, scaler,
                           args.mining_epochs, 'P3', best_auc, str(sm_model), history)

    # Export ONNX
    if bp.exists():
        model.load_state_dict(torch.load(str(bp), map_location='cpu'))
    m = model.module if hasattr(model, 'module') else model
    m = m.cpu()
    m.train(False)
    onnx_path = str(sm_model / 'efficientnet_doc_fraud.onnx')
    torch.onnx.export(m, torch.randn(1, 3, 380, 380), onnx_path,
                      input_names=['input_image'], output_names=['logit'],
                      dynamic_axes={'input_image': {0: 'batch'}, 'logit': {0: 'batch'}},
                      opset_version=14, do_constant_folding=True)
    torch.save(m.head.state_dict(), str(sm_model / 'efficientnet_doc_fraud_head.pt'))

    # Metadata
    meta = {
        'model': 'efficientnet_b4_sagemaker', 'backbone': 'efficientnet_b4',
        'img_size': 380, 'test_auc': round(best_auc, 4),
        'training_time_s': round(time.time() - t_start, 1),
        'history': history, 'continuous_learning': True,
        'export_date': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
    with open(str(sm_model / 'efficientnet_doc_fraud_metadata.json'), 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"\n{'='*60}\nTRAINING COMPLETE! Best AUC: {best_auc:.4f}\n{'='*60}")


if __name__ == '__main__':
    main()
