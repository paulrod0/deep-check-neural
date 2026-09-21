#!/usr/bin/env python3
"""
prepare_pixel_data.py — Prepara datos para EfficientNet-B4 en EC2
=================================================================
Fuentes:
  1. wiki_crop_extract/  → caras reales Wikipedia/IMDB (~62k)
  2. data/frames/        → real + fake ya extraídos (~4k)
  3. HuggingFace: assassinwizz/deepfake-face-detection-dataset (~10k)
  4. HuggingFace: pujanpaudel/deepfake-face-image-detection (~si está disponible)

Salida organizada en:
  /data/pixel_dataset/
    train/real/  train/fake/
    val/real/    val/fake/
    test/real/   test/fake/

Uso:
  python prepare_pixel_data.py [--kaggle-user X --kaggle-key Y]
"""

import os
import sys
import json
import shutil
import random
import argparse
from pathlib import Path
from PIL import Image
import numpy as np

BASE    = Path('/home/ec2-user/data')
OUT_DIR = Path('/data/pixel_dataset')

IMG_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}


def safe_copy(src: Path, dst: Path):
    """Copia solo si la imagen es válida."""
    try:
        with Image.open(src) as img:
            img.verify()
        shutil.copy2(str(src), str(dst))
        return True
    except Exception:
        return False


def collect_images(dirs: list) -> list:
    """Recopila paths de imágenes de una lista de directorios."""
    paths = []
    for d in dirs:
        p = Path(d)
        if p.exists():
            found = [f for f in p.rglob('*') if f.suffix.lower() in IMG_EXTS]
            paths.extend(found)
            print(f"  {p}: {len(found):,} imágenes")
    return paths


def split_and_copy(paths: list, out_base: Path, label: str,
                   val_ratio=0.1, test_ratio=0.05):
    """Divide en train/val/test y copia al directorio de salida."""
    random.shuffle(paths)
    n = len(paths)
    n_test = int(n * test_ratio)
    n_val  = int(n * val_ratio)
    splits = {
        'test':  paths[:n_test],
        'val':   paths[n_test:n_test + n_val],
        'train': paths[n_test + n_val:],
    }
    counts = {}
    for split_name, split_paths in splits.items():
        dst_dir = out_base / split_name / label
        dst_dir.mkdir(parents=True, exist_ok=True)
        ok = sum(1 for p in split_paths if safe_copy(p, dst_dir / p.name))
        counts[split_name] = ok
    return counts


def download_hf_dataset(dataset_name: str, out_real: Path, out_fake: Path, max_samples=15000):
    """Descarga dataset HF y guarda imágenes por clase."""
    try:
        from datasets import load_dataset
        print(f"\nDescargando HF: {dataset_name}...")
        ds = load_dataset(dataset_name, split='train', trust_remote_code=False)
        print(f"  {len(ds)} muestras | columnas: {list(ds.features.keys())}")

        # Detectar columnas de imagen y label
        img_cols   = [c for c in ds.features if 'image' in c.lower() or 'img' in c.lower()]
        label_cols = [c for c in ds.features if 'label' in c.lower() or 'class' in c.lower()]

        if not img_cols or not label_cols:
            print(f"  No se encontraron columnas imagen/label: {ds.features}")
            return 0, 0

        img_col   = img_cols[0]
        label_col = label_cols[0]
        print(f"  Usando img_col='{img_col}', label_col='{label_col}'")

        # Detectar valores de fake
        sample_labels = ds.select(range(min(50, len(ds))))[label_col]
        unique_labels = set(sample_labels)
        print(f"  Labels únicos: {unique_labels}")

        # Heurística: fake = label distinto a 0/'real'/'REAL'/'genuine'
        real_vals = {0, '0', 'real', 'REAL', 'genuine', 'original', 'Real', 'Original'}
        def is_fake(label): return str(label).lower() not in {str(v).lower() for v in real_vals}

        out_real.mkdir(parents=True, exist_ok=True)
        out_fake.mkdir(parents=True, exist_ok=True)

        n_real = n_fake = 0
        for i, sample in enumerate(ds):
            if i >= max_samples:
                break
            label = sample[label_col]
            img   = sample[img_col]
            if img is None:
                continue

            # Convertir PIL Image a JPEG en disco
            fname = f"hf_{i:06d}.jpg"
            try:
                if not isinstance(img, Image.Image):
                    img = Image.fromarray(np.array(img))
                img = img.convert('RGB')
                # Resize si necesario (mínimo 100px)
                if min(img.size) < 50:
                    continue
                if is_fake(label):
                    img.save(out_fake / fname, 'JPEG', quality=90)
                    n_fake += 1
                else:
                    img.save(out_real / fname, 'JPEG', quality=90)
                    n_real += 1
            except Exception:
                continue

            if (i + 1) % 1000 == 0:
                print(f"  Procesado {i+1}/{min(max_samples, len(ds))}: {n_real} real, {n_fake} fake",
                      flush=True)

        return n_real, n_fake

    except ImportError:
        print("  datasets no instalado"); return 0, 0
    except Exception as e:
        print(f"  Error HF: {e}"); return 0, 0


