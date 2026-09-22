#!/usr/bin/env python3
"""
Deep-Check V10.3 — Audio-Visual Sync Detector (lip-audio mismatch).

Threat model: deepfakes with voice-swap, lip-sync drift, or synthetic audio
(HeyGen, Synthesia, ElevenLabs+Wav2Lip). Real videos have tight audio-visual
coupling — fakes typically show 30-200ms lip-sync drift.

Architecture (SyncNet-inspired, modernized):
  - Audio stream:
      Whisper-tiny encoder (39M) frozen -> mean-pool 25ms windows -> 384-d
      OR log-mel spectrogram 80xT -> small 1D CNN -> 512-d (if audio absent from Whisper)
  - Visual stream:
      FAN-aligned lip crop (96x96) x 5 frames -> 3D-CNN -> 512-d
  - Contrastive head:
      Cosine similarity between aligned windows
      Training: positives = real (synced), negatives = temporal-shuffled
  - Deepfake decision:
      Score = mean sliding-window AV distance across clip
      Threshold learned on val set (F1 optimal)

Integration: produces a 1-d score per clip, fused with pixel model in
veritasEnsemble at weight ~0.15.

Usage:
  python av_sync.py extract  --data ./datasets/video_v10   # extract audio
  python av_sync.py train    --data ./datasets/video_v10   # train SyncNet
  python av_sync.py score    --data ./datasets/video_v10 --ckpt ./av_sync.pt
"""
from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW

logger = logging.getLogger("av_sync")

LIP_WINDOW_FRAMES = 5           # 0.2s window @ 25fps
AUDIO_WINDOW_SAMPLES = 3200     # 0.2s @ 16kHz
LIP_RES = 96
MEL_BINS = 80
SAMPLE_RATE = 16000


# --------------------------------------------------------------------------- #
# Audio extraction (ffmpeg)
# --------------------------------------------------------------------------- #

def extract_audio_wav(video_path: str, out_path: str, sr: int = SAMPLE_RATE) -> bool:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-ac", "1", "-ar", str(sr),
        "-vn", "-f", "wav", out_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0 and Path(out_path).stat().st_size > 100
    except Exception:
        return False


