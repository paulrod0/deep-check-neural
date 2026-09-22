#!/usr/bin/env python3
"""
Deep-Check V10.5 — Multimodal Ensemble Training.

Fuses 3 independent signals:
  1. Pixel: VideoMAE-L deepfake detector (V10.0-V10.2 base)
  2. Audio-Visual sync: SyncNet distance score (V10.3)
  3. rPPG temporal: blood-flow physiological signal score (V10.4)

Fusion strategy: learned logit-space weighted combination (Bayesian-inspired).
  fused_logit = w_pix * logit_pix + w_av * logit_av + w_rppg * logit_rppg + bias
  where [w_pix, w_av, w_rppg] are learnable parameters constrained to sum=1.

Training:
  - Input: precomputed scores in index.jsonl (pixel_score, av_sync_score, rppg_score)
  - Loss: BCE with label smoothing
  - Optimizer: AdamW lr=1e-3 (very low capacity, few params)
  - Calibration: isotonic regression on val set after training
  - Output: fused calibrated probability

Usage:
  # After running pixel (train.py), AV (av_sync.py score), rPPG (rppg_temporal.py score):
  python train_multimodal.py --data ./datasets/video_v10 --out ./checkpoints/fusion.pt
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW

logger = logging.getLogger("multimodal")


# --------------------------------------------------------------------------- #
# Dataset
# --------------------------------------------------------------------------- #

class MultimodalScoreDataset(Dataset):
    """Reads index.jsonl records with pixel_score, av_sync_score, rppg_score."""

    def __init__(self, index_path: Path):
        raw = [json.loads(l) for l in index_path.read_text().splitlines() if l.strip()]
        # Only keep records where all 3 scores exist
        self.records = []
        for r in raw:
            if all(r.get(k) is not None for k in ["pixel_score", "av_sync_score", "rppg_score"]):
                self.records.append(r)
        logger.info(f"Loaded {len(self.records)}/{len(raw)} records with full score triplet")

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int):
        r = self.records[idx]
        # av_sync_score is a DISTANCE — high distance means deepfake
        # Normalize: convert to [0,1] where 1 = likely fake
        av_deepfake_prob = float(np.clip(r["av_sync_score"] / 2.0, 0.0, 1.0))
        # rppg_score is trained as P(fake)
        # pixel_score is P(fake) from VideoMAE head sigmoid
        x = torch.tensor([
            float(r["pixel_score"]),
            av_deepfake_prob,
            float(r["rppg_score"]),
        ], dtype=torch.float32)
        y = torch.tensor(r["label"], dtype=torch.float32)
        return x, y


# --------------------------------------------------------------------------- #
# Fusion model
# --------------------------------------------------------------------------- #

class LogitFusion(nn.Module):
    """
    Learned weighted logit combination with softmax-normalized weights.

    logit_out = softmax(raw_weights) . logit_inputs  +  bias
    """

    def __init__(self, n_experts: int = 3):
        super().__init__()
        # Initialize to prior weights: pixel=0.55, av=0.20, rppg=0.25
        self.raw_weights = nn.Parameter(torch.tensor([0.55, 0.20, 0.25]).log())
        self.bias = nn.Parameter(torch.zeros(1))
        self.temperature = nn.Parameter(torch.ones(1))

    def forward(self, probs: torch.Tensor) -> torch.Tensor:
        # probs: [B, 3] each in [0,1]
        # Convert to logits (clip away from 0/1 for stability)
        probs = probs.clamp(1e-4, 1 - 1e-4)
        logits = torch.log(probs / (1 - probs))  # [B, 3]
        weights = F.softmax(self.raw_weights, dim=0)  # [3] sum to 1
        fused = (logits * weights.unsqueeze(0)).sum(dim=-1) / self.temperature + self.bias
        return fused.squeeze(-1)

    def current_weights(self) -> dict:
        w = F.softmax(self.raw_weights, dim=0).detach().cpu().numpy()
        return {
            "pixel": float(w[0]),
            "av_sync": float(w[1]),
            "rppg": float(w[2]),
            "temperature": float(self.temperature.item()),
            "bias": float(self.bias.item()),
        }


# --------------------------------------------------------------------------- #
# Isotonic calibration (post-hoc)
# --------------------------------------------------------------------------- #

def fit_isotonic(scores: np.ndarray, labels: np.ndarray) -> dict:
    from sklearn.isotonic import IsotonicRegression
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(scores, labels)
    # Serialize as piecewise-linear thresholds
    xs = iso.X_thresholds_
    ys = iso.y_thresholds_
    return {"x": xs.tolist(), "y": ys.tolist()}


def apply_isotonic(scores: np.ndarray, calib: dict) -> np.ndarray:
    return np.interp(scores, calib["x"], calib["y"])


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def compute_basic_metrics(scores: np.ndarray, labels: np.ndarray) -> dict:
    from sklearn.metrics import roc_auc_score, roc_curve
    try:
        auc = roc_auc_score(labels, scores)
    except Exception:
        auc = 0.5
    fpr, tpr, _ = roc_curve(labels, scores)
    fnr = 1 - tpr
    eer = float(fpr[np.nanargmin(np.abs(fnr - fpr))])
    return {"auc": float(auc), "eer": eer}


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="./checkpoints/fusion.pt")
    ap.add_argument("--calib-out", default="./checkpoints/fusion_calibration.json")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    data_root = Path(args.data)
    train_ds = MultimodalScoreDataset(data_root / "train" / "index.jsonl")
    val_ds = MultimodalScoreDataset(data_root / "val" / "index.jsonl")

    if len(train_ds) == 0:
        logger.error("Empty train set. Run pixel + av_sync score + rppg score first.")
        sys.exit(1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch)

    model = LogitFusion().to(device)
    optim = AdamW(model.parameters(), lr=args.lr, weight_decay=0.001)

    best_auc = 0.0
    best_state = None

    for epoch in range(args.epochs):
        model.train(True)
        running = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            logits = model(x)
            # Label smoothing
            smooth_y = y * 0.9 + 0.05
            loss = F.binary_cross_entropy_with_logits(logits, smooth_y)
            optim.zero_grad()
            loss.backward()
            optim.step()
            running += loss.item()

        # Validation
        model.train(False)
        scores, labels = [], []
        with torch.no_grad():
            for x, y in val_loader:
                x = x.to(device)
                logits = model(x)
                scores.append(torch.sigmoid(logits).cpu().numpy())
                labels.append(y.numpy())
        scores = np.concatenate(scores)
        labels = np.concatenate(labels)
        metrics = compute_basic_metrics(scores, labels)
        w = model.current_weights()

        if epoch % 10 == 0 or epoch == args.epochs - 1:
            logger.info(
                f"epoch {epoch:3d} loss {running/len(train_loader):.4f} "
                f"AUC {metrics['auc']:.4f} EER {metrics['eer']*100:.2f}% "
                f"w=[pix={w['pixel']:.2f} av={w['av_sync']:.2f} rppg={w['rppg']:.2f}] T={w['temperature']:.2f}"
            )

        if metrics["auc"] > best_auc:
            best_auc = metrics["auc"]
            best_state = {
                "model": model.state_dict(),
                "epoch": epoch,
                "val_auc": metrics["auc"],
                "val_eer": metrics["eer"],
                "weights": w,
            }

    # Save best
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(best_state, out_path)
    logger.info(f"Saved best fusion model to {out_path} (val AUC {best_auc:.4f})")
    logger.info(f"Final weights: {best_state['weights']}")

    # Fit isotonic calibration on val scores
    model.load_state_dict(best_state["model"])
    model.train(False)
    val_scores, val_labels = [], []
    with torch.no_grad():
        for x, y in val_loader:
            x = x.to(device)
            val_scores.append(torch.sigmoid(model(x)).cpu().numpy())
            val_labels.append(y.numpy())
    val_scores = np.concatenate(val_scores)
    val_labels = np.concatenate(val_labels)
    calib = fit_isotonic(val_scores, val_labels)

    # Evaluate calibration improvement (ECE)
    def ece(s: np.ndarray, l: np.ndarray, n_bins: int = 15) -> float:
        edges = np.linspace(0, 1, n_bins + 1)
        out = 0.0
        for i in range(n_bins):
            mask = (s >= edges[i]) & (s < edges[i + 1])
            if mask.sum() == 0:
                continue
            out += (mask.sum() / len(s)) * abs(l[mask].mean() - s[mask].mean())
        return out

    ece_raw = ece(val_scores, val_labels)
    ece_calib = ece(apply_isotonic(val_scores, calib), val_labels)
    logger.info(f"Calibration: ECE raw={ece_raw:.4f} -> calibrated={ece_calib:.4f}")

    Path(args.calib_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.calib_out).write_text(json.dumps(calib, indent=2))
    logger.info(f"Saved isotonic calibration to {args.calib_out}")


if __name__ == "__main__":
    sys.exit(main())
