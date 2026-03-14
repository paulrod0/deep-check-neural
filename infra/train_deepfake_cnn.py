#!/usr/bin/env python3
"""
Deepfake Detection CNN — Blendshape + Iris Temporal Analysis
=============================================================
Classifies video feeds as: real_human | deepfake_video | photo_replay

Input: Temporal sequence of MediaPipe FaceLandmarker outputs:
  - 52 blendshape scores (per frame)
  - 4 iris positions (left_x, left_y, right_x, right_y, normalized)
  - 3 depth features (nose_z, left_iris_z, right_iris_z)
  = 59 features x 90 frames

Architecture: Conv1D encoder + BiGRU + Multi-head Attention + MLP
Target: <300KB ONNX for browser inference

Usage:
  python train_deepfake_cnn.py [--epochs 60] [--batch-size 512] [--device cuda]
  python train_deepfake_cnn.py --export-only  # just re-export ONNX from best checkpoint

Veritas Engine v5 - Deep-Check
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset

# --- Constants ----------------------------------------------------------------

SEQ_LEN = 90           # ~6 seconds at 15fps (MediaPipe detection rate)
N_BLENDSHAPES = 52     # MediaPipe FaceLandmarker blendshapes
N_IRIS = 4             # left_iris_x, left_iris_y, right_iris_x, right_iris_y
N_DEPTH = 3            # nose_z, left_iris_z, right_iris_z
N_FEATURES = N_BLENDSHAPES + N_IRIS + N_DEPTH  # 59
N_CLASSES = 3          # real_human=0, deepfake_video=1, photo_replay=2

CLASS_NAMES = ['real_human', 'deepfake_video', 'photo_replay']

# Bilateral blendshape pairs (index tuples) for consistency analysis
BILATERAL_PAIRS = [
    (9, 10),   # eyeBlinkLeft, eyeBlinkRight
    (11, 12),  # eyeLookDownLeft, eyeLookDownRight
    (13, 14),  # eyeLookInLeft, eyeLookInRight
    (15, 16),  # eyeLookOutLeft, eyeLookOutRight
    (17, 18),  # eyeLookUpLeft, eyeLookUpRight
    (19, 20),  # eyeSquintLeft, eyeSquintRight
    (21, 22),  # eyeWideLeft, eyeWideRight
    (1, 2),    # browDownLeft, browDownRight
    (4, 5),    # browOuterUpLeft, browOuterUpRight
    (7, 8),    # cheekSquintLeft, cheekSquintRight
    (44, 45),  # mouthSmileLeft, mouthSmileRight
    (30, 31),  # mouthFrownLeft, mouthFrownRight
    (50, 51),  # noseSneerLeft, noseSneerRight
]

# --- Synthetic Data Generation ------------------------------------------------

def generate_blink_pattern(seq_len, blinks_per_min=17.0):
    """Generate realistic blink pattern (eyeBlink blendshape over time)."""
    fps = 15
    duration_s = seq_len / fps
    expected_blinks = int(blinks_per_min * duration_s / 60)
    n_blinks = max(0, np.random.poisson(expected_blinks))

    blink_signal = np.zeros(seq_len)
    blink_positions = np.sort(np.random.randint(5, max(6, seq_len - 5), size=max(0, n_blinks)))

    for pos in blink_positions:
        dur_frames = np.random.randint(2, 6)
        close_speed = np.random.uniform(0.7, 1.0)
        for i in range(dur_frames):
            t = i / dur_frames
            if t < 0.3:
                val = close_speed * (t / 0.3)
            else:
                val = close_speed * (1 - (t - 0.3) / 0.7)
            idx = pos + i
            if 0 <= idx < seq_len:
                blink_signal[idx] = max(blink_signal[idx], val)

    return blink_signal


def generate_micro_expressions(seq_len):
    """Generate correlated micro-expression blendshapes."""
    smile_base = np.random.uniform(0.0, 0.15)
    brow_base = np.random.uniform(0.0, 0.05)
    drift = np.cumsum(np.random.randn(seq_len) * 0.002)
    drift = np.clip(drift, -0.1, 0.1)

    micro_events = np.zeros(seq_len)
    n_micro = np.random.poisson(3)
    for _ in range(n_micro):
        pos = np.random.randint(0, seq_len)
        dur = np.random.randint(2, 5)
        intensity = np.random.uniform(0.05, 0.2)
        for i in range(dur):
            idx = pos + i
            if 0 <= idx < seq_len:
                t = i / dur
                micro_events[idx] = intensity * np.sin(t * np.pi)

    return {
        'smile': smile_base + drift * 0.3 + micro_events * 0.5,
        'brow': brow_base + drift * 0.1,
        'drift': drift,
        'micro': micro_events,
    }


def generate_iris_movement(seq_len, gaze_pattern='natural'):
    """Generate iris position sequence [left_x, left_y, right_x, right_y]."""
    iris = np.zeros((seq_len, 4))

    if gaze_pattern == 'natural':
        saccade_noise = np.random.randn(seq_len, 4) * 0.008
        smooth = np.cumsum(np.random.randn(seq_len, 4) * 0.003, axis=0)
        smooth = np.clip(smooth, -0.15, 0.15)
        n_shifts = np.random.poisson(2)
        for _ in range(n_shifts):
            pos = np.random.randint(0, seq_len)
            shift = np.random.randn(4) * 0.05
            smooth[pos:] += shift

        iris = 0.5 + smooth + saccade_noise
        iris[:, 2] = iris[:, 0] + np.random.randn(seq_len) * 0.005
        iris[:, 3] = iris[:, 1] + np.random.randn(seq_len) * 0.005

    elif gaze_pattern == 'frozen':
        iris[:] = 0.5 + np.random.randn(4) * 0.01
        iris += np.random.randn(seq_len, 4) * 0.001

    elif gaze_pattern == 'deepfake':
        smooth = np.cumsum(np.random.randn(seq_len, 4) * 0.004, axis=0)
        smooth = np.clip(smooth, -0.12, 0.12)
        iris = 0.5 + smooth
        iris[:, 2] = iris[:, 0] + np.random.randn(seq_len) * 0.015
        iris[:, 3] = iris[:, 1] + np.random.randn(seq_len) * 0.015
        n_jumps = np.random.poisson(1.5)
        for _ in range(n_jumps):
            pos = np.random.randint(0, seq_len)
            iris[pos] += np.random.randn(4) * 0.04

    return np.clip(iris, 0.1, 0.9)


def generate_depth_features(seq_len, mode='real'):
    """Generate z-depth features [nose_z, left_iris_z, right_iris_z]."""
    depth = np.zeros((seq_len, 3))

    if mode == 'real':
        depth[:, 0] = -0.06 + np.random.randn(seq_len) * 0.005
        depth[:, 1] = -0.03 + np.random.randn(seq_len) * 0.003
        depth[:, 2] = -0.03 + np.random.randn(seq_len) * 0.003
        drift = np.cumsum(np.random.randn(seq_len) * 0.001)
        depth += drift[:, None]

    elif mode == 'photo':
        depth[:, 0] = -0.01 + np.random.randn(seq_len) * 0.0008
        depth[:, 1] = -0.008 + np.random.randn(seq_len) * 0.0005
        depth[:, 2] = -0.008 + np.random.randn(seq_len) * 0.0005

    elif mode == 'deepfake':
        depth[:, 0] = -0.04 + np.random.randn(seq_len) * 0.008
        depth[:, 1] = -0.02 + np.random.randn(seq_len) * 0.006
        depth[:, 2] = -0.02 + np.random.randn(seq_len) * 0.006
        n_flips = np.random.poisson(1)
        for _ in range(n_flips):
            pos = np.random.randint(0, seq_len)
            dur = np.random.randint(2, 8)
            end = min(pos + dur, seq_len)
            depth[pos:end, 0] *= -0.5

    return depth


def generate_real_human_sequence():
    """Generate a realistic human blendshape + iris temporal sequence."""
    seq = np.zeros((SEQ_LEN, N_FEATURES))

    blink = generate_blink_pattern(SEQ_LEN, blinks_per_min=np.random.uniform(10, 25))
    asym = np.random.uniform(0.85, 0.97)
    seq[:, 9]  = blink
    seq[:, 10] = blink * asym + np.random.randn(SEQ_LEN) * 0.015

    seq[:, 19] = blink * np.random.uniform(0.1, 0.4) + np.random.randn(SEQ_LEN) * 0.01
    seq[:, 20] = seq[:, 19] * asym + np.random.randn(SEQ_LEN) * 0.01

    micro = generate_micro_expressions(SEQ_LEN)
    seq[:, 44] = np.clip(micro['smile'] + np.random.randn(SEQ_LEN) * 0.01, 0, 1)
    seq[:, 45] = np.clip(micro['smile'] * np.random.uniform(0.9, 1.0) + np.random.randn(SEQ_LEN) * 0.01, 0, 1)
    seq[:, 1]  = np.clip(micro['brow'] + np.random.randn(SEQ_LEN) * 0.005, 0, 1)
    seq[:, 2]  = np.clip(micro['brow'] * np.random.uniform(0.9, 1.0) + np.random.randn(SEQ_LEN) * 0.005, 0, 1)
    seq[:, 3]  = np.clip(np.random.uniform(0, 0.1) + micro['micro'] * 0.3, 0, 1)

    gaze_h = np.cumsum(np.random.randn(SEQ_LEN) * 0.005)
    gaze_h = np.clip(gaze_h, -0.3, 0.3)
    seq[:, 13] = np.clip(np.maximum(0, gaze_h), 0, 1)
    seq[:, 16] = np.clip(np.maximum(0, -gaze_h), 0, 1)
    seq[:, 14] = np.clip(np.maximum(0, -gaze_h), 0, 1)
    seq[:, 15] = np.clip(np.maximum(0, gaze_h), 0, 1)

    gaze_v = np.cumsum(np.random.randn(SEQ_LEN) * 0.004)
    gaze_v = np.clip(gaze_v, -0.2, 0.2)
    seq[:, 11] = np.clip(np.maximum(0, gaze_v), 0, 1)
    seq[:, 12] = np.clip(np.maximum(0, gaze_v), 0, 1)
    seq[:, 17] = np.clip(np.maximum(0, -gaze_v), 0, 1)
    seq[:, 18] = np.clip(np.maximum(0, -gaze_v), 0, 1)

    seq[:, 25] = np.clip(np.random.uniform(0, 0.05) + micro['micro'] * 0.1, 0, 1)

    for i in range(N_BLENDSHAPES):
        if seq[:, i].sum() == 0:
            seq[:, i] = np.clip(np.random.uniform(0, 0.02, SEQ_LEN), 0, 1)

    seq[:, N_BLENDSHAPES:N_BLENDSHAPES+N_IRIS] = generate_iris_movement(SEQ_LEN, 'natural')
    seq[:, N_BLENDSHAPES+N_IRIS:] = generate_depth_features(SEQ_LEN, 'real')

    return np.clip(seq, 0, 1).astype(np.float32)


def generate_deepfake_sequence():
    """Generate a deepfake video blendshape sequence with characteristic artifacts."""
    seq = np.zeros((SEQ_LEN, N_FEATURES))

    archetype = np.random.choice(['perfect_sym', 'jittery', 'delayed_blink', 'flat_micro'])
    blink = generate_blink_pattern(SEQ_LEN, blinks_per_min=np.random.uniform(8, 22))

    if archetype == 'perfect_sym':
        seq[:, 9]  = blink
        seq[:, 10] = blink + np.random.randn(SEQ_LEN) * 0.002
        seq[:, 19] = blink * 0.3
        seq[:, 20] = blink * 0.3 + np.random.randn(SEQ_LEN) * 0.001

    elif archetype == 'jittery':
        jitter = np.random.randn(SEQ_LEN) * 0.04
        seq[:, 9]  = blink + jitter
        seq[:, 10] = blink * np.random.uniform(0.8, 0.95) + jitter * 0.8
        for i in range(N_BLENDSHAPES):
            seq[:, i] += np.random.randn(SEQ_LEN) * 0.02

    elif archetype == 'delayed_blink':
        delay = np.random.choice([1, 2])
        seq[:, 9] = blink
        seq[:, 10] = np.roll(blink, delay) * np.random.uniform(0.9, 1.0)
        seq[:, 19] = blink * 0.25
        seq[:, 20] = np.roll(blink * 0.25, delay)

    elif archetype == 'flat_micro':
        seq[:, 9]  = blink
        seq[:, 10] = blink * np.random.uniform(0.88, 0.96)

    gaze_h = np.cumsum(np.random.randn(SEQ_LEN) * 0.006)
    gaze_h = np.clip(gaze_h, -0.3, 0.3)
    seq[:, 13] = np.clip(np.maximum(0, gaze_h), 0, 1)
    seq[:, 16] = np.clip(np.maximum(0, -gaze_h), 0, 1)
    seq[:, 14] = np.clip(np.maximum(0, -gaze_h * 0.8), 0, 1)
    seq[:, 15] = np.clip(np.maximum(0, gaze_h * 0.8), 0, 1)

    gaze_v = np.cumsum(np.random.randn(SEQ_LEN) * 0.005)
    seq[:, 11] = np.clip(np.maximum(0, gaze_v), 0, 1)
    seq[:, 12] = np.clip(np.maximum(0, gaze_v * 0.9), 0, 1)

    if archetype != 'flat_micro':
        micro = generate_micro_expressions(SEQ_LEN)
        seq[:, 44] = np.clip(micro['smile'] * 0.5, 0, 1)
        seq[:, 45] = np.clip(micro['smile'] * 0.5, 0, 1)
    else:
        base_smile = np.random.uniform(0.02, 0.08)
        seq[:, 44] = base_smile
        seq[:, 45] = base_smile

    for i in range(N_BLENDSHAPES):
        if seq[:, i].sum() == 0:
            seq[:, i] = np.clip(np.random.uniform(0, 0.015, SEQ_LEN), 0, 1)

    seq[:, N_BLENDSHAPES:N_BLENDSHAPES+N_IRIS] = generate_iris_movement(SEQ_LEN, 'deepfake')
    seq[:, N_BLENDSHAPES+N_IRIS:] = generate_depth_features(SEQ_LEN, 'deepfake')

    return np.clip(seq, 0, 1).astype(np.float32)


def generate_photo_replay_sequence():
    """Generate a photo/still image replay blendshape sequence."""
    seq = np.zeros((SEQ_LEN, N_FEATURES))

    archetype = np.random.choice(['static', 'slight_motion', 'video_loop'])

    if archetype == 'static':
        base = np.random.uniform(0, 0.03, N_BLENDSHAPES)
        for i in range(N_BLENDSHAPES):
            seq[:, i] = base[i] + np.random.randn(SEQ_LEN) * 0.001

    elif archetype == 'slight_motion':
        base = np.random.uniform(0, 0.04, N_BLENDSHAPES)
        tremor = np.sin(np.arange(SEQ_LEN) * np.random.uniform(0.3, 0.8)) * 0.008
        for i in range(N_BLENDSHAPES):
            seq[:, i] = base[i] + tremor + np.random.randn(SEQ_LEN) * 0.002

    elif archetype == 'video_loop':
        loop_len = np.random.randint(30, 60)
        segment_blink = generate_blink_pattern(loop_len, blinks_per_min=15)
        full_blink = np.tile(segment_blink, (SEQ_LEN // loop_len) + 1)[:SEQ_LEN]
        seq[:, 9]  = full_blink
        seq[:, 10] = full_blink * 0.95
        for i in range(N_BLENDSHAPES):
            if i not in (9, 10):
                segment = np.random.uniform(0, 0.05, loop_len)
                seq[:, i] = np.tile(segment, (SEQ_LEN // loop_len) + 1)[:SEQ_LEN]

    iris_mode = 'frozen' if archetype != 'video_loop' else 'deepfake'
    seq[:, N_BLENDSHAPES:N_BLENDSHAPES+N_IRIS] = generate_iris_movement(SEQ_LEN, iris_mode)
    seq[:, N_BLENDSHAPES+N_IRIS:] = generate_depth_features(SEQ_LEN, 'photo')

    return np.clip(seq, 0, 1).astype(np.float32)


def generate_dataset(n_samples):
    """Generate balanced synthetic dataset."""
    n_real = int(n_samples * 0.40)
    n_deep = int(n_samples * 0.35)
    n_photo = n_samples - n_real - n_deep

    print(f"  Generating {n_real} real + {n_deep} deepfake + {n_photo} photo sequences...")

    X = np.zeros((n_samples, SEQ_LEN, N_FEATURES), dtype=np.float32)
    y = np.zeros(n_samples, dtype=np.int64)

    idx = 0
    for i in range(n_real):
        X[idx] = generate_real_human_sequence()
        y[idx] = 0
        idx += 1
    for i in range(n_deep):
        X[idx] = generate_deepfake_sequence()
        y[idx] = 1
        idx += 1
    for i in range(n_photo):
        X[idx] = generate_photo_replay_sequence()
        y[idx] = 2
        idx += 1

    perm = np.random.permutation(n_samples)
    return X[perm], y[perm]


# --- Model Architecture -------------------------------------------------------

class TemporalConvBlock(nn.Module):
    """1D convolution block for local temporal pattern extraction."""
    def __init__(self, in_ch, out_ch, kernel=3):
        super().__init__()
        self.conv = nn.Conv1d(in_ch, out_ch, kernel, padding=kernel // 2)
        self.bn = nn.BatchNorm1d(out_ch)

    def forward(self, x):
        return F.gelu(self.bn(self.conv(x)))


class MultiHeadTemporalAttention(nn.Module):
    """Multi-head attention pooling over temporal dimension."""
    def __init__(self, dim, n_heads=4):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = dim // n_heads
        self.qkv = nn.Linear(dim, dim * 3)
        self.out = nn.Linear(dim, dim)

    def forward(self, x):
        B, T, D = x.shape
        qkv = self.qkv(x).reshape(B, T, 3, self.n_heads, self.head_dim).permute(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        attn = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        attn = F.softmax(attn, dim=-1)
        out = (attn @ v).transpose(1, 2).reshape(B, T, D)
        out = self.out(out)
        weights = F.softmax(out.mean(dim=-1), dim=-1)
        pooled = (out * weights.unsqueeze(-1)).sum(dim=1)
        return pooled


class DeepfakeCNN(nn.Module):
    """
    Temporal CNN + BiGRU + Attention for deepfake detection from blendshapes.

    Input:  [B, SEQ_LEN, N_FEATURES] (90 x 59)
    Output: [B, N_CLASSES] (3 logits: real, deepfake, photo)

    ~100K parameters -> ~250KB ONNX
    """
    def __init__(self, n_features=N_FEATURES, n_classes=N_CLASSES,
                 conv_dim=64, gru_dim=48, n_heads=4):
        super().__init__()
        self.conv1 = TemporalConvBlock(n_features, conv_dim, kernel=5)
        self.conv2 = TemporalConvBlock(conv_dim, conv_dim, kernel=3)
        self.conv3 = TemporalConvBlock(conv_dim, conv_dim, kernel=3)

        self.gru = nn.GRU(conv_dim, gru_dim, num_layers=2, batch_first=True,
                          bidirectional=True, dropout=0.2)
        gru_out_dim = gru_dim * 2

        self.ln = nn.LayerNorm(gru_out_dim)
        self.attn = MultiHeadTemporalAttention(gru_out_dim, n_heads)

        self.classifier = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(gru_out_dim, 32),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(32, n_classes),
        )

    def forward(self, x):
        h = x.transpose(1, 2)
        h = self.conv1(h)
        h = self.conv2(h)
        h = self.conv3(h)
        h = h.transpose(1, 2)
        h, _ = self.gru(h)
        h = self.ln(h)
        h = self.attn(h)
        return self.classifier(h)


# --- Training -----------------------------------------------------------------

def train(args):
    device = torch.device(args.device if torch.cuda.is_available() else 'cpu')
    print(f"\n{'='*70}")
    print(f"  Deepfake Detection CNN - Blendshape + Iris Temporal Analysis")
    print(f"{'='*70}")
    print(f"  Device     : {device}")
    print(f"  Features   : {N_FEATURES} ({N_BLENDSHAPES} BS + {N_IRIS} iris + {N_DEPTH} depth)")
    print(f"  Seq length : {SEQ_LEN} frames (~{SEQ_LEN/15:.1f}s at 15fps)")
    print(f"  Classes    : {N_CLASSES} ({', '.join(CLASS_NAMES)})")
    print(f"  Epochs     : {args.epochs}")
    print(f"  Batch size : {args.batch_size}")
    print(f"  Train size : {args.train_size}")
    print(f"  Val size   : {args.val_size}")
    print(f"{'='*70}\n")

    print("  Generating training dataset...")
    X_train, y_train = generate_dataset(args.train_size)
    print("  Generating validation dataset...")
    X_val, y_val = generate_dataset(args.val_size)

    for split_name, labels in [('Train', y_train), ('Val', y_val)]:
        counts = np.bincount(labels, minlength=N_CLASSES)
        dist = ' | '.join(f'{CLASS_NAMES[i]}: {counts[i]}' for i in range(N_CLASSES))
        print(f"  {split_name}: {dist}")

    X_train_t = torch.from_numpy(X_train).to(device)
    y_train_t = torch.from_numpy(y_train).to(device)
    X_val_t   = torch.from_numpy(X_val).to(device)
    y_val_t   = torch.from_numpy(y_val).to(device)

    train_ds = TensorDataset(X_train_t, y_train_t)
    val_ds   = TensorDataset(X_val_t, y_val_t)
    train_dl = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, drop_last=True)
    val_dl   = DataLoader(val_ds, batch_size=args.batch_size * 2)

    model = DeepfakeCNN().to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"\n  Model: DeepfakeCNN - {n_params:,} params")

    class_counts = np.bincount(y_train, minlength=N_CLASSES).astype(np.float32)
    class_weights = 1.0 / (class_counts / class_counts.sum())
    class_weights /= class_weights.sum()
    class_weights_t = torch.from_numpy(class_weights).to(device)

    criterion = nn.CrossEntropyLoss(weight=class_weights_t, label_smoothing=0.05)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=args.lr * 5, epochs=args.epochs,
        steps_per_epoch=len(train_dl), pct_start=0.1
    )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    best_val_acc = 0.0
    best_epoch = 0
    best_per_class_acc = [0.0] * N_CLASSES
    patience_counter = 0

    print(f"\n  {'Ep':>4}  {'Loss':>8}  {'TrAcc':>8}  {'VLoss':>8}  {'VAcc':>7}  {'R/D/P':>12}  {'LR':>10}")
    print(f"  {'-'*75}")

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0
        correct = 0
        total = 0

        for X_batch, y_batch in train_dl:
            optimizer.zero_grad()

            if np.random.random() < 0.3:
                lam = np.random.beta(0.4, 0.4)
                perm = torch.randperm(X_batch.size(0), device=device)
                X_mix = lam * X_batch + (1 - lam) * X_batch[perm]
                logits = model(X_mix)
                loss = lam * criterion(logits, y_batch) + (1 - lam) * criterion(logits, y_batch[perm])
            else:
                logits = model(X_batch)
                loss = criterion(logits, y_batch)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            total_loss += loss.item() * X_batch.size(0)
            correct += (logits.argmax(dim=1) == y_batch).sum().item()
            total += X_batch.size(0)

        train_loss = total_loss / total
        train_acc = correct / total * 100

        model.eval_mode = True
        val_loss = 0
        val_correct = 0
        val_total = 0
        per_class_correct = np.zeros(N_CLASSES)
        per_class_total = np.zeros(N_CLASSES)

        with torch.no_grad():
            for X_batch, y_batch in val_dl:
                logits = model(X_batch)
                loss = criterion(logits, y_batch)
                preds = logits.argmax(dim=1)
                val_loss += loss.item() * X_batch.size(0)
                val_correct += (preds == y_batch).sum().item()
                val_total += X_batch.size(0)
                for c in range(N_CLASSES):
                    mask = y_batch == c
                    per_class_correct[c] += (preds[mask] == c).sum().item()
                    per_class_total[c] += mask.sum().item()

        val_loss_avg = val_loss / val_total
        val_acc = val_correct / val_total * 100
        per_class_acc = [per_class_correct[c] / max(1, per_class_total[c]) * 100 for c in range(N_CLASSES)]
        lr = optimizer.param_groups[0]['lr']

        is_best = val_acc > best_val_acc
        if is_best:
            best_val_acc = val_acc
            best_epoch = epoch
            best_per_class_acc = per_class_acc[:]
            patience_counter = 0
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_acc': val_acc,
                'per_class_acc': per_class_acc,
            }, output_dir / 'best_model.pt')
        else:
            patience_counter += 1

        marker = ' *' if is_best else ''
        class_str = '/'.join(f'{a:.0f}' for a in per_class_acc)
        print(f"  {epoch:4d}  {train_loss:8.4f}  {train_acc:7.1f}%  {val_loss_avg:8.4f}  {val_acc:6.1f}%  {class_str:>12}  {lr:10.6f}{marker}")

        if patience_counter >= args.patience:
            print(f"\n  Early stopping at epoch {epoch} (best: epoch {best_epoch}, val_acc={best_val_acc:.2f}%)")
            break

    print(f"\n  Loading best model (epoch {best_epoch}, val_acc={best_val_acc:.2f}%)...")
    checkpoint = torch.load(output_dir / 'best_model.pt', map_location=device, weights_only=False)
    model.load_state_dict(checkpoint['model_state_dict'])
    export_onnx(model, output_dir, device)

    metadata = {
        'version': '1.0.0',
        'model': 'DeepfakeCNN',
        'architecture': 'Conv1D(3) + BiGRU(2) + MultiHeadAttention(4) + MLP',
        'input_shape': [1, SEQ_LEN, N_FEATURES],
        'output_shape': [1, N_CLASSES],
        'classes': CLASS_NAMES,
        'n_params': n_params,
        'best_epoch': best_epoch,
        'best_val_acc': round(best_val_acc, 4),
        'per_class_acc': {CLASS_NAMES[i]: round(best_per_class_acc[i], 2) for i in range(N_CLASSES)},
        'features': {
            'blendshapes': N_BLENDSHAPES,
            'iris': N_IRIS,
            'depth': N_DEPTH,
            'total': N_FEATURES,
        },
        'seq_len': SEQ_LEN,
        'fps': 15,
        'train_size': args.train_size,
        'val_size': args.val_size,
    }
    with open(output_dir / 'deepfake_cnn_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"  Metadata saved: {output_dir / 'deepfake_cnn_metadata.json'}")


def export_onnx(model, output_dir, device):
    """Export model to ONNX format for browser inference."""
    model.train(False)
    dummy = torch.randn(1, SEQ_LEN, N_FEATURES, device=device)

    onnx_path = output_dir / 'deepfake_detector.onnx'
    torch.onnx.export(
        model, dummy, str(onnx_path),
        opset_version=17,
        input_names=['blendshape_sequence'],
        output_names=['class_logits'],
        dynamic_axes={
            'blendshape_sequence': {0: 'batch'},
            'class_logits': {0: 'batch'},
        },
    )

    size_kb = onnx_path.stat().st_size / 1024
    print(f"  ONNX exported: {onnx_path} ({size_kb:.1f} KB)")

    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(onnx_path))
        dummy_np = dummy.cpu().numpy()
        outputs = sess.run(None, {'blendshape_sequence': dummy_np})
        probs = np.exp(outputs[0]) / np.exp(outputs[0]).sum(axis=-1, keepdims=True)
        print(f"  ONNX verification: output shape {outputs[0].shape}, probs sum={probs.sum():.4f}")
    except ImportError:
        print("  Note: onnxruntime not installed, skipping verification")


def main():
    parser = argparse.ArgumentParser(description='Train Deepfake Detection CNN')
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--batch-size', type=int, default=256)
    parser.add_argument('--lr', type=float, default=3e-4)
    parser.add_argument('--train-size', type=int, default=50000)
    parser.add_argument('--val-size', type=int, default=10000)
    parser.add_argument('--patience', type=int, default=12)
    parser.add_argument('--device', type=str, default='cuda')
    parser.add_argument('--output', type=str, default='./model_output')
    parser.add_argument('--export-only', action='store_true')
    args = parser.parse_args()

    if args.export_only:
        output_dir = Path(args.output)
        device = torch.device(args.device if torch.cuda.is_available() else 'cpu')
        model = DeepfakeCNN().to(device)
        checkpoint = torch.load(output_dir / 'best_model.pt', map_location=device, weights_only=False)
        model.load_state_dict(checkpoint['model_state_dict'])
        export_onnx(model, output_dir, device)
    else:
        train(args)


if __name__ == '__main__':
    main()