def setup_kaggle(username: str, key: str):
    kaggle_dir = Path.home() / '.kaggle'
    kaggle_dir.mkdir(exist_ok=True)
    creds = kaggle_dir / 'kaggle.json'
    creds.write_text(json.dumps({'username': username, 'key': key}))
    creds.chmod(0o600)
    print(f"Kaggle credentials guardadas para: {username}")


def download_kaggle_140k():
    """Descarga el dataset 140k de Kaggle si están configuradas las credenciales."""
    kaggle_dir = Path('/data/kaggle_140k')
    if (kaggle_dir / 'real_vs_fake').exists():
        print("  140k ya descargado")
        return True
    kaggle_dir.mkdir(parents=True, exist_ok=True)
    try:
        import subprocess
        r = subprocess.run(
            [sys.executable, '-m', 'kaggle', 'datasets', 'download',
             '-d', 'xhlulu/140k-real-and-fake-faces', '-p', str(kaggle_dir), '--unzip'],
            capture_output=False, timeout=600
        )
        return r.returncode == 0
    except Exception as e:
        print(f"  Kaggle download error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kaggle-user', default='')
    parser.add_argument('--kaggle-key',  default='')
    parser.add_argument('--skip-hf',     action='store_true')
    args = parser.parse_args()

    random.seed(42)

    # Configurar Kaggle si se proporcionaron credenciales
    if args.kaggle_user and args.kaggle_key:
        setup_kaggle(args.kaggle_user, args.kaggle_key)
        print("\nDescargando 140k dataset de Kaggle...")
        success = download_kaggle_140k()
        if success:
            print("  140k descargado correctamente")
            print("  Usa directamente /data/kaggle_140k/ como datos — tiene splits train/valid/test")
            print("  Lanza: python train_pixel_ec2.py")
            return  # El 140k ya viene con splits → usar directamente

    # ── Paso 1: Recopilar datos disponibles ───────────────────────────────────
    print("\n=== Recopilando datos disponibles ===\n")
    print("Caras REALES:")
    real_src = collect_images([
        str(BASE / 'wiki_crop_extract'),
        str(BASE / 'frames' / 'real'),
    ])
    print(f"  Total real: {len(real_src):,}")

    print("\nCaras FAKE:")
    fake_src = collect_images([
        str(BASE / 'frames' / 'fake'),
    ])
    print(f"  Total fake: {len(fake_src):,}")

    # ── Paso 2: Descargar HF datasets ──────────────────────────────────────────
    if not args.skip_hf:
        hf_real_dir = Path('/data/hf_faces/real')
        hf_fake_dir = Path('/data/hf_faces/fake')

        # Dataset 1: deepfake-face-detection (10k imágenes)
        n_r, n_f = download_hf_dataset(
            'assassinwizz/deepfake-face-detection-dataset',
            hf_real_dir, hf_fake_dir, max_samples=10000
        )
        print(f"  HF dataset 1: {n_r} real + {n_f} fake")
        real_src.extend(list(hf_real_dir.rglob('*.jpg')))
        fake_src.extend(list(hf_fake_dir.rglob('*.jpg')))

        # Dataset 2: intento adicional
        hf_real2 = Path('/data/hf_faces2/real')
        hf_fake2 = Path('/data/hf_faces2/fake')
        n_r2, n_f2 = download_hf_dataset(
            'pujanpaudel/deepfake-face-image-detection',
            hf_real2, hf_fake2, max_samples=5000
        )
        print(f"  HF dataset 2: {n_r2} real + {n_f2} fake")
        real_src.extend(list(hf_real2.rglob('*.jpg')))
        fake_src.extend(list(hf_fake2.rglob('*.jpg')))

    # ── Paso 3: Balancear y crear splits ──────────────────────────────────────
    n_real = len(real_src)
    n_fake = len(fake_src)
    print(f"\n=== Total disponible: {n_real:,} real + {n_fake:,} fake ===")

    if n_fake < 500:
        print("\nATENCION: Muy pocas caras fake. El entrenamiento no sera optimo.")
        print("Por favor proporciona credenciales de Kaggle para descargar el dataset 140k:")
        print("  python prepare_pixel_data.py --kaggle-user TU_USUARIO --kaggle-key TU_KEY")
        if n_fake < 100:
            print("ERROR: No hay suficientes datos fake para entrenar. Abortando.")
            sys.exit(1)

    # Si hay muchas más reales que fakes, balancea (max 5:1)
    max_real = min(n_real, n_fake * 5)
    if n_real > max_real:
        print(f"  Subsampling real: {n_real:,} → {max_real:,} (ratio 5:1 máx)")
        real_src = random.sample(real_src, max_real)

    # ── Paso 4: Crear splits ──────────────────────────────────────────────────
    print(f"\nCreando splits en {OUT_DIR}...")
    for d in ['train', 'val', 'test']:
        for l in ['real', 'fake']:
            (OUT_DIR / d / l).mkdir(parents=True, exist_ok=True)

    print("Copiando REAL...")
    real_counts = split_and_copy(real_src, OUT_DIR, 'real')
    print("Copiando FAKE...")
    fake_counts = split_and_copy(fake_src, OUT_DIR, 'fake')

    # ── Paso 5: Resumen ───────────────────────────────────────────────────────
    print("\n=== DATASET LISTO ===")
    for split in ['train', 'val', 'test']:
        r = real_counts.get(split, 0)
        f = fake_counts.get(split, 0)
        print(f"  {split:5s}: {r:6,} real + {f:6,} fake = {r+f:,}")

    print(f"\n  Directorio: {OUT_DIR}")
    print(f"\nLanzar entrenamiento:")
    print(f"  BASE_140K={OUT_DIR} python train_pixel_ec2.py")

    # Escribir paths para que train_pixel_ec2.py los use
    config = {
        'base_path': str(OUT_DIR),
        'train_real': str(OUT_DIR / 'train' / 'real'),
        'train_fake': str(OUT_DIR / 'train' / 'fake'),
        'val_real':   str(OUT_DIR / 'val'   / 'real'),
        'val_fake':   str(OUT_DIR / 'val'   / 'fake'),
        'test_real':  str(OUT_DIR / 'test'  / 'real'),
        'test_fake':  str(OUT_DIR / 'test'  / 'fake'),
        'counts': {
            'train_real': real_counts.get('train', 0),
            'train_fake': fake_counts.get('train', 0),
        }
    }
    Path('/data/pixel_dataset_config.json').write_text(json.dumps(config, indent=2))
    print(f"  Config: /data/pixel_dataset_config.json")


if __name__ == '__main__':
    main()
