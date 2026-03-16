#!/usr/bin/env python3
"""
train_docforensics.py — DocForensics CNN Training (MAX PRECISION)
==================================================================
EfficientNet-B4 backbone, two heads (doc classification + manipulation score).
Targets >90 % val-doc-acc with full GPU utilisation.

Key upgrades over baseline:
  - Backbone: EfficientNet-B4 (19 M params, 1792-d features) vs MobileNetV3-Small
  - Mixed-precision training (AMP FP16) — doubles effective batch size
  - OneCycleLR scheduler — faster convergence than cosine annealing
  - MixUp augmentation — reduces overfitting
  - Gradient clipping — stabilises large batches
  - 5 000 samples/class × 8 classes × 2 = 80 000 total images
  - 500 epochs, batch 256
"""

import os
import sys
import time
import math
import random
import argparse
import multiprocessing as mp
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.amp import GradScaler, autocast
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
from tqdm import tqdm

# ── Constants ────────────────────────────────────────────────────────────────

DOCUMENT_CLASSES = [
    'invoice', 'id_card', 'passport', 'certificate',
    'payslip', 'media_photo', 'screenshot', 'other',
]
NUM_CLASSES       = len(DOCUMENT_CLASSES)
IMG_SIZE          = 224
BATCH_SIZE        = 64     # Real batch per step (~4 GB VRAM with EfficientNet-B4 + AMP)
GRAD_ACCUM        = 4      # Accumulate 4 steps → effective batch = 64×4 = 256
NUM_EPOCHS        = 200    # Suficiente para convergencia con datos sintéticos
LR                = 1e-3
WEIGHT_DECAY      = 1e-4
BASE_PER_CLASS    = 500    # Imágenes base pre-generadas en RAM (~1.2 GB)
SAMPLES_PER_CLASS = 5000   # Tamaño efectivo por epoch (repetición + augmentation)
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


def enable_ansi_windows():
    if sys.platform == 'win32':
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)


def bar(val: float, width: int = 25) -> str:
    filled = int(val * width)
    return '█' * filled + '░' * (width - filled)


def fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f'{h}h{m:02d}m{s:02d}s'
    elif m > 0:
        return f'{m}m{s:02d}s'
    return f'{s}s'


# ── Synthetic Dataset ─────────────────────────────────────────────────────────

def _random_color(lo=180, hi=255):
    return tuple(random.randint(lo, hi) for _ in range(3))


def _make_authentic_sample(doc_class: str) -> Image.Image:
    w, h = IMG_SIZE, IMG_SIZE
    img  = Image.new('RGB', (w, h), _random_color())
    draw = ImageDraw.Draw(img)

    if doc_class in ('id_card', 'passport'):
        draw.rectangle([10, 10, w-10, h-10], outline=(50, 50, 150), width=3)
        draw.rectangle([10, 10, w-10, 50],   fill=(50, 50, 150))
        for i in range(5):
            draw.rectangle([20, 60+i*25, 180, 72+i*25], fill=(180, 180, 200))
        draw.ellipse([150, 60, 210, 120], fill=(200, 180, 160))
        # MRZ lines
        for i in range(2):
            draw.rectangle([10, h-45+i*18, w-10, h-35+i*18], fill=(210, 210, 220))
    elif doc_class == 'invoice':
        draw.rectangle([10, 10, w-10, 35], fill=(30, 100, 180))
        for i in range(9):
            y = 50 + i*18
            draw.line([15, y, w-15, y], fill=(200, 200, 200), width=1)
            draw.rectangle([15, y+2, 80, y+12],   fill=(220, 220, 220))
            draw.rectangle([130, y+2, 200, y+12], fill=(220, 220, 220))
        # Total row
        draw.rectangle([10, h-30, w-10, h-10], fill=(220, 235, 255))
    elif doc_class == 'certificate':
        draw.rectangle([5, 5, w-5, h-5],     outline=(180, 140, 20), width=4)
        draw.rectangle([15, 15, w-15, h-15], outline=(180, 140, 20), width=1)
        for i in range(3):
            draw.rectangle([30, 80+i*30, w-30, 95+i*30], fill=(200, 200, 200))
        # Seal
        draw.ellipse([w//2-25, h-60, w//2+25, h-10], outline=(180, 140, 20), width=2)
    elif doc_class == 'payslip':
        draw.rectangle([10, 10, w-10, 40], fill=(0, 120, 60))
        for i in range(6):
            y = 55 + i*22
            draw.rectangle([15, y, 100, y+12],  fill=(220, 220, 220))
            draw.rectangle([150, y, 205, y+12], fill=(220, 220, 220))
        # Net pay highlight
        draw.rectangle([10, h-35, w-10, h-10], fill=(200, 240, 210))
    elif doc_class == 'media_photo':
        # Sky gradient
        for row in range(h//2):
            t = row / (h//2)
            r = int(135 + t*120); g = int(206 + t*49); b = 235
            draw.line([(0, row), (w, row)], fill=(r, g, b))
        # Ground
        draw.rectangle([0, h//2, w, h], fill=(34, 139, 34))
        # Objects
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
        # Scrollbar
        draw.rectangle([w-12, 48, w, h], fill=(220, 220, 220))
        draw.rectangle([w-11, 80, w-1, 130], fill=(150, 150, 150))
    else:  # other
        for _ in range(6):
            x1 = random.randint(0, w-50); y1 = random.randint(0, h-20)
            draw.rectangle([x1, y1, x1+random.randint(40,120), y1+random.randint(8,18)],
                           fill=_random_color(180, 230))

    # Ruido consistente por toda la imagen (firma de sensor/escáner auténtico)
    arr = np.array(img).astype(np.float32)
    noise_sigma = random.uniform(2, 8)
    arr += np.random.normal(0, noise_sigma, arr.shape)
    arr  = np.clip(arr, 0, 255).astype(np.uint8)
    img  = Image.fromarray(arr)
    img  = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0, 0.8)))
    # Random brightness/contrast
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.82, 1.18))
    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.82, 1.18))
    # Compression JPEG uniforme (sin artefactos diferenciales)
    from io import BytesIO
    buf = BytesIO()
    img.save(buf, 'JPEG', quality=random.randint(75, 95))
    buf.seek(0)
    img = Image.open(buf).copy()
    return img


