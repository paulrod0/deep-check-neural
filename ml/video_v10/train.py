#!/usr/bin/env python3
"""
Deep-Check V10 Video Training — VideoMAE-L backbone + temporal head.

Architecture:
  - Backbone: MCG-NJU/videomae-large (304M params, pretrained on Kinetics-400)
  - Input: 16 frames x 224x224 x 3, sampled at 2fps
  - Head: LayerNorm -> Linear(1024, 512) -> GELU -> Dropout(0.3) -> Linear(512, 1)
  - Loss: BCEWithLogits + focal (gamma=2) + label smoothing (0.1)

Training:
  - DDP on 4x A10G (g5.12xlarge)
  - Batch: 32/GPU x 4 = 128 (grad accum 2 -> effective 256)
  - Precision: bfloat16 autocast (A10G native)
  - Optimizer: AdamW, lr=1e-4 cosine, warmup 2 epochs, wd=0.05
  - Augmentation: JPEG Q10-100, blur, color jitter, mixup alpha=0.2
  - Checkpoint: per-epoch + best on val AUC -> S3

Usage:
  torchrun --nproc_per_node=4 train.py \
    --data ./datasets/video_v10 \
    --out s3://deep-check-models/deepfake/v10/ \
    --epochs 40 \
    --version v10.0
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import Dataset, DataLoader, DistributedSampler
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, SequentialLR, LinearLR
from torch.cuda.amp import autocast

logger = logging.getLogger("v10_train")

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1, 1)
NUM_FRAMES = 16
RES = 224


# --------------------------------------------------------------------------- #
# Dataset
# --------------------------------------------------------------------------- #

class VideoClipDataset(Dataset):
    def __init__(self, index_path: Path, train: bool = True):
        self.records = [json.loads(l) for l in index_path.read_text().splitlines() if l.strip()]
        self.train = train

    def __len__(self) -> int:
        return len(self.records)

    def _load_video(self, path: str) -> np.ndarray:
        cap = cv2.VideoCapture(path)
        frames = []
        try:
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
        finally:
            cap.release()
        if len(frames) == 0:
            return np.zeros((NUM_FRAMES, RES, RES, 3), dtype=np.uint8)
        if len(frames) < NUM_FRAMES:
            frames = frames + [frames[-1]] * (NUM_FRAMES - len(frames))
        elif len(frames) > NUM_FRAMES:
            idxs = np.linspace(0, len(frames) - 1, NUM_FRAMES, dtype=int)
            frames = [frames[i] for i in idxs]
        return np.stack(frames)

    def _augment(self, arr: np.ndarray) -> np.ndarray:
        if not self.train:
            return arr
        if np.random.rand() < 0.5:
            arr = arr[:, :, ::-1, :].copy()
        if np.random.rand() < 0.4:
            q = int(np.random.uniform(10, 90))
            arr = np.stack([
                cv2.imdecode(
                    cv2.imencode(".jpg", f[..., ::-1], [int(cv2.IMWRITE_JPEG_QUALITY), q])[1],
                    cv2.IMREAD_COLOR,
                )[..., ::-1]
                for f in arr
            ])
        if np.random.rand() < 0.2:
            k = int(np.random.choice([3, 5, 7]))
            arr = np.stack([cv2.GaussianBlur(f, (k, k), 0) for f in arr])
        if np.random.rand() < 0.3:
            arr = arr.astype(np.float32)
            arr *= np.random.uniform(0.7, 1.3, size=(1, 1, 1, 3))
            arr = np.clip(arr, 0, 255).astype(np.uint8)
        return arr

    def __getitem__(self, idx: int):
        r = self.records[idx]
        arr = self._load_video(r["path"])
        arr = self._augment(arr)
        tensor = torch.from_numpy(arr).permute(3, 0, 1, 2).float() / 255.0  # C T H W
        tensor = (tensor.unsqueeze(0) - MEAN) / STD
        return tensor.squeeze(0), torch.tensor(r["label"], dtype=torch.float32)


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #

class VideoMAEDeepfakeDetector(nn.Module):
    def __init__(self, pretrained: str = "MCG-NJU/videomae-large"):
        super().__init__()
        from transformers import VideoMAEModel
        self.backbone = VideoMAEModel.from_pretrained(pretrained)
        hidden = self.backbone.config.hidden_size
        self.head = nn.Sequential(
            nn.LayerNorm(hidden),
            nn.Linear(hidden, 512),
            nn.GELU(),
            nn.Dropout(0.3),
            nn.Linear(512, 1),
        )

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        pv = pixel_values.permute(0, 2, 1, 3, 4)
        out = self.backbone(pixel_values=pv)
        pooled = out.last_hidden_state.mean(dim=1)
        return self.head(pooled).squeeze(-1)


# --------------------------------------------------------------------------- #
# Loss
# --------------------------------------------------------------------------- #

class FocalBCELoss(nn.Module):
    def __init__(self, gamma: float = 2.0, label_smooth: float = 0.1):
        super().__init__()
        self.gamma = gamma
        self.eps = label_smooth

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        targets = targets * (1 - self.eps) + 0.5 * self.eps
        bce = nn.functional.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        p = torch.sigmoid(logits)
        pt = targets * p + (1 - targets) * (1 - p)
        focal = (1 - pt).pow(self.gamma) * bce
        return focal.mean()


# --------------------------------------------------------------------------- #
# MixUp
# --------------------------------------------------------------------------- #

def mixup(x: torch.Tensor, y: torch.Tensor, alpha: float = 0.2):
    lam = np.random.beta(alpha, alpha) if alpha > 0 else 1.0
    idx = torch.randperm(x.size(0), device=x.device)
    mixed_x = lam * x + (1 - lam) * x[idx]
    mixed_y = lam * y + (1 - lam) * y[idx]
    return mixed_x, mixed_y


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

@torch.no_grad()
def run_validation(model, loader, device):
    model.train(False)  # switch to inference mode
    scores, labels = [], []
    for x, y in loader:
        x = x.to(device, non_blocking=True)
        with autocast(dtype=torch.bfloat16):
            logits = model(x)
        scores.append(torch.sigmoid(logits).float().cpu().numpy())
        labels.append(y.numpy())
    scores = np.concatenate(scores)
    labels = np.concatenate(labels)
    try:
        from sklearn.metrics import roc_auc_score
        auc = roc_auc_score(labels, scores)
    except Exception:
        auc = 0.5
    from sklearn.metrics import roc_curve
    fpr, tpr, _ = roc_curve(labels, scores)
    fnr = 1 - tpr
    eer = fpr[np.nanargmin(np.abs(fnr - fpr))]
    return {"auc": float(auc), "eer": float(eer)}


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def setup_ddp() -> tuple[int, int, torch.device]:
    dist.init_process_group("nccl")
    rank = int(os.environ["LOCAL_RANK"])
    world = dist.get_world_size()
    torch.cuda.set_device(rank)
    return rank, world, torch.device(f"cuda:{rank}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="./checkpoints/v10/")
    ap.add_argument("--version", default="v10.0")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--warmup-epochs", type=int, default=2)
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--mixup", type=float, default=0.2)
    ap.add_argument("--resume", default="")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--pretrained", default="MCG-NJU/videomae-large")
    args = ap.parse_args()

    rank, world, device = setup_ddp()
    is_master = rank == 0

    logging.basicConfig(
        level=logging.INFO if is_master else logging.WARNING,
        format=f"%(asctime)s [rank{rank}] %(message)s",
    )

    data_root = Path(args.data)
    train_ds = VideoClipDataset(data_root / "train" / "index.jsonl", train=True)
    val_ds = VideoClipDataset(data_root / "val" / "index.jsonl", train=False)

    train_sampler = DistributedSampler(train_ds, shuffle=True)
    val_sampler = DistributedSampler(val_ds, shuffle=False)

    train_loader = DataLoader(
        train_ds, batch_size=args.batch, sampler=train_sampler,
        num_workers=args.workers, pin_memory=True, drop_last=True,
        persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, sampler=val_sampler,
        num_workers=args.workers, pin_memory=True,
    )

    if is_master:
        logger.info(f"Train: {len(train_ds)}, Val: {len(val_ds)}")

    model = VideoMAEDeepfakeDetector(args.pretrained).to(device)
    if args.resume and Path(args.resume).exists():
        state = torch.load(args.resume, map_location=device)
        model.load_state_dict(state["model"])
        if is_master:
            logger.info(f"Resumed from {args.resume}")

    model = DDP(model, device_ids=[rank], find_unused_parameters=False)

    optim = AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd, betas=(0.9, 0.95))
    total_steps = args.epochs * len(train_loader)
    warmup_steps = args.warmup_epochs * len(train_loader)
    warmup = LinearLR(optim, start_factor=0.01, total_iters=warmup_steps)
    cosine = CosineAnnealingLR(optim, T_max=total_steps - warmup_steps, eta_min=args.lr * 0.01)
    scheduler = SequentialLR(optim, [warmup, cosine], milestones=[warmup_steps])

    loss_fn = FocalBCELoss(gamma=2.0, label_smooth=0.1)

    best_auc = 0.0
    out_dir = Path(args.out) if not args.out.startswith("s3://") else Path("./_local_ckpt")
    out_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        train_sampler.set_epoch(epoch)
        model.train(True)
        t0 = time.time()
        running = 0.0
        optim.zero_grad()

        for step, (x, y) in enumerate(train_loader):
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            if args.mixup > 0 and np.random.rand() < 0.5:
                x, y = mixup(x, y, args.mixup)
            with autocast(dtype=torch.bfloat16):
                logits = model(x)
                loss = loss_fn(logits, y) / args.grad_accum
            loss.backward()

            if (step + 1) % args.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optim.step()
                scheduler.step()
                optim.zero_grad()

            running += loss.item() * args.grad_accum
            if is_master and step % 20 == 0:
                lr_now = scheduler.get_last_lr()[0]
                logger.info(
                    f"epoch {epoch} step {step}/{len(train_loader)} "
                    f"loss {running/(step+1):.4f} lr {lr_now:.2e}"
                )

        metrics = run_validation(model, val_loader, device)
        auc_tensor = torch.tensor([metrics["auc"], metrics["eer"]], device=device)
        dist.all_reduce(auc_tensor, op=dist.ReduceOp.AVG)
        val_auc, val_eer = auc_tensor.tolist()
        dt = time.time() - t0

        if is_master:
            logger.info(
                f"OK epoch {epoch} done in {dt/60:.1f}min | "
                f"train_loss {running/len(train_loader):.4f} | "
                f"val AUC {val_auc:.4f} EER {val_eer:.4f}"
            )
            ckpt = {
                "model": model.module.state_dict(),
                "epoch": epoch,
                "val_auc": val_auc,
                "val_eer": val_eer,
                "args": vars(args),
                "version": args.version,
            }
            torch.save(ckpt, out_dir / "last.pt")
            if val_auc > best_auc:
                best_auc = val_auc
                torch.save(ckpt, out_dir / "best.pt")
                logger.info(f"NEW BEST val AUC {val_auc:.4f}")

            if args.out.startswith("s3://"):
                import subprocess as sp
                sp.run(["aws", "s3", "cp", str(out_dir / "last.pt"),
                        f"{args.out}last.pt"], check=False)
                if val_auc == best_auc:
                    sp.run(["aws", "s3", "cp", str(out_dir / "best.pt"),
                            f"{args.out}best.pt"], check=False)
                    sp.run(["aws", "s3", "cp", str(out_dir / "best.pt"),
                            f"{args.out}best_{args.version}.pt"], check=False)

    if is_master:
        logger.info(f"Done. Training {args.version} complete. Best val AUC: {best_auc:.4f}")
    dist.destroy_process_group()


if __name__ == "__main__":
    sys.exit(main())
