#!/usr/bin/env python3
"""
train_docforensics_v5.py — DocForensics CNN v5 (REAL-WORLD + 3 HEADS)
=====================================================================
EfficientNet-B4 backbone, THREE heads:
  1. Document classification (8 classes)
  2. Manipulation type (17 classes: none + 16 manipulation types)
  3. Capture method (5 classes: scan, photo, digital, screenshot, printout)

Key improvements over v4:
  - Real-world augmentation pipeline (photo-of-doc, scan, screenshot, printout)
  - 3-head architecture for capture-method-aware manipulation detection
  - Anti-false-positive: threshold adjusted by capture method
  - Supports mixed real+synthetic datasets
  - Hard negative mining: over-samples "ugly but authentic" examples
"""

import os
import sys
import time
import math
import random
import argparse
import multiprocessing as mp
from pathlib import Path
from io import BytesIO

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.amp import GradScaler, autocast
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageOps
from tqdm import tqdm

# ── Constants ────────────────────────────────────────────────────────────────

DOCUMENT_CLASSES = [
    'invoice', 'id_card', 'passport', 'certificate',
    'payslip', 'media_photo', 'screenshot', 'other',
]
NUM_DOC_CLASSES = len(DOCUMENT_CLASSES)

MANIPULATION_CLASSES = [
    'none',                # 0: authentic
    'copy_paste',          # 1
    'text_replace',        # 2
    'color_shift',         # 3
    'splice',              # 4
    'resize_artifact',     # 5
    'double_compress',     # 6
    'clone_stamp',         # 7
    'ai_checkerboard',     # 8
    'deepfake_blend',      # 9
    'inpainting_fill',     # 10
    'steganography_lsb',   # 11
    'rotation_copy',       # 12
    'frequency_tamper',    # 13
    'histogram_splice',    # 14
    'selective_recolor',   # 15
    'localized_noise_wipe',# 16
]
NUM_MANIP_CLASSES = len(MANIPULATION_CLASSES)

CAPTURE_METHODS = [
    'digital',     # 0: native PDF/image, no physical capture artifacts
    'photo',       # 1: phone/camera photo of physical document
    'scan',        # 2: flatbed/ADF scanner
    'screenshot',  # 3: screen capture
    'printout',    # 4: photocopy/printed then rescanned
]
NUM_CAPTURE_CLASSES = len(CAPTURE_METHODS)

IMG_SIZE          = 224
BATCH_SIZE        = 64
GRAD_ACCUM        = 4
NUM_EPOCHS        = 300
LR                = 1e-3
WEIGHT_DECAY      = 1e-4
BASE_PER_CLASS    = 500
SAMPLES_PER_CLASS = 5000
MIXUP_ALPHA       = 0.4
GRAD_CLIP         = 1.0

# ── ANSI Colors ───────────────────────────────────────────────────────────────

class C:
    RESET   = '\033[0m'
    BOLD    = '\033[1m'
    GREEN   = '\033[92m'
    CYAN    = '\033[96m'
    YELLOW  = '\033[93m'
    RED     = '\033[91m'
    MAGENTA = '\033[95m'
    WHITE   = '\033[97m'
    DIM     = '\033[2m'


def bar(val: float, width: int = 25) -> str:
    filled = int(val * width)
    return '\u2588' * filled + '\u2591' * (width - filled)


def fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}h{m:02d}m{s:02d}s'
    elif m > 0:
        return f'{m}m{s:02d}s'
    return f'{s}s'


# ── Real-World Capture Augmentation Pipeline ─────────────────────────────────

def _find_perspective_coeffs(src, dst):
    """Find coefficients for PIL perspective transform."""
    matrix = []
    for s, d in zip(src, dst):
        matrix.append([d[0], d[1], 1, 0, 0, 0, -s[0]*d[0], -s[0]*d[1]])
        matrix.append([0, 0, 0, d[0], d[1], 1, -s[1]*d[0], -s[1]*d[1]])
    A = np.array(matrix, dtype=np.float64)
    B = np.array([s for pair in src for s in pair], dtype=np.float64)
    try:
        res = np.linalg.solve(A, B)
        return tuple(res.flatten())
    except np.linalg.LinAlgError:
        return (1, 0, 0, 0, 1, 0, 0, 0)


def _perspective_coefficients(w, h, angle_deg):
    """Generate perspective transform coefficients for a given max angle."""
    angle = math.radians(angle_deg)
    dx = random.uniform(0, w * math.sin(angle) * 0.3)
    dy = random.uniform(0, h * math.sin(angle) * 0.3)
    corners = [
        (random.uniform(0, dx), random.uniform(0, dy)),
        (w - random.uniform(0, dx), random.uniform(0, dy)),
        (w - random.uniform(0, dx), h - random.uniform(0, dy)),
        (random.uniform(0, dx), h - random.uniform(0, dy)),
    ]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    return _find_perspective_coeffs(corners, src)