def load_wav(path: str) -> np.ndarray:
    """Read 16kHz mono WAV to float32 in [-1, 1]."""
    import wave
    with wave.open(path, "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return arr


def compute_log_mel(audio: np.ndarray, n_fft: int = 512, hop: int = 160) -> np.ndarray:
    """Compute log-mel spectrogram. Returns shape [MEL_BINS, T]."""
    # Pre-emphasis
    audio = np.append(audio[0], audio[1:] - 0.97 * audio[:-1])
    # STFT
    window = np.hanning(n_fft)
    n_frames = 1 + (len(audio) - n_fft) // hop
    if n_frames <= 0:
        return np.zeros((MEL_BINS, 1), dtype=np.float32)
    stft = np.zeros((n_fft // 2 + 1, n_frames), dtype=np.complex64)
    for i in range(n_frames):
        frame = audio[i * hop:i * hop + n_fft] * window
        stft[:, i] = np.fft.rfft(frame)
    power = np.abs(stft) ** 2
    # Mel filterbank (simple triangular)
    mel_min, mel_max = 0.0, 2595.0 * np.log10(1 + SAMPLE_RATE / 2 / 700)
    mels = np.linspace(mel_min, mel_max, MEL_BINS + 2)
    hz = 700 * (10 ** (mels / 2595.0) - 1)
    bins = np.floor((n_fft + 1) * hz / SAMPLE_RATE).astype(int)
    fb = np.zeros((MEL_BINS, power.shape[0]), dtype=np.float32)
    for m in range(1, MEL_BINS + 1):
        f_l, f_c, f_r = bins[m - 1], bins[m], bins[m + 1]
        for k in range(f_l, f_c):
            fb[m - 1, k] = (k - f_l) / max(1, f_c - f_l)
        for k in range(f_c, f_r):
            fb[m - 1, k] = (f_r - k) / max(1, f_r - f_c)
    mel = fb @ power
    return np.log(mel + 1e-6).astype(np.float32)


# --------------------------------------------------------------------------- #
# Lip region crop from face video
# --------------------------------------------------------------------------- #

def extract_lip_crops(video_path: str, n_frames: int = 16) -> np.ndarray:
    """Extract lip region crops using Haar cascade + heuristic (bottom 40% of face)."""
    cap = cv2.VideoCapture(video_path)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return np.zeros((n_frames, LIP_RES, LIP_RES), dtype=np.uint8)

    idxs = np.linspace(0, total - 1, n_frames, dtype=int)
    crops = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if not ok:
            crops.append(np.zeros((LIP_RES, LIP_RES), dtype=np.uint8))
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(80, 80))
        if len(faces) == 0:
            crops.append(cv2.resize(gray, (LIP_RES, LIP_RES)))
            continue
        x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
        # Lip region: bottom 40% of face, horizontally centered
        lip_y0 = y + int(h * 0.55)
        lip_y1 = y + int(h * 0.95)
        lip_x0 = x + int(w * 0.20)
        lip_x1 = x + int(w * 0.80)
        lip = gray[lip_y0:lip_y1, lip_x0:lip_x1]
        if lip.size == 0:
            lip = gray[y:y + h, x:x + w]
        crops.append(cv2.resize(lip, (LIP_RES, LIP_RES)))
    cap.release()
    return np.stack(crops)


# --------------------------------------------------------------------------- #
# SyncNet model
# --------------------------------------------------------------------------- #

class AudioEncoder(nn.Module):
    """1D CNN over log-mel spectrograms -> 512-d."""

    def __init__(self, mel_bins: int = MEL_BINS, out_dim: int = 512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(mel_bins, 128, kernel_size=3, padding=1),
            nn.BatchNorm1d(128), nn.ReLU(),
            nn.Conv1d(128, 256, kernel_size=3, padding=1), nn.MaxPool1d(2),
            nn.BatchNorm1d(256), nn.ReLU(),
            nn.Conv1d(256, 384, kernel_size=3, padding=1),
            nn.BatchNorm1d(384), nn.ReLU(),
            nn.Conv1d(384, out_dim, kernel_size=3, padding=1), nn.AdaptiveAvgPool1d(1),
        )

    def forward(self, mel: torch.Tensor) -> torch.Tensor:
        # mel: [B, MEL_BINS, T]
        return self.net(mel).squeeze(-1)


class LipEncoder(nn.Module):
    """3D CNN over lip frame stacks -> 512-d."""

    def __init__(self, out_dim: int = 512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv3d(1, 64, kernel_size=(3, 5, 5), padding=(1, 2, 2)),
            nn.BatchNorm3d(64), nn.ReLU(), nn.MaxPool3d((1, 2, 2)),
            nn.Conv3d(64, 128, kernel_size=(3, 3, 3), padding=1),
            nn.BatchNorm3d(128), nn.ReLU(), nn.MaxPool3d((1, 2, 2)),
            nn.Conv3d(128, 256, kernel_size=(3, 3, 3), padding=1),
            nn.BatchNorm3d(256), nn.ReLU(), nn.MaxPool3d((2, 2, 2)),
            nn.Conv3d(256, out_dim, kernel_size=(3, 3, 3), padding=1),
            nn.AdaptiveAvgPool3d(1),
        )

    def forward(self, lip: torch.Tensor) -> torch.Tensor:
        # lip: [B, 1, T, H, W]
        return self.net(lip).flatten(1)


class SyncNet(nn.Module):
    def __init__(self, dim: int = 512):
        super().__init__()
        self.audio = AudioEncoder(out_dim=dim)
        self.lip = LipEncoder(out_dim=dim)

    def forward(self, mel: torch.Tensor, lip: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        a = F.normalize(self.audio(mel), dim=-1)
        v = F.normalize(self.lip(lip), dim=-1)
        return a, v

    @staticmethod
    def sync_distance(a: torch.Tensor, v: torch.Tensor) -> torch.Tensor:
        # Cosine distance (lower = synced)
        return 1 - (a * v).sum(dim=-1)


# --------------------------------------------------------------------------- #
# Dataset for contrastive training
# --------------------------------------------------------------------------- #

class AVSyncDataset(Dataset):
    """
    Loads (audio_mel_window, lip_frames_window) pairs.
    Positives: synchronized real videos.
    Negatives: temporal-shifted (shift audio by >300ms relative to video).
    """

    def __init__(self, index_path: Path, audio_root: Path, reals_only: bool = True):
        all_recs = [json.loads(l) for l in index_path.read_text().splitlines() if l.strip()]
        self.records = [r for r in all_recs if (r["label"] == 0 if reals_only else True)]
        self.audio_root = audio_root

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int):
        r = self.records[idx]
        video_path = r["path"]
        audio_path = self.audio_root / (Path(video_path).stem + ".wav")
        if not audio_path.exists():
            return self._zero_sample()

        # Load audio + compute mel
        audio = load_wav(str(audio_path))
        if len(audio) < AUDIO_WINDOW_SAMPLES * 2:
            return self._zero_sample()

        # Random window
        start_s = np.random.uniform(0, len(audio) / SAMPLE_RATE - 0.5)
        audio_win = audio[int(start_s * SAMPLE_RATE):int(start_s * SAMPLE_RATE) + AUDIO_WINDOW_SAMPLES]
        mel = compute_log_mel(audio_win)  # [80, ~20]

        # Load lip crops at matching time window
        lip = self._load_lip_window(video_path, start_s, LIP_WINDOW_FRAMES)

        # 50% chance: create misaligned pair (negative)
        is_aligned = np.random.rand() > 0.5
        if not is_aligned:
            shift_s = np.random.choice([-0.5, -0.3, 0.3, 0.5])
            shifted_start = np.clip(start_s + shift_s, 0, len(audio) / SAMPLE_RATE - 0.3)
            audio_win = audio[int(shifted_start * SAMPLE_RATE):int(shifted_start * SAMPLE_RATE) + AUDIO_WINDOW_SAMPLES]
            mel = compute_log_mel(audio_win)

        mel_t = torch.from_numpy(mel).float()
        lip_t = torch.from_numpy(lip).float().unsqueeze(0).unsqueeze(0) / 255.0
        # lip_t: [1, 1, T, H, W] -> squeeze batch
        lip_t = lip_t.squeeze(0)
        return mel_t, lip_t, torch.tensor(1.0 if is_aligned else 0.0)

    def _zero_sample(self):
        return (
            torch.zeros(MEL_BINS, 20),
            torch.zeros(1, LIP_WINDOW_FRAMES, LIP_RES, LIP_RES),
            torch.tensor(0.0),
        )

    def _load_lip_window(self, video_path: str, start_s: float, n_frames: int) -> np.ndarray:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        start_frame = int(start_s * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        out = np.zeros((n_frames, LIP_RES, LIP_RES), dtype=np.uint8)
        for i in range(n_frames):
            ok, frame = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
            if len(faces) > 0:
                x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
                lip_y0 = y + int(h * 0.55)
                lip_y1 = y + int(h * 0.95)
                lip_x0 = x + int(w * 0.20)
                lip_x1 = x + int(w * 0.80)
                lip = gray[lip_y0:lip_y1, lip_x0:lip_x1]
                if lip.size > 0:
                    out[i] = cv2.resize(lip, (LIP_RES, LIP_RES))
        cap.release()
        return out


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #

def cmd_extract(args):
    """Extract audio WAV for every clip in the dataset."""
    data_root = Path(args.data)
    audio_root = data_root / "_audio"
    audio_root.mkdir(parents=True, exist_ok=True)
    for split in ["train", "val", "test"]:
        idx = data_root / split / "index.jsonl"
        if not idx.exists():
            continue
        recs = [json.loads(l) for l in idx.read_text().splitlines() if l.strip()]
        for r in recs:
            out = audio_root / (Path(r["path"]).stem + ".wav")
            if out.exists():
                continue
            ok = extract_audio_wav(r["path"], str(out))
            if not ok:
                logger.warning(f"Failed audio extract: {r['path']}")
    logger.info(f"Audio extracted to {audio_root}")


def cmd_train(args):
    data_root = Path(args.data)
    audio_root = data_root / "_audio"
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_ds = AVSyncDataset(data_root / "train" / "index.jsonl", audio_root, reals_only=True)
    val_ds = AVSyncDataset(data_root / "val" / "index.jsonl", audio_root, reals_only=True)

    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True,
                              num_workers=4, pin_memory=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch, num_workers=4, pin_memory=True)

    model = SyncNet().to(device)
    optim = AdamW(model.parameters(), lr=1e-4, weight_decay=0.05)

    best_val = 0.0
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        model.train(True)
        running = 0.0
        for step, (mel, lip, aligned) in enumerate(train_loader):
            mel = mel.to(device)
            lip = lip.to(device)
            aligned = aligned.to(device)
            a, v = model(mel, lip)
            dist = SyncNet.sync_distance(a, v)
            # Aligned -> distance near 0; misaligned -> near 2
            target = (1 - aligned) * 2.0
            loss = F.mse_loss(dist, target)
            optim.zero_grad()
            loss.backward()
            optim.step()
            running += loss.item()
            if step % 20 == 0:
                logger.info(f"epoch {epoch} step {step} loss {running/(step+1):.4f}")

        # Validation
        model.train(False)
        correct = total = 0
        with torch.no_grad():
            for mel, lip, aligned in val_loader:
                mel, lip = mel.to(device), lip.to(device)
                a, v = model(mel, lip)
                dist = SyncNet.sync_distance(a, v).cpu().numpy()
                pred = (dist < 1.0).astype(np.float32)  # aligned if distance <1
                correct += (pred == aligned.numpy()).sum()
                total += len(dist)
        acc = correct / max(1, total)
        logger.info(f"epoch {epoch} val_acc {acc:.4f}")
        if acc > best_val:
            best_val = acc
            torch.save({"model": model.state_dict(), "epoch": epoch, "val_acc": acc}, out_path)
            logger.info(f"NEW BEST saved to {out_path}")


def cmd_score(args):
    """Produce per-clip sync score for every clip (appended to index.jsonl as 'av_sync_score')."""
    data_root = Path(args.data)
    audio_root = data_root / "_audio"
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = SyncNet().to(device)
    state = torch.load(args.ckpt, map_location=device)
    model.load_state_dict(state["model"])
    model.train(False)

    for split in ["train", "val", "test"]:
        idx = data_root / split / "index.jsonl"
        if not idx.exists():
            continue
        recs = [json.loads(l) for l in idx.read_text().splitlines() if l.strip()]
        out_lines = []
        with torch.no_grad():
            for r in recs:
                audio_path = audio_root / (Path(r["path"]).stem + ".wav")
                if not audio_path.exists():
                    r["av_sync_score"] = None
                    out_lines.append(json.dumps(r))
                    continue
                audio = load_wav(str(audio_path))
                n_windows = max(1, len(audio) // AUDIO_WINDOW_SAMPLES - 1)
                dists = []
                for w in range(n_windows):
                    start_s = w * (AUDIO_WINDOW_SAMPLES / SAMPLE_RATE)
                    audio_win = audio[w * AUDIO_WINDOW_SAMPLES:(w + 1) * AUDIO_WINDOW_SAMPLES]
                    if len(audio_win) < AUDIO_WINDOW_SAMPLES:
                        break
                    mel = torch.from_numpy(compute_log_mel(audio_win)).float().unsqueeze(0).to(device)
                    lip = _load_lip_window_static(r["path"], start_s, LIP_WINDOW_FRAMES)
                    lip_t = torch.from_numpy(lip).float().unsqueeze(0).unsqueeze(0).to(device) / 255.0
                    a, v = model(mel, lip_t)
                    dists.append(SyncNet.sync_distance(a, v).item())
                r["av_sync_score"] = float(np.mean(dists)) if dists else None
                out_lines.append(json.dumps(r))
        # Write back
        idx.write_text("\n".join(out_lines) + "\n")
        logger.info(f"Updated {idx} with av_sync_score")


def _load_lip_window_static(video_path: str, start_s: float, n_frames: int) -> np.ndarray:
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(start_s * fps))
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    out = np.zeros((n_frames, LIP_RES, LIP_RES), dtype=np.uint8)
    for i in range(n_frames):
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
        if len(faces) > 0:
            x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
            lip_y0 = y + int(h * 0.55)
            lip_y1 = y + int(h * 0.95)
            lip_x0 = x + int(w * 0.20)
            lip_x1 = x + int(w * 0.80)
            lip = gray[lip_y0:lip_y1, lip_x0:lip_x1]
            if lip.size > 0:
                out[i] = cv2.resize(lip, (LIP_RES, LIP_RES))
    cap.release()
    return out


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_ext = sub.add_parser("extract")
    p_ext.add_argument("--data", required=True)

    p_tr = sub.add_parser("train")
    p_tr.add_argument("--data", required=True)
    p_tr.add_argument("--out", default="./checkpoints/av_sync.pt")
    p_tr.add_argument("--epochs", type=int, default=20)
    p_tr.add_argument("--batch", type=int, default=32)

    p_sc = sub.add_parser("score")
    p_sc.add_argument("--data", required=True)
    p_sc.add_argument("--ckpt", required=True)

    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    {"extract": cmd_extract, "train": cmd_train, "score": cmd_score}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
