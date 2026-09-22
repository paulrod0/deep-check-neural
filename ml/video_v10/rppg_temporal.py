#!/usr/bin/env python3
"""
Deep-Check V10.4 — Remote Photoplethysmography (rPPG) Temporal Consistency.

Real faces contain a faint periodic blood-flow signal (0.7-3.5 Hz, 42-210 bpm)
visible in RGB channels due to subtle color changes as blood perfuses the skin.
Deepfakes, regardless of generator, do NOT reproduce this physiological signal
coherently — it's the single most robust "liveness" cue known.

Extraction pipeline per video:
  1. Detect face on every frame, align via 5-point landmarks (fallback: Haar bbox)
  2. Extract 3 ROIs (forehead, left cheek, right cheek)
  3. For each ROI, compute mean R, G, B over time -> 3 signals of shape [T]
  4. Apply CHROM method (de Haan 2013):
       Xc = 3*R - 2*G
       Yc = 1.5*R + G - 1.5*B
       Signal = Xc - (std(Xc)/std(Yc)) * Yc
  5. Bandpass [0.7-3.5 Hz], detrend, FFT
  6. Features:
       - Peak frequency (bpm)
       - SNR of peak vs background
       - Cross-ROI signal coherence (real has coherent signal across 3 ROIs)
       - Temporal SNR stability (std of windowed SNR)
  7. Decision head: tiny MLP(features) -> 1-d deepfake score

Real videos: strong peak in 0.7-3.5 Hz band, coherent across ROIs, stable SNR.
Fakes: noise-like spectrum, zero coherence, unstable SNR.

Usage:
  python rppg_temporal.py extract --data ./datasets/video_v10
  python rppg_temporal.py train   --data ./datasets/video_v10
  python rppg_temporal.py score   --data ./datasets/video_v10 --ckpt ./rppg.pt
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW

logger = logging.getLogger("rppg")

HR_MIN_HZ = 0.7   # 42 bpm
HR_MAX_HZ = 3.5   # 210 bpm
FEATURE_DIM = 18  # see _extract_features


# --------------------------------------------------------------------------- #
# ROI extraction
# --------------------------------------------------------------------------- #

def face_rois(gray: np.ndarray, face_bbox: tuple[int, int, int, int]) -> dict[str, np.ndarray]:
    """Return {name: mask_bbox} for 3 ROIs based on face bbox (x,y,w,h)."""
    x, y, w, h = face_bbox
    rois = {
        # Forehead: top 20% of face
        "forehead": (x + int(w * 0.25), y + int(h * 0.05), int(w * 0.5), int(h * 0.18)),
        # Left cheek: lower-left
        "left_cheek": (x + int(w * 0.08), y + int(h * 0.55), int(w * 0.25), int(h * 0.25)),
        # Right cheek: lower-right
        "right_cheek": (x + int(w * 0.67), y + int(h * 0.55), int(w * 0.25), int(h * 0.25)),
    }
    return rois


def extract_rgb_signals(video_path: str, max_frames: int = 300) -> dict[str, np.ndarray]:
    """
    Return {roi_name: [T, 3] mean RGB over time}. T = number of frames.
    Falls back to zero-length if face detection fails.
    """
    cap = cv2.VideoCapture(video_path)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    signals: dict[str, list] = {"forehead": [], "left_cheek": [], "right_cheek": []}
    frame_count = 0
    last_bbox = None

    while frame_count < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(80, 80))
        if len(faces) > 0:
            bbox = tuple(max(faces, key=lambda b: b[2] * b[3]))
            last_bbox = bbox
        elif last_bbox is not None:
            bbox = last_bbox
        else:
            frame_count += 1
            continue

        rois = face_rois(gray, bbox)
        for name, (rx, ry, rw, rh) in rois.items():
            rx, ry = max(0, rx), max(0, ry)
            patch = frame[ry:ry + rh, rx:rx + rw]
            if patch.size == 0:
                signals[name].append([0, 0, 0])
            else:
                # BGR -> RGB mean
                signals[name].append(patch.reshape(-1, 3).mean(axis=0)[::-1].tolist())
        frame_count += 1

    cap.release()
    fps = max(1, int(cv2.VideoCapture(video_path).get(cv2.CAP_PROP_FPS) or 25))
    return {k: np.array(v, dtype=np.float32) for k, v in signals.items()}, fps


# --------------------------------------------------------------------------- #
# CHROM rPPG signal
# --------------------------------------------------------------------------- #

def chrom_signal(rgb: np.ndarray) -> np.ndarray:
    """de Haan CHROM method. Input: [T, 3] RGB. Output: [T] 1-d signal."""
    if rgb.shape[0] < 10:
        return np.zeros(rgb.shape[0], dtype=np.float32)
    # Normalize each channel to mean 1
    norm = rgb / (rgb.mean(axis=0, keepdims=True) + 1e-6)
    R, G, B = norm[:, 0], norm[:, 1], norm[:, 2]
    Xc = 3 * R - 2 * G
    Yc = 1.5 * R + G - 1.5 * B
    alpha = (Xc.std() + 1e-8) / (Yc.std() + 1e-8)
    sig = Xc - alpha * Yc
    return sig.astype(np.float32)


def bandpass_fft(sig: np.ndarray, fps: int,
                 f_low: float = HR_MIN_HZ, f_high: float = HR_MAX_HZ) -> np.ndarray:
    """Zero out frequencies outside [f_low, f_high] and return filtered time signal."""
    n = len(sig)
    if n < 10:
        return sig
    # Detrend
    sig = sig - sig.mean()
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    spec = np.fft.rfft(sig)
    mask = (freqs >= f_low) & (freqs <= f_high)
    spec[~mask] = 0
    return np.fft.irfft(spec, n=n).astype(np.float32)


# --------------------------------------------------------------------------- #
# Feature extraction (used as input to tiny MLP classifier)
# --------------------------------------------------------------------------- #

def _extract_features(signals: dict[str, np.ndarray], fps: int) -> np.ndarray:
    """
    Compute FEATURE_DIM-d feature vector:
      For each ROI (3):
        [peak_freq_hz, snr_db, power_in_band, band_to_total_ratio, spectral_flatness]
      Plus cross-ROI:
        [mean_coherence, snr_std_across_windows, n_frames_used]
    Total = 5*3 + 3 = 18
    """
    features = []
    chroms = {}
    for roi in ["forehead", "left_cheek", "right_cheek"]:
        rgb = signals.get(roi)
        if rgb is None or rgb.shape[0] < 30:
            features.extend([0.0] * 5)
            chroms[roi] = np.zeros(1)
            continue
        sig = chrom_signal(rgb)
        sig_bp = bandpass_fft(sig, fps)
        chroms[roi] = sig_bp

        n = len(sig_bp)
        freqs = np.fft.rfftfreq(n, d=1.0 / fps)
        spec = np.abs(np.fft.rfft(sig_bp - sig_bp.mean())) ** 2

        band_mask = (freqs >= HR_MIN_HZ) & (freqs <= HR_MAX_HZ)
        band_power = spec[band_mask].sum() + 1e-8
        total_power = spec.sum() + 1e-8

        if band_mask.sum() > 0:
            peak_idx = np.argmax(spec * band_mask)
            peak_freq = float(freqs[peak_idx])
            peak_val = float(spec[peak_idx])
        else:
            peak_freq = 0.0
            peak_val = 0.0

        snr_db = 10 * np.log10((peak_val + 1e-10) / (band_power - peak_val + 1e-10))
        band_ratio = band_power / total_power
        # Spectral flatness (geom mean / arith mean)
        spec_pos = spec + 1e-10
        flatness = float(np.exp(np.log(spec_pos).mean()) / spec_pos.mean())

        features.extend([peak_freq, float(snr_db), float(band_power), float(band_ratio), flatness])

    # Cross-ROI: correlation between forehead and cheeks
    def _corr(a, b):
        if len(a) < 10 or len(b) < 10:
            return 0.0
        L = min(len(a), len(b))
        a, b = a[:L], b[:L]
        if a.std() < 1e-6 or b.std() < 1e-6:
            return 0.0
        return float(np.corrcoef(a, b)[0, 1])

    c1 = _corr(chroms["forehead"], chroms["left_cheek"])
    c2 = _corr(chroms["forehead"], chroms["right_cheek"])
    c3 = _corr(chroms["left_cheek"], chroms["right_cheek"])
    mean_coherence = float(np.nanmean([c1, c2, c3]))

    # SNR stability across 4 windows
    window_snrs = []
    for roi in ["forehead", "left_cheek", "right_cheek"]:
        sig = chroms[roi]
        if len(sig) < 60:
            continue
        chunks = np.array_split(sig, 4)
        for chunk in chunks:
            if len(chunk) < 15:
                continue
            freqs = np.fft.rfftfreq(len(chunk), d=1.0 / fps)
            spec = np.abs(np.fft.rfft(chunk - chunk.mean())) ** 2
            band_mask = (freqs >= HR_MIN_HZ) & (freqs <= HR_MAX_HZ)
            if band_mask.sum() > 0 and spec.sum() > 0:
                window_snrs.append(float(spec[band_mask].max() / (spec.sum() + 1e-10)))
    snr_std = float(np.std(window_snrs)) if window_snrs else 0.0

    n_frames = max(len(v) for v in chroms.values())
    features.extend([mean_coherence, snr_std, float(n_frames)])

    return np.array(features, dtype=np.float32)


# --------------------------------------------------------------------------- #
# Classifier (tiny MLP over features)
# --------------------------------------------------------------------------- #

class RPPGClassifier(nn.Module):
    def __init__(self, in_dim: int = FEATURE_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 64), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(64, 32), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


# --------------------------------------------------------------------------- #
# Dataset
# --------------------------------------------------------------------------- #

class RPPGDataset(Dataset):
    def __init__(self, feature_cache: Path, split: str):
        data = np.load(feature_cache / f"{split}.npz")
        self.features = data["features"]
        self.labels = data["labels"]

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int):
        return (
            torch.from_numpy(self.features[idx]).float(),
            torch.tensor(self.labels[idx], dtype=torch.float32),
        )


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #

def cmd_extract(args):
    """Extract rPPG features for all clips, cache to .npz per split."""
    data_root = Path(args.data)
    cache = data_root / "_rppg_features"
    cache.mkdir(parents=True, exist_ok=True)

    for split in ["train", "val", "test"]:
        idx = data_root / split / "index.jsonl"
        if not idx.exists():
            continue
        recs = [json.loads(l) for l in idx.read_text().splitlines() if l.strip()]
        features, labels = [], []
        for i, r in enumerate(recs):
            if i % 50 == 0:
                logger.info(f"{split}: {i}/{len(recs)}")
            try:
                signals, fps = extract_rgb_signals(r["path"])
                feat = _extract_features(signals, fps)
            except Exception as e:
                logger.warning(f"Failed {r['path']}: {e}")
                feat = np.zeros(FEATURE_DIM, dtype=np.float32)
            features.append(feat)
            labels.append(r["label"])
        np.savez(cache / f"{split}.npz",
                 features=np.stack(features), labels=np.array(labels, dtype=np.int64))
        logger.info(f"Cached {len(features)} features to {cache / f'{split}.npz'}")


def cmd_train(args):
    data_root = Path(args.data)
    cache = data_root / "_rppg_features"
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_ds = RPPGDataset(cache, "train")
    val_ds = RPPGDataset(cache, "val")
    train_loader = DataLoader(train_ds, batch_size=128, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=128)

    model = RPPGClassifier().to(device)
    optim = AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)

    best_auc = 0.0
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        model.train(True)
        running = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            logits = model(x)
            loss = F.binary_cross_entropy_with_logits(logits, y)
            optim.zero_grad()
            loss.backward()
            optim.step()
            running += loss.item()

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
        from sklearn.metrics import roc_auc_score
        try:
            auc = roc_auc_score(labels, scores)
        except Exception:
            auc = 0.5
        logger.info(f"epoch {epoch} train_loss {running/len(train_loader):.4f} val_auc {auc:.4f}")
        if auc > best_auc:
            best_auc = auc
            torch.save({"model": model.state_dict(), "epoch": epoch, "val_auc": auc}, out_path)
            logger.info(f"NEW BEST rPPG AUC {auc:.4f}")


def cmd_score(args):
    """Append rppg_score to index.jsonl records."""
    data_root = Path(args.data)
    cache = data_root / "_rppg_features"
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = RPPGClassifier().to(device)
    model.load_state_dict(torch.load(args.ckpt, map_location=device)["model"])
    model.train(False)

    for split in ["train", "val", "test"]:
        idx = data_root / split / "index.jsonl"
        if not idx.exists():
            continue
        data = np.load(cache / f"{split}.npz")
        feats = torch.from_numpy(data["features"]).float().to(device)
        with torch.no_grad():
            scores = torch.sigmoid(model(feats)).cpu().numpy()
        recs = [json.loads(l) for l in idx.read_text().splitlines() if l.strip()]
        out_lines = []
        for r, s in zip(recs, scores):
            r["rppg_score"] = float(s)
            out_lines.append(json.dumps(r))
        idx.write_text("\n".join(out_lines) + "\n")
        logger.info(f"Updated {idx} with rppg_score (n={len(scores)})")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_ex = sub.add_parser("extract")
    p_ex.add_argument("--data", required=True)

    p_tr = sub.add_parser("train")
    p_tr.add_argument("--data", required=True)
    p_tr.add_argument("--out", default="./checkpoints/rppg.pt")
    p_tr.add_argument("--epochs", type=int, default=50)

    p_sc = sub.add_parser("score")
    p_sc.add_argument("--data", required=True)
    p_sc.add_argument("--ckpt", required=True)

    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    {"extract": cmd_extract, "train": cmd_train, "score": cmd_score}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