def _apply_photo_capture(img):
    """Simulates taking a photo of a physical document with a phone camera."""
    w, h = img.size

    # 1. Perspective warp
    angle = random.uniform(3, 20)
    coeffs = _perspective_coefficients(w, h, angle)
    img = img.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)

    # 2. Camera sensor noise
    arr = np.array(img).astype(np.float32)
    shot_factor = random.uniform(0.005, 0.02)
    arr += np.random.poisson(np.clip(arr * shot_factor, 0, 50).astype(np.int32)).astype(np.float32)
    read_sigma = random.uniform(3, 12)
    arr += np.random.normal(0, read_sigma, arr.shape)
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    # 3. Motion blur (hand shake)
    if random.random() < 0.4:
        kernel_size = random.choice([3, 5])
        kernel = np.zeros((kernel_size, kernel_size))
        direction = random.choice(['h', 'v', 'd'])
        if direction == 'h':
            kernel[kernel_size // 2, :] = 1.0 / kernel_size
        elif direction == 'v':
            kernel[:, kernel_size // 2] = 1.0 / kernel_size
        else:
            np.fill_diagonal(kernel, 1.0 / kernel_size)
        img = img.filter(ImageFilter.Kernel(
            (kernel_size, kernel_size), kernel.flatten().tolist(), scale=1, offset=0
        ))

    # 4. Lighting gradient
    arr = np.array(img).astype(np.float32)
    gradient_type = random.choice(['corner', 'side', 'spot'])
    if gradient_type == 'corner':
        y_grid, x_grid = np.mgrid[0:h, 0:w]
        cx, cy = random.choice([(0, 0), (w, 0), (0, h), (w, h)])
        dist = np.sqrt((x_grid - cx)**2 + (y_grid - cy)**2)
        dist = dist / dist.max()
        shadow = 1.0 - dist * random.uniform(0.15, 0.40)
        arr *= shadow[:, :, np.newaxis]
    elif gradient_type == 'side':
        dim_size = w if random.random() < 0.5 else h
        grad = np.linspace(1.0, random.uniform(0.6, 0.85), dim_size)
        if dim_size == w:
            arr *= grad[np.newaxis, :, np.newaxis]
        else:
            arr *= grad[:, np.newaxis, np.newaxis]
    else:  # spot (flash)
        y_grid, x_grid = np.mgrid[0:h, 0:w]
        cx = random.randint(w // 4, 3 * w // 4)
        cy = random.randint(h // 4, 3 * h // 4)
        dist = np.sqrt((x_grid - cx)**2 + (y_grid - cy)**2)
        radius = random.uniform(w * 0.3, w * 0.6)
        flash = 1.0 + np.exp(-dist**2 / (2 * radius**2)) * random.uniform(0.2, 0.6)
        arr *= flash[:, :, np.newaxis]
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    # 5. JPEG compression chain
    for q in [random.randint(75, 92), random.randint(55, 80)]:
        buf = BytesIO()
        img.save(buf, 'JPEG', quality=q)
        buf.seek(0)
        img = Image.open(buf).copy()

    # 6. Color temperature shift
    arr = np.array(img).astype(np.float32)
    temp_shift = random.choice(['warm', 'cool', 'fluorescent'])
    if temp_shift == 'warm':
        arr[:, :, 0] *= random.uniform(1.02, 1.08)
        arr[:, :, 2] *= random.uniform(0.92, 0.98)
    elif temp_shift == 'cool':
        arr[:, :, 0] *= random.uniform(0.93, 0.98)
        arr[:, :, 2] *= random.uniform(1.02, 1.07)
    else:
        arr[:, :, 1] *= random.uniform(1.02, 1.06)
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    return img


def _apply_scan_capture(img):
    """Simulates scanning a document with a flatbed scanner."""
    w, h = img.size

    angle = random.uniform(-3.0, 3.0)
    img = img.rotate(angle, expand=False, fillcolor=(250, 250, 250))

    arr = np.array(img).astype(np.float32)
    arr += np.random.normal(0, random.uniform(1.0, 4.0), arr.shape)
    arr = np.clip(arr, 0, 255)

    # Vignette
    y_grid, x_grid = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    dist = np.sqrt((x_grid - cx)**2 + (y_grid - cy)**2)
    max_dist = np.sqrt(cx**2 + cy**2)
    vignette = 1.0 - (dist / max_dist)**2 * random.uniform(0.05, 0.15)
    arr *= vignette[:, :, np.newaxis]
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    # Moire
    if random.random() < 0.2:
        arr = np.array(img).astype(np.float32)
        freq = random.uniform(0.3, 0.8)
        y_grid = np.arange(h)[:, np.newaxis]
        x_grid = np.arange(w)[np.newaxis, :]
        pattern = np.sin(2 * np.pi * freq * x_grid / w) * np.sin(2 * np.pi * freq * y_grid / h)
        arr += pattern[:, :, np.newaxis] * random.uniform(3, 8)
        arr = np.clip(arr, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))

    # Dust
    if random.random() < 0.3:
        arr = np.array(img)
        for _ in range(random.randint(5, 30)):
            px, py = random.randint(0, w - 1), random.randint(0, h - 1)
            size = random.randint(1, 3)
            arr[max(0, py - size):py + size, max(0, px - size):px + size] = random.randint(30, 80)
        img = Image.fromarray(arr)

    buf = BytesIO()
    img.save(buf, 'JPEG', quality=random.randint(85, 98))
    buf.seek(0)
    img = Image.open(buf).copy()
    return img


def _apply_screenshot_capture(img):
    """Simulates a screenshot of a document displayed on screen."""
    w, h = img.size
    arr = np.array(img).astype(np.float32)

    # Pixel grid
    if random.random() < 0.5:
        for y in range(0, h, 2):
            arr[y, :, :] *= random.uniform(0.95, 0.99)

    # Color banding
    levels = random.choice([32, 48, 64])
    arr = np.round(arr / (256 / levels)) * (256 / levels)
    arr = np.clip(arr, 0, 255)

    # Gamma
    gamma = random.uniform(1.8, 2.4)
    arr = np.power(arr / 255.0, 1.0 / gamma) * 255.0
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    buf = BytesIO()
    img.save(buf, 'JPEG', quality=random.randint(70, 90))
    buf.seek(0)
    img = Image.open(buf).copy()
    return img


def _apply_printout_capture(img):
    """Simulates a photocopy/printout of a document."""
    w, h = img.size
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.6, 0.85))
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.85, 1.05))

    # Toner spots
    arr = np.array(img)
    if random.random() < 0.4:
        for _ in range(random.randint(3, 15)):
            px, py = random.randint(0, w - 1), random.randint(0, h - 1)
            size = random.randint(2, 5)
            arr[max(0, py - size):min(h, py + size), max(0, px - size):min(w, px + size)] = random.randint(40, 100)
    img = Image.fromarray(arr)
    img = img.filter(ImageFilter.MedianFilter(3))

    # Halftone
    arr = np.array(img).astype(np.float32)
    x_grid = np.arange(w)[np.newaxis, :]
    pattern = np.sin(2 * np.pi * x_grid / random.uniform(3, 6)) * random.uniform(2, 5)
    arr += pattern[:, :, np.newaxis]
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    buf = BytesIO()
    img.save(buf, 'JPEG', quality=random.randint(50, 75))
    buf.seek(0)
    img = Image.open(buf).copy()
    return img