def _make_manipulated_sample(doc_class: str) -> Image.Image:
    img  = _make_authentic_sample(doc_class)
    w, h = img.size
    kind = random.choice([
        # Original
        'copy_paste', 'text_replace', 'color_shift',
        'splice', 'resize_artifact', 'double_compress', 'clone_stamp',
        # New: advanced manipulations
        'ai_checkerboard', 'deepfake_blend', 'inpainting_fill',
        'steganography_lsb', 'rotation_copy', 'frequency_tamper',
        'histogram_splice', 'selective_recolor', 'localized_noise_wipe',
    ])

    from io import BytesIO

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
            draw.rectangle([x, y, x+random.randint(40,80), y+random.randint(10,20)],
                           fill=(255, 255, 255))
            draw.rectangle([x+2, y+2, x+random.randint(35,75), y+random.randint(8,16)],
                           fill=_random_color(190, 220))

    elif kind == 'color_shift':
        arr = np.array(img).astype(np.float32)
        ch  = random.randint(0, 2)
        x1, y1 = random.randint(0, w//2), random.randint(0, h//2)
        bw = random.randint(30, 80); bh = random.randint(30, 60)
        arr[y1:y1+bh, x1:x1+bw, ch] = np.clip(
            arr[y1:y1+bh, x1:x1+bw, ch] + random.uniform(25, 90), 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))

    elif kind == 'splice':
        other    = _make_authentic_sample(random.choice(DOCUMENT_CLASSES))
        splice_h = random.randint(h//5, 4*h//5)
        result   = Image.new('RGB', (w, h))
        result.paste(img.crop((0, 0, w, splice_h)),   (0, 0))
        result.paste(other.crop((0, splice_h, w, h)), (0, splice_h))
        draw = ImageDraw.Draw(result)
        draw.line([(0, splice_h), (w, splice_h)], fill=(200, 200, 200), width=1)
        img = result

    elif kind == 'resize_artifact':
        factor = random.choice([2, 3, 4])
        img = img.resize((w//factor, h//factor), Image.NEAREST)
        img = img.resize((w, h), Image.BILINEAR)

    elif kind == 'double_compress':
        buf = BytesIO()
        img.save(buf, 'JPEG', quality=random.randint(30, 60))
        buf.seek(0); img = Image.open(buf).copy()
        buf2 = BytesIO()
        img.save(buf2, 'JPEG', quality=random.randint(50, 80))
        buf2.seek(0); img = Image.open(buf2).copy()

    elif kind == 'clone_stamp':
        arr = np.array(img)
        for _ in range(random.randint(2, 5)):
            sx, sy = random.randint(0, w-40), random.randint(0, h-30)
            dx, dy = random.randint(0, w-40), random.randint(0, h-30)
            patch  = arr[sy:sy+30, sx:sx+40].copy()
            arr[dy:dy+30, dx:dx+40] = patch
        img = Image.fromarray(arr)

    elif kind == 'ai_checkerboard':
        # Simula artefactos de upsampling con transposed convolutions (GANs)
        arr = np.array(img).astype(np.float32)
        x1 = random.randint(0, w*2//3); y1 = random.randint(0, h*2//3)
        bw = random.randint(40, 90);    bh = random.randint(40, 90)
        strength = random.uniform(10, 30)
        for dy in range(min(bh, h - y1)):
            for dx in range(min(bw, w - x1)):
                sign = 1 if (dx + dy) % 2 == 0 else -1
                arr[y1+dy, x1+dx] = np.clip(arr[y1+dy, x1+dx] + sign * strength, 0, 255)
        # Also add slight overall frequency anomaly (unnaturally sharp edges)
        region_img = Image.fromarray(arr[y1:y1+bh, x1:x1+bw].astype(np.uint8))
        region_img = region_img.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN)
        arr[y1:y1+bh, x1:x1+bw] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))

    elif kind == 'deepfake_blend':
        # Simula blending artifact de face-swap: región con estadísticas distintas y seam visible
        arr = np.array(img).astype(np.float32)
        x1 = random.randint(w//5, w//2); y1 = random.randint(h//5, h//2)
        bw = random.randint(35, 75);     bh = random.randint(35, 75)
        x2 = min(x1+bw, w);             y2 = min(y1+bh, h)
        # Color mismatch (como si viniese de otra cámara/iluminación)
        shift = np.array([random.uniform(-40, 40)] * 3)
        arr[y1:y2, x1:x2] = np.clip(arr[y1:y2, x1:x2] + shift, 0, 255)
        # Noise level distinto en la región (diferente sensor)
        arr[y1:y2, x1:x2] += np.random.normal(0, random.uniform(4, 12), arr[y1:y2, x1:x2].shape)
        arr = np.clip(arr, 0, 255)
        # Seam borroso en el borde (blending mask incompleto)
        seam_w = 2
        arr[y1:y2, x1:x1+seam_w] = (arr[y1:y2, x1:x1+seam_w] * 0.5 +
                                      arr[y1:y2, max(x1-seam_w,0):x1] * 0.5 if x1 >= seam_w
                                      else arr[y1:y2, x1:x1+seam_w])
        img = Image.fromarray(arr.astype(np.uint8))

    elif kind == 'inpainting_fill':
        # Simula AI inpainting: región con varianza anormalmente baja (relleno generado)
        arr = np.array(img).astype(np.float32)
        x1 = random.randint(10, w//2); y1 = random.randint(10, h//2)
        bw = random.randint(30, 75);   bh = random.randint(20, 55)
        x2 = min(x1+bw, w);           y2 = min(y1+bh, h)
        # Rellenar con la media del borde de la región + ruido mínimo (demasiado liso)
        border = np.concatenate([
            arr[max(y1-3,0):y1, x1:x2].reshape(-1, 3),
            arr[y2:min(y2+3,h), x1:x2].reshape(-1, 3),
            arr[y1:y2, max(x1-3,0):x1].reshape(-1, 3),
            arr[y1:y2, x2:min(x2+3,w)].reshape(-1, 3),
        ], axis=0) if (y1 > 2 or y2 < h-2) else arr[y1:y2, x1:x2].reshape(-1, 3)
        mean_color = border.mean(axis=0) if len(border) > 0 else arr[y1:y2, x1:x2].mean(axis=(0,1))
        fill = np.ones((y2-y1, x2-x1, 3)) * mean_color
        fill += np.random.normal(0, 2.0, fill.shape)   # varianza anormalmente baja
        arr[y1:y2, x1:x2] = np.clip(fill, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))

    elif kind == 'steganography_lsb':
        # Simula esteganografía LSB: bits menos significativos con patrón pseudo-aleatorio
        arr = np.array(img).copy()
        x1 = random.randint(0, w//2); y1 = random.randint(0, h//2)
        bw = random.randint(50, w - x1); bh = random.randint(50, h - y1)
        x2 = min(x1+bw, w);             y2 = min(y1+bh, h)
        region = arr[y1:y2, x1:x2].copy()
        seed = random.randint(0, 65535)
        rng  = np.random.RandomState(seed)
        # Modifica los 2 LSB con datos "ocultos" pseudo-aleatorios
        noise_bits = rng.randint(0, 4, region.shape, dtype=np.uint8)
        arr[y1:y2, x1:x2] = (region & np.uint8(0xFC)) | noise_bits
        img = Image.fromarray(arr)

    elif kind == 'rotation_copy':
        # Copy-move con rotación (no detectado por hash simple)
        sx = random.randint(0, w//2); sy = random.randint(0, h//2)
        bw = random.randint(30, 55);  bh = random.randint(30, 55)
        patch = img.crop((sx, sy, sx+bw, sy+bh))
        angle = random.choice([15, 30, 45, 90, 135, 180, 270])
        patch = patch.rotate(angle, expand=False)
        # Aplicar leve blur en bordes del patch para simular blending
        patch = patch.filter(ImageFilter.SMOOTH)
        dx = random.randint(0, max(1, w-bw)); dy = random.randint(0, max(1, h-bh))
        img.paste(patch, (dx, dy))

    elif kind == 'frequency_tamper':
        # Simula sharpening/deblurring localizado (deja firma en ELA)
        arr = np.array(img).astype(np.float32)
        x1 = random.randint(0, w//2); y1 = random.randint(0, h//2)
        bw = random.randint(40, 100); bh = random.randint(40, 80)
        x2 = min(x1+bw, w);          y2 = min(y1+bh, h)
        region_img = Image.fromarray(arr[y1:y2, x1:x2].astype(np.uint8))
        # Aplicar sharpening fuerte en la región (contrasta con el resto)
        for _ in range(random.randint(2, 4)):
            region_img = region_img.filter(ImageFilter.UnsharpMask(
                radius=random.uniform(1, 3),
                percent=random.randint(100, 250),
                threshold=1
            ))
        arr[y1:y2, x1:x2] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))

    elif kind == 'histogram_splice':
        # Splice con histogram matching (difícil de detectar visualmente)
        other = _make_authentic_sample(random.choice(DOCUMENT_CLASSES))
        arr_orig  = np.array(img).astype(np.float32)
        arr_other = np.array(other).astype(np.float32)
        # Ajustar histograma del otro doc para que se parezca al original
        for ch in range(3):
            mu_orig  = arr_orig[:, :, ch].mean();  std_orig  = arr_orig[:, :, ch].std() + 1e-6
            mu_other = arr_other[:, :, ch].mean(); std_other = arr_other[:, :, ch].std() + 1e-6
            arr_other[:, :, ch] = (arr_other[:, :, ch] - mu_other) / std_other * std_orig + mu_orig
        arr_other = np.clip(arr_other, 0, 255).astype(np.uint8)
        # Splice horizontal en punto aleatorio
        cut = random.randint(h//4, 3*h//4)
        result = np.concatenate([arr_orig[:cut].astype(np.uint8), arr_other[cut:]], axis=0)
        img = Image.fromarray(result)

    elif kind == 'selective_recolor':
        # Recoloración selectiva de zona (como editar un campo de color en un doc)
        arr  = np.array(img).astype(np.float32)
        x1 = random.randint(0, w//2); y1 = random.randint(0, h//2)
        bw = random.randint(25, 80);  bh = random.randint(15, 50)
        x2 = min(x1+bw, w);          y2 = min(y1+bh, h)
        # Reemplazar los 3 canales con colores completamente distintos
        new_color = np.array([random.randint(20, 240), random.randint(20, 240), random.randint(20, 240)])
        arr[y1:y2, x1:x2] = new_color + np.random.normal(0, 5, arr[y1:y2, x1:x2].shape)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    else:  # localized_noise_wipe
        # Elimina el ruido natural de una zona (como haría un tool de edición AI)
        arr  = np.array(img).astype(np.float32)
        x1 = random.randint(0, w//2); y1 = random.randint(0, h//2)
        bw = random.randint(30, 90);  bh = random.randint(20, 70)
        x2 = min(x1+bw, w);          y2 = min(y1+bh, h)
        # Aplicar blur fuerte para eliminar el ruido natural (deja zona demasiado lisa)
        region_img = Image.fromarray(arr[y1:y2, x1:x2].astype(np.uint8))
        for _ in range(random.randint(3, 6)):
            region_img = region_img.filter(ImageFilter.GaussianBlur(radius=random.uniform(1.5, 4)))
        arr[y1:y2, x1:x2] = np.array(region_img).astype(np.float32)
        img = Image.fromarray(arr.astype(np.uint8))

    return img


# ── Worker (module-level so threading can call it) ────────────────────────────

def _gen_one(args):
    doc_class, is_manip = args
    img = _make_manipulated_sample(doc_class) if is_manip else _make_authentic_sample(doc_class)
    return np.array(img.resize((IMG_SIZE, IMG_SIZE)), dtype=np.uint8)


class DocForensicsDataset(Dataset):
    """
    Pre-generates BASE_PER_CLASS images per class at init using ThreadPoolExecutor
    (avoids Windows spawn overhead). Stores as uint8 numpy (~1.2 GB for 8k images).
    Each epoch cycles through the pool with fresh augmentation → infinite diversity.
    """

    def __init__(self, base_per_class: int = BASE_PER_CLASS,
                 samples_per_class: int = SAMPLES_PER_CLASS, train: bool = True):

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

        # Build task list
        tasks, self.cls_lbl, self.mnp_lbl = [], [], []
        for class_idx, doc_class in enumerate(DOCUMENT_CLASSES):
            for _ in range(base_per_class):
                tasks.append((doc_class, 0)); self.cls_lbl.append(class_idx); self.mnp_lbl.append(0.0)
            for _ in range(base_per_class):
                tasks.append((doc_class, 1)); self.cls_lbl.append(class_idx); self.mnp_lbl.append(1.0)

        # Generate using threads (PIL is I/O-friendly; avoids Windows spawn overhead)
        from concurrent.futures import ThreadPoolExecutor
        nthreads = min(os.cpu_count() or 1, 8)
        print(f'  Pre-generando {len(tasks):,} imágenes base con {nthreads} threads...', flush=True)
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=nthreads) as ex:
            imgs = list(tqdm(ex.map(_gen_one, tasks), total=len(tasks), ncols=60,
                             bar_format='  {l_bar}{bar}|{n_fmt}/{total_fmt} [{elapsed}]'))
        elapsed = time.time() - t0

        self.images = np.stack(imgs)   # (N, IMG_SIZE, IMG_SIZE, 3) uint8
        base_n = len(tasks)
        print(f'  {C.GREEN}✓{C.RESET} {base_n:,} imgs en RAM '
              f'({self.images.nbytes/1024**3:.2f} GB) en {fmt_time(elapsed)}')

        # Epoch index: cycle base pool to reach samples_per_class entries
        repeats = math.ceil((samples_per_class * NUM_CLASSES * 2) / base_n)
        pool_idx = list(range(base_n)) * repeats
        random.shuffle(pool_idx)
        self.epoch_idx = pool_idx[:samples_per_class * NUM_CLASSES * 2]

    def __len__(self):
        return len(self.epoch_idx)

    def __getitem__(self, idx):
        i = self.epoch_idx[idx]
        return self.transform(Image.fromarray(self.images[i])), self.cls_lbl[i], self.mnp_lbl[i]


# ── MixUp ────────────────────────────────────────────────────────────────────

def mixup_batch(imgs, doc_labels, manip_labels, alpha=MIXUP_ALPHA):
    if alpha <= 0:
        return imgs, doc_labels, manip_labels, doc_labels, manip_labels, 1.0
    lam = np.random.beta(alpha, alpha)
    bs  = imgs.size(0)
    idx = torch.randperm(bs, device=imgs.device)
    mixed_imgs        = lam * imgs + (1 - lam) * imgs[idx]
    doc_labels_b      = doc_labels[idx]
    manip_labels_b    = manip_labels[idx]
    return mixed_imgs, doc_labels, doc_labels_b, manip_labels, manip_labels_b, lam


# ── Model ─────────────────────────────────────────────────────────────────────

class DocForensicsCNN(nn.Module):
    def __init__(self, num_classes: int = NUM_CLASSES):
        super().__init__()
        backbone      = models.efficientnet_b4(weights=models.EfficientNet_B4_Weights.IMAGENET1K_V1)
        self.features = backbone.features
        self.avgpool  = backbone.avgpool
        feat_dim      = 1792  # EfficientNet-B4 output features

        self.doc_head = nn.Sequential(
            nn.Dropout(0.4),
            nn.Linear(feat_dim, 512),
            nn.SiLU(),
            nn.Dropout(0.3),
            nn.Linear(512, num_classes),
        )
        self.manip_head = nn.Sequential(
            nn.Dropout(0.4),
            nn.Linear(feat_dim, 256),
            nn.SiLU(),
            nn.Dropout(0.2),
            nn.Linear(256, 1),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.avgpool(x)
        x = x.flatten(1)
        return self.doc_head(x), self.manip_head(x).squeeze(1)


# ── Training ──────────────────────────────────────────────────────────────────

def train(args):
    # Override global constants from CLI args
    global IMG_SIZE, GRAD_ACCUM
    IMG_SIZE   = args.img_size
    GRAD_ACCUM = args.grad_accum

    enable_ansi_windows()
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    os.makedirs(args.output_dir, exist_ok=True)
    use_amp = device.type == 'cuda'
    scaler  = GradScaler('cuda', enabled=use_amp)
    # Liberar memoria de sesiones previas
    if device.type == 'cuda':
        torch.cuda.empty_cache()
        os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')

    # Header
    print(f'\n{C.CYAN}{"═"*70}{C.RESET}')
    print(f'{C.BOLD}{C.WHITE}   DocForensics CNN — MAX PRECISION TRAINING{C.RESET}')
    print(f'{C.CYAN}{"═"*70}{C.RESET}')
    print(f'  {C.YELLOW}Backbone     :{C.RESET} EfficientNet-B4  (19M params, 1792-d features)')
    print(f'  {C.YELLOW}Dispositivo  :{C.RESET} ', end='')
    if device.type == 'cuda':
        props = torch.cuda.get_device_properties(0)
        vram  = props.total_memory / 1024**3
        print(f'{C.GREEN}GPU{C.RESET} — {C.MAGENTA}{props.name}{C.RESET}  {C.CYAN}{vram:.1f} GB VRAM{C.RESET}  AMP FP16: {C.GREEN}ON{C.RESET}')
    else:
        print(f'{C.YELLOW}CPU{C.RESET}  (AMP: OFF)')
    total_samples = args.samples_per_class * NUM_CLASSES * 2
    print(f'  {C.YELLOW}Epochs       :{C.RESET} {args.epochs}')
    print(f'  {C.YELLOW}Samples      :{C.RESET} {args.samples_per_class}/clase × {NUM_CLASSES} clases × 2 = {C.WHITE}{total_samples:,}{C.RESET} imágenes')
    print(f'  {C.YELLOW}Img size     :{C.RESET} {IMG_SIZE}×{IMG_SIZE}')
    print(f'  {C.YELLOW}Batch size   :{C.RESET} {args.batch_size} real × {GRAD_ACCUM} acum = {args.batch_size*GRAD_ACCUM} efectivo  (MixUp α={MIXUP_ALPHA})')
    print(f'  {C.YELLOW}Scheduler    :{C.RESET} OneCycleLR  (max_lr={LR}, warmup 5%)')
    print(f'  {C.YELLOW}Output       :{C.RESET} {args.output_dir}')
    print(f'{C.CYAN}{"─"*70}{C.RESET}\n')

    # Dataset
    print(f'  {C.DIM}Generando {total_samples:,} imágenes sintéticas...{C.RESET}', flush=True)
    train_ds = DocForensicsDataset(base_per_class=args.base_per_class,
                                   samples_per_class=args.samples_per_class, train=True)
    val_ds   = DocForensicsDataset(base_per_class=max(100, args.base_per_class // 5),
                                   samples_per_class=max(100, args.samples_per_class // 5), train=False)
    nw = min(args.num_workers, os.cpu_count() or 1)
    pin = device.type == 'cuda'
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=nw, pin_memory=pin, persistent_workers=nw > 0)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False,
                              num_workers=nw, pin_memory=pin, persistent_workers=nw > 0)
    print(f'  {C.GREEN}✓{C.RESET} Dataset — {C.WHITE}{len(train_ds):,}{C.RESET} train | {C.WHITE}{len(val_ds):,}{C.RESET} val\n')

    # Model
    print(f'  {C.DIM}Cargando EfficientNet-B4 (pretrained ImageNet)...{C.RESET}', flush=True)
    model     = DocForensicsCNN().to(device)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f'  {C.GREEN}✓{C.RESET} Modelo — {C.WHITE}{trainable:,}{C.RESET} parámetros entrenables\n')

    optimizer = optim.AdamW(model.parameters(), lr=LR / 25, weight_decay=WEIGHT_DECAY)
    steps_per_epoch = len(train_loader)
    scheduler = optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=LR,
        epochs=args.epochs,
        steps_per_epoch=steps_per_epoch,
        pct_start=0.05,
        anneal_strategy='cos',
    )
    doc_crit   = nn.CrossEntropyLoss(label_smoothing=0.1)
    manip_crit = nn.BCEWithLogitsLoss()

    best_val   = 0.0
    best_epoch = 0
    start_epoch = 1
    t0         = time.time()

    # ── Resume from S3 checkpoint ──────────────────────────────────────────────
    if args.checkpoint_interval > 0 and not args.skip_s3:
        try:
            import boto3
            s3 = boto3.client('s3')
            resume_key = f'{args.s3_prefix}/checkpoint_latest.pt'
            local_resume = str(Path(args.output_dir) / 'checkpoint_latest.pt')
            print(f'  {C.DIM}Buscando checkpoint en s3://{args.s3_bucket}/{resume_key}...{C.RESET}', flush=True)
            s3.download_file(args.s3_bucket, resume_key, local_resume)
            ckpt_r = torch.load(local_resume, map_location=device)
            model.load_state_dict(ckpt_r['model_state'])
            optimizer.load_state_dict(ckpt_r['optimizer_state'])
            scheduler.load_state_dict(ckpt_r['scheduler_state'])
            best_val    = ckpt_r.get('best_val', 0.0)
            best_epoch  = ckpt_r.get('best_epoch', 0)
            start_epoch = ckpt_r['epoch'] + 1
            print(f'  {C.GREEN}✓ Resumiendo desde epoch {ckpt_r["epoch"]} (mejor val_acc={best_val:.1f}%){C.RESET}\n')
        except Exception as e:
            if 'NoSuchKey' in str(e) or 'Not Found' in str(e) or '404' in str(e):
                print(f'  {C.DIM}No hay checkpoint previo — entrenamiento desde cero{C.RESET}\n', flush=True)
            else:
                print(f'  {C.YELLOW}⚠ No se pudo cargar checkpoint ({e}) — empezando de cero{C.RESET}\n', flush=True)

    print(f'{C.CYAN}{"─"*70}{C.RESET}')
    print(f'  {"Ep":>5}  {"▕Progreso▏":^27}  {"Loss":>7}  {"DocAcc":>14}  {"ManipAcc":>14}  {"LR":>8}  {"ETA":>9}')
    print(f'{C.CYAN}{"─"*70}{C.RESET}')

    for epoch in range(start_epoch, args.epochs + 1):
        t_ep = time.time()

        # ── Train ──
        model.train()
        tr_loss = tr_doc = tr_manip = tr_n = 0

        pbar = tqdm(train_loader, leave=False, ncols=55,
                    bar_format='{l_bar}{bar}|{n_fmt}/{total_fmt}')
        optimizer.zero_grad()
        for step, (imgs, doc_lbl, manip_lbl) in enumerate(pbar):
            imgs      = imgs.to(device, non_blocking=True)
            doc_lbl   = doc_lbl.to(device, non_blocking=True)
            manip_lbl = manip_lbl.to(device, non_blocking=True)

            # MixUp
            mixed, doc_a, doc_b, manip_a, manip_b, lam = mixup_batch(imgs, doc_lbl, manip_lbl)

            with autocast('cuda', enabled=use_amp):
                dl, ml = model(mixed)
                loss = (lam * doc_crit(dl, doc_a) + (1-lam) * doc_crit(dl, doc_b) +
                        0.5 * (lam * manip_crit(ml, manip_a) + (1-lam) * manip_crit(ml, manip_b)))
                loss = loss / GRAD_ACCUM  # escala para acumulación

            scaler.scale(loss).backward()

            # Actualizar solo cada GRAD_ACCUM pasos
            if (step + 1) % GRAD_ACCUM == 0 or (step + 1) == len(train_loader):
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
                scheduler.step()

            bs       = imgs.size(0)
            tr_loss  += loss.item() * GRAD_ACCUM * bs  # desescala para el log
            tr_doc   += (dl.argmax(1) == doc_a).sum().item()
            tr_manip += ((ml.sigmoid() > 0.5).float() == manip_a).sum().item()
            tr_n     += bs
        pbar.close()

        # ── Validate ──
        model.eval()
        vl_doc = vl_manip = vl_n = 0
        with torch.no_grad():
            for imgs, doc_lbl, manip_lbl in val_loader:
                imgs      = imgs.to(device, non_blocking=True)
                doc_lbl   = doc_lbl.to(device, non_blocking=True)
                manip_lbl = manip_lbl.to(device, non_blocking=True)
                with autocast('cuda', enabled=use_amp):
                    dl, ml = model(imgs)
                vl_doc   += (dl.argmax(1) == doc_lbl).sum().item()
                vl_manip += ((ml.sigmoid() > 0.5).float() == manip_lbl).sum().item()
                vl_n     += imgs.size(0)

        ep_t   = time.time() - t_ep
        eta    = ep_t * (args.epochs - epoch)
        t_loss = tr_loss / tr_n
        t_dacc = 100 * tr_doc   / tr_n
        t_macc = 100 * tr_manip / tr_n
        v_dacc = 100 * vl_doc   / vl_n
        v_macc = 100 * vl_manip / vl_n
        lr_now = scheduler.get_last_lr()[0]
        is_best = v_dacc > best_val

        if is_best:
            best_val   = v_dacc
            best_epoch = epoch
            torch.save({'epoch': epoch, 'model_state': model.state_dict(), 'val_doc_acc': v_dacc},
                       str(Path(args.output_dir) / 'best_checkpoint.pt'))

        # ── Periodic S3 checkpoint (resume support) ───────────────────────────
        if args.checkpoint_interval > 0 and not args.skip_s3 and epoch % args.checkpoint_interval == 0:
            try:
                import boto3
                latest_path = str(Path(args.output_dir) / 'checkpoint_latest.pt')
                torch.save({
                    'epoch':           epoch,
                    'model_state':     model.state_dict(),
                    'optimizer_state': optimizer.state_dict(),
                    'scheduler_state': scheduler.state_dict(),
                    'best_val':        best_val,
                    'best_epoch':      best_epoch,
                }, latest_path)
                s3c = boto3.client('s3')
                key = f'{args.s3_prefix}/checkpoint_latest.pt'
                s3c.upload_file(latest_path, args.s3_bucket, key)
                print(f'  {C.DIM}  ↑ Checkpoint epoch {epoch} guardado en s3://{args.s3_bucket}/{key}{C.RESET}', flush=True)
            except Exception as e:
                print(f'  {C.YELLOW}  ⚠ No se pudo subir checkpoint a S3: {e}{C.RESET}', flush=True)

        pct  = epoch / args.epochs
        pb   = bar(pct)
        star = f' {C.GREEN}★ MEJOR{C.RESET}' if is_best else ''

        vram_str = ''
        if device.type == 'cuda':
            used = torch.cuda.memory_allocated(0) / 1024**2
            cap  = torch.cuda.get_device_properties(0).total_memory / 1024**2
            pct_vram = used / cap
            vram_str = f'  {C.DIM}VRAM:{used:.0f}/{cap:.0f}MB({pct_vram*100:.0f}%){C.RESET}'

        print(
            f'  {C.BOLD}{epoch:>4}{C.RESET}  '
            f'{C.CYAN}▕{pb}▏{C.RESET}  '
            f'{C.YELLOW}{t_loss:.4f}{C.RESET}  '
            f'{C.GREEN}{t_dacc:5.1f}%{C.RESET}{C.DIM}→{C.RESET}{C.CYAN}{v_dacc:5.1f}%{C.RESET}  '
            f'{C.GREEN}{t_macc:5.1f}%{C.RESET}{C.DIM}→{C.RESET}{C.CYAN}{v_macc:5.1f}%{C.RESET}  '
            f'{lr_now:.1e}  '
            f'{C.YELLOW}{fmt_time(eta):>9}{C.RESET}'
            f'{vram_str}{star}'
        )

    # ── Export ONNX ──
    print(f'\n{C.CYAN}{"─"*70}{C.RESET}')
    print(f'  {C.DIM}Cargando mejor checkpoint y exportando ONNX...{C.RESET}', flush=True)
    ckpt = torch.load(str(Path(args.output_dir) / 'best_checkpoint.pt'), map_location=device)
    model.load_state_dict(ckpt['model_state'])
    model.eval()
    dummy     = torch.randn(1, 3, IMG_SIZE, IMG_SIZE).to(device)
    onnx_path = str(Path(args.output_dir) / 'model.onnx')
    torch.onnx.export(
        model.cpu(), dummy.cpu(), onnx_path,
        input_names=['image'],
        output_names=['doc_type_logits', 'manipulation_logit'],
        dynamic_axes={'image': {0: 'batch_size'}},
        opset_version=17,
    )
    size_mb = os.path.getsize(onnx_path) / 1024**2
    total_t = time.time() - t0

    print(f'\n{C.CYAN}{"═"*70}{C.RESET}')
    print(f'{C.BOLD}{C.GREEN}  ✓ ENTRENAMIENTO COMPLETADO{C.RESET}')
    print(f'{C.CYAN}{"─"*70}{C.RESET}')
    print(f'  {C.YELLOW}Mejor doc acc (val) :{C.RESET}  {C.GREEN}{best_val:.2f}%{C.RESET}  (epoch {best_epoch})')
    print(f'  {C.YELLOW}Modelo ONNX         :{C.RESET}  {C.WHITE}{onnx_path}{C.RESET}  ({size_mb:.1f} MB)')
    print(f'  {C.YELLOW}Tiempo total        :{C.RESET}  {C.WHITE}{fmt_time(total_t)}{C.RESET}')
    print(f'{C.CYAN}{"═"*70}{C.RESET}\n')

    if not args.skip_s3:
        try:
            import boto3
            s3  = boto3.client('s3')
            key = f'{args.s3_prefix}/model.onnx'
            print(f'  {C.DIM}Subiendo a s3://{args.s3_bucket}/{key}...{C.RESET}', flush=True)
            s3.upload_file(onnx_path, args.s3_bucket, key)
            print(f'  {C.GREEN}✓ Subido a S3{C.RESET}\n')
        except Exception as e:
            print(f'  {C.YELLOW}⚠ S3 no disponible ({e}) — modelo guardado localmente{C.RESET}\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Train DocForensics CNN (MAX PRECISION)')
    parser.add_argument('--output-dir',        default=r'C:\Users\pablo\model_output')
    parser.add_argument('--s3-bucket',         default='deep-check-models')
    parser.add_argument('--s3-prefix',         default='docforensics')
    parser.add_argument('--batch-size',        type=int, default=BATCH_SIZE)
    parser.add_argument('--epochs',            type=int, default=NUM_EPOCHS)
    parser.add_argument('--base-per-class',    type=int, default=BASE_PER_CLASS)
    parser.add_argument('--samples-per-class', type=int, default=SAMPLES_PER_CLASS)
    parser.add_argument('--skip-s3',            action='store_true', default=False)
    parser.add_argument('--checkpoint-interval', type=int, default=10,
                        help='Guardar checkpoint a S3 cada N epochs (0 = desactivado)')
    parser.add_argument('--img-size',   type=int, default=IMG_SIZE,
                        help='Resolución de entrada (224 = default, 380 = EfficientNet-B4 native)')
    parser.add_argument('--grad-accum', type=int, default=GRAD_ACCUM,
                        help='Pasos de acumulación de gradiente (1 = sin acumulación)')
    parser.add_argument('--num-workers', type=int, default=4,
                        help='DataLoader workers (4 para Windows, 8 para EC2)')
    args = parser.parse_args()
    train(args)