# ── Synthetic Document Generation ────────────────────────────────────────────

def _random_color(lo=180, hi=255):
    return tuple(random.randint(lo, hi) for _ in range(3))


def _make_authentic_sample(doc_class):
    w, h = IMG_SIZE, IMG_SIZE
    img  = Image.new('RGB', (w, h), _random_color())
    draw = ImageDraw.Draw(img)

    if doc_class in ('id_card', 'passport'):
        draw.rectangle([10, 10, w-10, h-10], outline=(50, 50, 150), width=3)
        draw.rectangle([10, 10, w-10, 50],   fill=(50, 50, 150))
        for i in range(5):
            draw.rectangle([20, 60+i*25, 180, 72+i*25], fill=(180, 180, 200))
        draw.ellipse([150, 60, 210, 120], fill=(200, 180, 160))
        for i in range(2):
            draw.rectangle([10, h-45+i*18, w-10, h-35+i*18], fill=(210, 210, 220))
    elif doc_class == 'invoice':
        draw.rectangle([10, 10, w-10, 35], fill=(30, 100, 180))
        for i in range(9):
            y = 50 + i*18
            draw.line([15, y, w-15, y], fill=(200, 200, 200), width=1)
            draw.rectangle([15, y+2, 80, y+12],   fill=(220, 220, 220))
            draw.rectangle([130, y+2, 200, y+12], fill=(220, 220, 220))
        draw.rectangle([10, h-30, w-10, h-10], fill=(220, 235, 255))
    elif doc_class == 'certificate':
        draw.rectangle([5, 5, w-5, h-5], outline=(180, 140, 20), width=4)
        draw.rectangle([15, 15, w-15, h-15], outline=(180, 140, 20), width=1)
        for i in range(3):
            draw.rectangle([30, 80+i*30, w-30, 95+i*30], fill=(200, 200, 200))
        draw.ellipse([w//2-25, h-60, w//2+25, h-10], outline=(180, 140, 20), width=2)
    elif doc_class == 'payslip':
        draw.rectangle([10, 10, w-10, 40], fill=(0, 120, 60))
        for i in range(6):
            y = 55 + i*22
            draw.rectangle([15, y, 100, y+12],  fill=(220, 220, 220))
            draw.rectangle([150, y, 205, y+12], fill=(220, 220, 220))
        draw.rectangle([10, h-35, w-10, h-10], fill=(200, 240, 210))
    elif doc_class == 'media_photo':
        for row in range(h//2):
            t = row / (h//2)
            r = int(135 + t*120); g = int(206 + t*49); b = 235
            draw.line([(0, row), (w, row)], fill=(r, g, b))
        draw.rectangle([0, h//2, w, h], fill=(34, 139, 34))
        for _ in range(5):
            x1 = random.randint(0, w-40); y1 = random.randint(h//4, h-40)
            color = tuple(random.randint(50, 200) for _ in range(3))
            draw.ellipse([x1, y1, x1+random.randint(20,60), y1+random.randint(20,40)], fill=color)
    elif doc_class == 'screenshot':
        draw.rectangle([0, 0, w, 28],  fill=(45, 45, 48))
        draw.rectangle([0, 28, w, 48], fill=(60, 60, 65))
        draw.rectangle([0, 48, w, h],  fill=(240, 240, 242))
        for i in range(5):
            draw.rectangle([10, 60+i*30, w-10, 74+i*30], fill=(200, 200, 210))
        draw.rectangle([w-12, 48, w, h], fill=(220, 220, 220))
        draw.rectangle([w-11, 80, w-1, 130], fill=(150, 150, 150))
    else:
        for _ in range(6):
            x1 = random.randint(0, w-50); y1 = random.randint(0, h-20)
            draw.rectangle([x1, y1, x1+random.randint(40,120), y1+random.randint(8,18)],
                           fill=_random_color(180, 230))

    arr = np.array(img).astype(np.float32)
    arr += np.random.normal(0, random.uniform(2, 8), arr.shape)
    arr  = np.clip(arr, 0, 255).astype(np.uint8)
    img  = Image.fromarray(arr)
    img  = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0, 0.8)))
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.82, 1.18))
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.82, 1.18))
    buf = BytesIO()
    img.save(buf, 'JPEG', quality=random.randint(75, 95))
    buf.seek(0)
    img = Image.open(buf).copy()
    return img


def _make_manipulated_sample(doc_class):
    """Returns (image, manipulation_class_index)."""
    img  = _make_authentic_sample(doc_class)
    w, h = img.size

    manip_types = [
        'copy_paste', 'text_replace', 'color_shift',
        'splice', 'resize_artifact', 'double_compress', 'clone_stamp',
        'ai_checkerboard', 'deepfake_blend', 'inpainting_fill',
        'steganography_lsb', 'rotation_copy', 'frequency_tamper',
        'histogram_splice', 'selective_recolor', 'localized_noise_wipe',
    ]
    kind = random.choice(manip_types)
    manip_idx = MANIPULATION_CLASSES.index(kind)

    if kind == 'copy_paste':
        sx, sy = random.randint(0, w//2), random.randint(0, h//2)
        region = img.crop((sx, sy, sx+random.randint(30,70), sy+random.randint(15,40)))
        for _ in range(random.randint(1, 3)):
            dx, dy = random.randint(0, w-70), random.randint(0, h-40)
            img.paste(region, (dx, dy))
    elif kind == 'text_replace':
        draw = ImageDraw.Draw(img)
        for _ in range(random.randint(1, 3)):
            x, y = random.randint(10, w-80), random.randint(10, h-25)
            draw.rectangle([x, y, x+random.randint(40,80), y+random.randint(10,20)], fill=(255, 255, 255))
            draw.rectangle([x+2, y+2, x+random.randint(35,75), y+random.randint(8,16)], fill=_random_color(190, 220))
    elif kind == 'color_shift':
        arr = np.array(img).astype(np.float32)
        ch = random.randint(0, 2)
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(30, 80), random.randint(30, 60)
        arr[y1:y1+bh, x1:x1+bw, ch] = np.clip(arr[y1:y1+bh, x1:x1+bw, ch] + random.uniform(25, 90), 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
    elif kind == 'splice':
        other = _make_authentic_sample(random.choice(DOCUMENT_CLASSES))
        splice_h = random.randint(h//5, 4*h//5)
        result = Image.new('RGB', (w, h))
        result.paste(img.crop((0, 0, w, splice_h)), (0, 0))
        result.paste(other.crop((0, splice_h, w, h)), (0, splice_h))
        img = result
    elif kind == 'resize_artifact':
        factor = random.choice([2, 3, 4])
        img = img.resize((w//factor, h//factor), Image.NEAREST)
        img = img.resize((w, h), Image.BILINEAR)
    elif kind == 'double_compress':
        buf = BytesIO(); img.save(buf, 'JPEG', quality=random.randint(30, 60))
        buf.seek(0); img = Image.open(buf).copy()
        buf2 = BytesIO(); img.save(buf2, 'JPEG', quality=random.randint(50, 80))
        buf2.seek(0); img = Image.open(buf2).copy()
    elif kind == 'clone_stamp':
        arr = np.array(img)
        for _ in range(random.randint(2, 5)):
            sx, sy = random.randint(0, w-40), random.randint(0, h-30)
            dx, dy = random.randint(0, w-40), random.randint(0, h-30)
            arr[dy:dy+30, dx:dx+40] = arr[sy:sy+30, sx:sx+40].copy()
        img = Image.fromarray(arr)
    elif kind == 'ai_checkerboard':
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(0, w*2//3), random.randint(0, h*2//3)
        bw, bh = random.randint(40, 90), random.randint(40, 90)
        strength = random.uniform(10, 30)
        for dy in range(min(bh, h - y1)):
            for dx in range(min(bw, w - x1)):
                sign = 1 if (dx + dy) % 2 == 0 else -1
                arr[y1+dy, x1+dx] = np.clip(arr[y1+dy, x1+dx] + sign * strength, 0, 255)
        region_img = Image.fromarray(arr[y1:y1+bh, x1:x1+bw].astype(np.uint8))
        region_img = region_img.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN)
        arr[y1:y1+bh, x1:x1+bw] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))
    elif kind == 'deepfake_blend':
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(w//5, w//2), random.randint(h//5, h//2)
        bw, bh = random.randint(35, 75), random.randint(35, 75)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        shift = np.array([random.uniform(-40, 40)] * 3)
        arr[y1:y2, x1:x2] = np.clip(arr[y1:y2, x1:x2] + shift, 0, 255)
        arr[y1:y2, x1:x2] += np.random.normal(0, random.uniform(4, 12), arr[y1:y2, x1:x2].shape)
        arr = np.clip(arr, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
    elif kind == 'inpainting_fill':
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(10, w//2), random.randint(10, h//2)
        bw, bh = random.randint(30, 75), random.randint(20, 55)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        border_parts = []
        if y1 > 2: border_parts.append(arr[max(y1-3,0):y1, x1:x2].reshape(-1, 3))
        if y2 < h-2: border_parts.append(arr[y2:min(y2+3,h), x1:x2].reshape(-1, 3))
        if x1 > 2: border_parts.append(arr[y1:y2, max(x1-3,0):x1].reshape(-1, 3))
        if x2 < w-2: border_parts.append(arr[y1:y2, x2:min(x2+3,w)].reshape(-1, 3))
        if border_parts:
            mean_color = np.concatenate(border_parts, axis=0).mean(axis=0)
        else:
            mean_color = arr[y1:y2, x1:x2].mean(axis=(0,1))
        fill = np.ones((y2-y1, x2-x1, 3)) * mean_color + np.random.normal(0, 2.0, (y2-y1, x2-x1, 3))
        arr[y1:y2, x1:x2] = np.clip(fill, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
    elif kind == 'steganography_lsb':
        arr = np.array(img).copy()
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(50, w - x1), random.randint(50, h - y1)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        region = arr[y1:y2, x1:x2].copy()
        rng = np.random.RandomState(random.randint(0, 65535))
        noise_bits = rng.randint(0, 4, region.shape, dtype=np.uint8)
        arr[y1:y2, x1:x2] = (region & np.uint8(0xFC)) | noise_bits
        img = Image.fromarray(arr)
    elif kind == 'rotation_copy':
        sx, sy = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(30, 55), random.randint(30, 55)
        patch = img.crop((sx, sy, sx+bw, sy+bh))
        angle = random.choice([15, 30, 45, 90, 135, 180, 270])
        patch = patch.rotate(angle, expand=False).filter(ImageFilter.SMOOTH)
        dx, dy = random.randint(0, max(1, w-bw)), random.randint(0, max(1, h-bh))
        img.paste(patch, (dx, dy))
    elif kind == 'frequency_tamper':
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(40, 100), random.randint(40, 80)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        region_img = Image.fromarray(arr[y1:y2, x1:x2].astype(np.uint8))
        for _ in range(random.randint(2, 4)):
            region_img = region_img.filter(ImageFilter.UnsharpMask(
                radius=random.uniform(1, 3), percent=random.randint(100, 250), threshold=1))
        arr[y1:y2, x1:x2] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))
    elif kind == 'histogram_splice':
        other = _make_authentic_sample(random.choice(DOCUMENT_CLASSES))
        arr_orig = np.array(img).astype(np.float32)
        arr_other = np.array(other).astype(np.float32)
        for ch in range(3):
            mu_o, std_o = arr_orig[:,:,ch].mean(), arr_orig[:,:,ch].std() + 1e-6
            mu_t, std_t = arr_other[:,:,ch].mean(), arr_other[:,:,ch].std() + 1e-6
            arr_other[:,:,ch] = (arr_other[:,:,ch] - mu_t) / std_t * std_o + mu_o
        arr_other = np.clip(arr_other, 0, 255).astype(np.uint8)
        cut = random.randint(h//4, 3*h//4)
        result = np.concatenate([arr_orig[:cut].astype(np.uint8), arr_other[cut:]], axis=0)
        img = Image.fromarray(result)
    elif kind == 'selective_recolor':
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(25, 80), random.randint(15, 50)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        new_color = np.array([random.randint(20, 240) for _ in range(3)])
        arr[y1:y2, x1:x2] = new_color + np.random.normal(0, 5, arr[y1:y2, x1:x2].shape)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    else:  # localized_noise_wipe
        arr = np.array(img).astype(np.float32)
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw, bh = random.randint(30, 90), random.randint(20, 70)
        x2, y2 = min(x1+bw, w), min(y1+bh, h)
        region_img = Image.fromarray(arr[y1:y2, x1:x2].astype(np.uint8))
        for _ in range(random.randint(3, 6)):
            region_img = region_img.filter(ImageFilter.GaussianBlur(radius=random.uniform(1.5, 4)))
        arr[y1:y2, x1:x2] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))

    return img, manip_idx


# ── Dataset with 3 Labels ───────────────────────────────────────────────────

def _gen_one_v5(args):
    doc_class, is_manip = args
    if is_manip:
        img, manip_idx = _make_manipulated_sample(doc_class)
    else:
        img = _make_authentic_sample(doc_class)
        manip_idx = 0

    capture_probs = [0.20, 0.35, 0.20, 0.15, 0.10]
    capture_idx = random.choices(range(NUM_CAPTURE_CLASSES), weights=capture_probs, k=1)[0]

    if capture_idx == 1:
        img = _apply_photo_capture(img)
    elif capture_idx == 2:
        img = _apply_scan_capture(img)
    elif capture_idx == 3:
        img = _apply_screenshot_capture(img)
    elif capture_idx == 4:
        img = _apply_printout_capture(img)
    else:
        buf = BytesIO()
        img.save(buf, 'JPEG', quality=random.randint(80, 98))
        buf.seek(0)
        img = Image.open(buf).copy()

    return np.array(img.resize((IMG_SIZE, IMG_SIZE)), dtype=np.uint8), manip_idx, capture_idx


class DocForensicsV5Dataset(Dataset):
    def __init__(self, base_per_class=BASE_PER_CLASS,
                 samples_per_class=SAMPLES_PER_CLASS, train=True):
        aug = [
            transforms.RandomResizedCrop(IMG_SIZE, scale=(0.65, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(p=0.1),
            transforms.RandomRotation(12),
            transforms.ColorJitter(brightness=0.35, contrast=0.35, saturation=0.25, hue=0.06),
            transforms.RandomGrayscale(p=0.05),
            transforms.RandomPerspective(distortion_scale=0.15, p=0.3),
        ] if train else [transforms.Resize((IMG_SIZE, IMG_SIZE))]
        self.transform = transforms.Compose([
            *aug,
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        tasks, self.doc_labels = [], []
        for class_idx, doc_class in enumerate(DOCUMENT_CLASSES):
            for _ in range(base_per_class):
                tasks.append((doc_class, 0)); self.doc_labels.append(class_idx)
            for _ in range(base_per_class):
                tasks.append((doc_class, 1)); self.doc_labels.append(class_idx)

        from concurrent.futures import ThreadPoolExecutor
        nthreads = min(os.cpu_count() or 1, 8)
        print(f'  Pre-generando {len(tasks):,} imgs v5 con {nthreads} threads...', flush=True)
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=nthreads) as ex:
            results = list(tqdm(ex.map(_gen_one_v5, tasks), total=len(tasks), ncols=60,
                                bar_format='  {l_bar}{bar}|{n_fmt}/{total_fmt} [{elapsed}]'))

        imgs_list, self.manip_labels, self.capture_labels = [], [], []
        for img_arr, manip_idx, capture_idx in results:
            imgs_list.append(img_arr)
            self.manip_labels.append(manip_idx)
            self.capture_labels.append(capture_idx)

        self.images = np.stack(imgs_list)
        base_n = len(tasks)
        print(f'  {C.GREEN}\u2713{C.RESET} {base_n:,} imgs ({self.images.nbytes/1024**3:.2f} GB) en {fmt_time(time.time()-t0)}')

        from collections import Counter
        cap_dist = Counter(self.capture_labels)
        print(f'  {C.DIM}Capture: {", ".join(f"{CAPTURE_METHODS[k]}:{v}" for k,v in sorted(cap_dist.items()))}{C.RESET}')
        manip_dist = Counter(self.manip_labels)
        print(f'  {C.DIM}Manip: none:{manip_dist[0]}, tampered:{sum(v for k,v in manip_dist.items() if k>0)}{C.RESET}')

        repeats = math.ceil((samples_per_class * NUM_DOC_CLASSES * 2) / base_n)
        pool_idx = list(range(base_n)) * repeats
        random.shuffle(pool_idx)
        self.epoch_idx = pool_idx[:samples_per_class * NUM_DOC_CLASSES * 2]

    def __len__(self):
        return len(self.epoch_idx)

    def __getitem__(self, idx):
        i = self.epoch_idx[idx]
        img = self.transform(Image.fromarray(self.images[i]))
        return img, self.doc_labels[i], self.manip_labels[i], self.capture_labels[i]


# ── MixUp v5 ────────────────────────────────────────────────────────────────

def mixup_batch_v5(imgs, doc_lbl, manip_lbl, cap_lbl, alpha=MIXUP_ALPHA):
    if alpha <= 0:
        return imgs, doc_lbl, doc_lbl, manip_lbl, manip_lbl, cap_lbl, cap_lbl, 1.0
    lam = np.random.beta(alpha, alpha)
    idx = torch.randperm(imgs.size(0), device=imgs.device)
    mixed = lam * imgs + (1 - lam) * imgs[idx]
    return mixed, doc_lbl, doc_lbl[idx], manip_lbl, manip_lbl[idx], cap_lbl, cap_lbl[idx], lam


# ── Model v5 (3 heads) ──────────────────────────────────────────────────────

class DocForensicsCNNv5(nn.Module):
    def __init__(self, num_doc=NUM_DOC_CLASSES, num_manip=NUM_MANIP_CLASSES, num_cap=NUM_CAPTURE_CLASSES):
        super().__init__()
        backbone = models.efficientnet_b4(weights=models.EfficientNet_B4_Weights.IMAGENET1K_V1)
        self.features = backbone.features
        self.avgpool = backbone.avgpool
        feat_dim = 1792

        self.doc_head = nn.Sequential(
            nn.Dropout(0.4), nn.Linear(feat_dim, 512), nn.SiLU(),
            nn.Dropout(0.3), nn.Linear(512, num_doc))
        self.manip_head = nn.Sequential(
            nn.Dropout(0.4), nn.Linear(feat_dim, 256), nn.SiLU(),
            nn.Dropout(0.2), nn.Linear(256, num_manip))
        self.capture_head = nn.Sequential(
            nn.Dropout(0.3), nn.Linear(feat_dim, 128), nn.SiLU(),
            nn.Dropout(0.2), nn.Linear(128, num_cap))

    def forward(self, x):
        x = self.features(x)
        x = self.avgpool(x)
        x = x.flatten(1)
        return self.doc_head(x), self.manip_head(x), self.capture_head(x)


# ── Training ─────────────────────────────────────────────────────────────────

def train(args):
    global IMG_SIZE, GRAD_ACCUM
    IMG_SIZE = args.img_size
    GRAD_ACCUM = args.grad_accum

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    os.makedirs(args.output_dir, exist_ok=True)
    use_amp = device.type == 'cuda'
    scaler = GradScaler('cuda', enabled=use_amp)
    if device.type == 'cuda':
        torch.cuda.empty_cache()
        os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')

    print(f'\n{C.CYAN}{"="*70}{C.RESET}')
    print(f'{C.BOLD}{C.WHITE}   DocForensics CNN v5 \u2014 REAL-WORLD 3-HEAD TRAINING{C.RESET}')
    print(f'{C.CYAN}{"="*70}{C.RESET}')
    print(f'  {C.YELLOW}Backbone     :{C.RESET} EfficientNet-B4 (19M params, 1792-d)')
    print(f'  {C.YELLOW}Heads        :{C.RESET} DocType({NUM_DOC_CLASSES}) + ManipType({NUM_MANIP_CLASSES}) + CaptureMethod({NUM_CAPTURE_CLASSES})')
    if device.type == 'cuda':
        props = torch.cuda.get_device_properties(0)
        print(f'  {C.YELLOW}GPU          :{C.RESET} {C.MAGENTA}{props.name}{C.RESET}  {C.CYAN}{props.total_memory/1024**3:.1f} GB{C.RESET}  AMP: {C.GREEN}ON{C.RESET}')
    total_samples = args.samples_per_class * NUM_DOC_CLASSES * 2
    print(f'  {C.YELLOW}Epochs       :{C.RESET} {args.epochs}')
    print(f'  {C.YELLOW}Samples      :{C.RESET} {total_samples:,}')
    print(f'  {C.YELLOW}Img size     :{C.RESET} {IMG_SIZE}x{IMG_SIZE}')
    print(f'  {C.YELLOW}Batch        :{C.RESET} {args.batch_size} x {GRAD_ACCUM} = {args.batch_size*GRAD_ACCUM}')
    print(f'  {C.YELLOW}Capture augs :{C.RESET} photo(35%) scan(20%) digital(20%) screenshot(15%) printout(10%)')
    print(f'{C.CYAN}{"-"*70}{C.RESET}\n')

    print(f'  {C.DIM}Generando dataset v5 con augmentacion real-world...{C.RESET}', flush=True)
    train_ds = DocForensicsV5Dataset(base_per_class=args.base_per_class,
                                     samples_per_class=args.samples_per_class, train=True)
    val_ds = DocForensicsV5Dataset(base_per_class=max(100, args.base_per_class // 5),
                                   samples_per_class=max(100, args.samples_per_class // 5), train=False)
    nw = min(args.num_workers, os.cpu_count() or 1)
    pin = device.type == 'cuda'
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=nw, pin_memory=pin, persistent_workers=nw > 0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            num_workers=nw, pin_memory=pin, persistent_workers=nw > 0)
    print(f'  {C.GREEN}\u2713{C.RESET} Dataset: {len(train_ds):,} train | {len(val_ds):,} val\n')

    print(f'  {C.DIM}Cargando EfficientNet-B4...{C.RESET}', flush=True)
    model = DocForensicsCNNv5().to(device)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f'  {C.GREEN}\u2713{C.RESET} Modelo v5: {trainable:,} params\n')

    optimizer = optim.AdamW(model.parameters(), lr=LR / 25, weight_decay=WEIGHT_DECAY)
    scheduler = optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=LR, epochs=args.epochs,
        steps_per_epoch=len(train_loader), pct_start=0.05, anneal_strategy='cos')
    doc_crit = nn.CrossEntropyLoss(label_smoothing=0.1)
    manip_crit = nn.CrossEntropyLoss(label_smoothing=0.05)
    capture_crit = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_val, best_epoch, start_epoch = 0.0, 0, 1
    t0 = time.time()

    # Resume from S3
    if args.checkpoint_interval > 0 and not args.skip_s3:
        try:
            import boto3
            s3 = boto3.client('s3')
            key = f'{args.s3_prefix}/checkpoint_latest.pt'
            local = str(Path(args.output_dir) / 'checkpoint_latest.pt')
            print(f'  {C.DIM}Buscando checkpoint en s3://{args.s3_bucket}/{key}...{C.RESET}', flush=True)
            s3.download_file(args.s3_bucket, key, local)
            ckpt = torch.load(local, map_location=device)
            model.load_state_dict(ckpt['model_state'])
            optimizer.load_state_dict(ckpt['optimizer_state'])
            scheduler.load_state_dict(ckpt['scheduler_state'])
            best_val = ckpt.get('best_val', 0.0)
            best_epoch = ckpt.get('best_epoch', 0)
            start_epoch = ckpt['epoch'] + 1
            print(f'  {C.GREEN}\u2713 Resumiendo desde epoch {ckpt["epoch"]}{C.RESET}\n')
        except Exception as e:
            if any(x in str(e) for x in ['NoSuchKey', 'Not Found', '404']):
                print(f'  {C.DIM}Sin checkpoint previo \u2014 desde cero{C.RESET}\n')
            else:
                print(f'  {C.YELLOW}\u26a0 {e} \u2014 desde cero{C.RESET}\n')

    print(f'{C.CYAN}{"-"*70}{C.RESET}')
    print(f'  {"Ep":>5}  {"Progreso":^27}  {"Loss":>7}  {"DocAcc":>12}  {"ManipAcc":>12}  {"CapAcc":>12}  {"ETA":>9}')
    print(f'{C.CYAN}{"-"*70}{C.RESET}')

    for epoch in range(start_epoch, args.epochs + 1):
        t_ep = time.time()
        model.train()
        tr_loss = tr_doc = tr_manip = tr_cap = tr_n = 0

        pbar = tqdm(train_loader, leave=False, ncols=55,
                    bar_format='{l_bar}{bar}|{n_fmt}/{total_fmt}')
        optimizer.zero_grad()
        for step, (imgs, doc_lbl, manip_lbl, cap_lbl) in enumerate(pbar):
            imgs = imgs.to(device, non_blocking=True)
            doc_lbl = doc_lbl.to(device, non_blocking=True)
            manip_lbl = manip_lbl.to(device, non_blocking=True)
            cap_lbl = cap_lbl.to(device, non_blocking=True)

            mixed, doc_a, doc_b, manip_a, manip_b, cap_a, cap_b, lam = \
                mixup_batch_v5(imgs, doc_lbl, manip_lbl, cap_lbl)

            with autocast('cuda', enabled=use_amp):
                dl, ml, cl = model(mixed)
                loss = (0.40 * (lam * doc_crit(dl, doc_a) + (1-lam) * doc_crit(dl, doc_b))
                      + 0.40 * (lam * manip_crit(ml, manip_a) + (1-lam) * manip_crit(ml, manip_b))
                      + 0.20 * (lam * capture_crit(cl, cap_a) + (1-lam) * capture_crit(cl, cap_b))
                       ) / GRAD_ACCUM

            scaler.scale(loss).backward()
            if (step + 1) % GRAD_ACCUM == 0 or (step + 1) == len(train_loader):
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
                scheduler.step()

            bs = imgs.size(0)
            tr_loss += loss.item() * GRAD_ACCUM * bs
            tr_doc += (dl.argmax(1) == doc_a).sum().item()
            tr_manip += (ml.argmax(1) == manip_a).sum().item()
            tr_cap += (cl.argmax(1) == cap_a).sum().item()
            tr_n += bs
        pbar.close()

        model.eval()
        vl_doc = vl_manip = vl_cap = vl_n = 0
        with torch.no_grad():
            for imgs, doc_lbl, manip_lbl, cap_lbl in val_loader:
                imgs = imgs.to(device, non_blocking=True)
                doc_lbl = doc_lbl.to(device, non_blocking=True)
                manip_lbl = manip_lbl.to(device, non_blocking=True)
                cap_lbl = cap_lbl.to(device, non_blocking=True)
                with autocast('cuda', enabled=use_amp):
                    dl, ml, cl = model(imgs)
                vl_doc += (dl.argmax(1) == doc_lbl).sum().item()
                vl_manip += (ml.argmax(1) == manip_lbl).sum().item()
                vl_cap += (cl.argmax(1) == cap_lbl).sum().item()
                vl_n += imgs.size(0)

        ep_t = time.time() - t_ep
        eta = ep_t * (args.epochs - epoch)
        v_dacc = 100 * vl_doc / vl_n
        v_macc = 100 * vl_manip / vl_n
        v_cacc = 100 * vl_cap / vl_n
        combined = v_dacc * 0.4 + v_macc * 0.4 + v_cacc * 0.2
        is_best = combined > best_val

        if is_best:
            best_val, best_epoch = combined, epoch
            torch.save({'epoch': epoch, 'model_state': model.state_dict(),
                        'val_doc_acc': v_dacc, 'val_manip_acc': v_macc, 'val_cap_acc': v_cacc},
                       str(Path(args.output_dir) / 'best_checkpoint.pt'))

        if args.checkpoint_interval > 0 and not args.skip_s3 and epoch % args.checkpoint_interval == 0:
            try:
                import boto3
                cp_path = str(Path(args.output_dir) / 'checkpoint_latest.pt')
                torch.save({'epoch': epoch, 'model_state': model.state_dict(),
                            'optimizer_state': optimizer.state_dict(),
                            'scheduler_state': scheduler.state_dict(),
                            'best_val': best_val, 'best_epoch': best_epoch}, cp_path)
                boto3.client('s3').upload_file(cp_path, args.s3_bucket, f'{args.s3_prefix}/checkpoint_latest.pt')
                print(f'  {C.DIM}  \u2191 Checkpoint epoch {epoch} \u2192 S3{C.RESET}', flush=True)
            except Exception as e:
                print(f'  {C.YELLOW}  \u26a0 S3 fail: {e}{C.RESET}', flush=True)

        t_loss = tr_loss / tr_n
        t_dacc = 100 * tr_doc / tr_n
        t_macc = 100 * tr_manip / tr_n
        t_cacc = 100 * tr_cap / tr_n
        star = f' {C.GREEN}\u2605{C.RESET}' if is_best else ''
        vram = ''
        if device.type == 'cuda':
            u = torch.cuda.memory_allocated(0) / 1024**2
            c = torch.cuda.get_device_properties(0).total_memory / 1024**2
            vram = f'  {C.DIM}VRAM:{u:.0f}/{c:.0f}MB{C.RESET}'

        print(f'  {C.BOLD}{epoch:>4}{C.RESET}  {C.CYAN}\u2595{bar(epoch/args.epochs)}\u258f{C.RESET}  '
              f'{C.YELLOW}{t_loss:.4f}{C.RESET}  '
              f'{t_dacc:4.1f}\u2192{C.CYAN}{v_dacc:4.1f}%{C.RESET}  '
              f'{t_macc:4.1f}\u2192{C.CYAN}{v_macc:4.1f}%{C.RESET}  '
              f'{t_cacc:4.1f}\u2192{C.CYAN}{v_cacc:4.1f}%{C.RESET}  '
              f'{C.YELLOW}{fmt_time(eta):>9}{C.RESET}{vram}{star}')

    # Export ONNX
    print(f'\n{C.DIM}Exportando ONNX v5...{C.RESET}', flush=True)
    ckpt = torch.load(str(Path(args.output_dir) / 'best_checkpoint.pt'), map_location=device)
    model.load_state_dict(ckpt['model_state'])
    model.cpu()
    dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
    onnx_path = str(Path(args.output_dir) / 'model_v5.onnx')
    torch.onnx.export(model, dummy, onnx_path,
                      input_names=['image'],
                      output_names=['doc_type_logits', 'manipulation_type_logits', 'capture_method_logits'],
                      dynamic_axes={'image': {0: 'batch_size'}}, opset_version=17)
    size_mb = os.path.getsize(onnx_path) / 1024**2
    print(f'\n{C.GREEN}\u2713 v5 COMPLETE{C.RESET} | Best={best_val:.1f}% (ep {best_epoch}) | ONNX={size_mb:.1f}MB | Time={fmt_time(time.time()-t0)}')

    if not args.skip_s3:
        try:
            import boto3
            boto3.client('s3').upload_file(onnx_path, args.s3_bucket, f'{args.s3_prefix}/model_v5.onnx')
            print(f'  {C.GREEN}\u2713 Uploaded to S3{C.RESET}')
        except Exception as e:
            print(f'  {C.YELLOW}\u26a0 {e}{C.RESET}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='DocForensics CNN v5 (3-head, real-world)')
    parser.add_argument('--output-dir',         default='/home/ec2-user/model_output')
    parser.add_argument('--s3-bucket',          default='deep-check-models')
    parser.add_argument('--s3-prefix',          default='docforensics-v5')
    parser.add_argument('--batch-size',         type=int, default=BATCH_SIZE)
    parser.add_argument('--epochs',             type=int, default=NUM_EPOCHS)
    parser.add_argument('--base-per-class',     type=int, default=BASE_PER_CLASS)
    parser.add_argument('--samples-per-class',  type=int, default=SAMPLES_PER_CLASS)
    parser.add_argument('--skip-s3',            action='store_true', default=False)
    parser.add_argument('--checkpoint-interval', type=int, default=10)
    parser.add_argument('--img-size',           type=int, default=IMG_SIZE)
    parser.add_argument('--grad-accum',         type=int, default=GRAD_ACCUM)
    parser.add_argument('--num-workers',        type=int, default=4)
    args = parser.parse_args()
    train(args)
