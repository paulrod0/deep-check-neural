#!/usr/bin/env python3
"""
download_all_datasets.py — Download ALL available document datasets
====================================================================

Downloads from multiple sources:
  1. ud-biometrics/passport-dataset — 100K+ synthetic passports
  2. ud-biometrics/Selfie-and-ID-Dataset — ID docs with labels
  3. UniDataPro/synthetic-passports — More synthetic passports
  4. cactuslab/IDNet-2025 — 837K+ synthetic identity documents (20 countries)

All images are resized to 380x380 and saved as JPG.
Tampered variants are auto-generated from genuine images.

Usage:
  python ml/download_all_datasets.py                    # Default: 500 total
  python ml/download_all_datasets.py --max-per-source 200  # 200 per source
  python ml/download_all_datasets.py --max-total 2000      # 2000 total
"""

import argparse
import os
import sys
import time
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'

try:
    from datasets import load_dataset
except ImportError:
    print("Install: pip install datasets")
    sys.exit(1)

ML_DIR = Path(__file__).parent
DATA_DIR = ML_DIR / "data" / "combined"
GENUINE_DIR = DATA_DIR / "genuine"
TAMPERED_DIR = DATA_DIR / "tampered"
SPLITS_DIR = ML_DIR / "data" / "splits"

TARGET_SIZE = (380, 380)


# ── Tamper generation ─────────────────────────────────────────────────────

def create_tampered_version(img: Image.Image) -> Image.Image:
    """Create a realistically tampered version of a document image."""
    arr = np.array(img).astype(np.float32)
    h, w = arr.shape[:2]

    # Apply 1-2 manipulations
    n_manips = np.random.choice([1, 2], p=[0.4, 0.6])

    for _ in range(n_manips):
        manip = np.random.randint(0, 8)

        # Region to manipulate
        ry = np.random.randint(10, max(11, h - 60))
        rx = np.random.randint(10, max(11, w - 60))
        rh = np.random.randint(20, min(60, h - ry))
        rw = np.random.randint(30, min(80, w - rx))

        if manip == 0:  # Color shift
            arr[ry:ry+rh, rx:rx+rw, 0] *= np.random.uniform(1.05, 1.18)
            arr[ry:ry+rh, rx:rx+rw, 2] *= np.random.uniform(0.82, 0.95)

        elif manip == 1:  # Noise injection
            noise = np.random.randn(rh, rw, 3) * np.random.uniform(8, 25)
            arr[ry:ry+rh, rx:rx+rw] += noise

        elif manip == 2:  # Brightness patch
            arr[ry:ry+rh, rx:rx+rw] *= np.random.uniform(1.08, 1.35)

        elif manip == 3:  # Copy-move
            sy = np.random.randint(0, max(1, h - rh))
            sx = np.random.randint(0, max(1, w - rw))
            arr[ry:ry+rh, rx:rx+rw] = arr[sy:sy+rh, sx:sx+rw].copy()

        elif manip == 4:  # Blur patch
            try:
                patch = Image.fromarray(np.clip(arr[ry:ry+rh, rx:rx+rw], 0, 255).astype(np.uint8))
                patch = patch.filter(ImageFilter.GaussianBlur(radius=np.random.uniform(2, 4)))
                arr[ry:ry+rh, rx:rx+rw] = np.array(patch).astype(np.float32)
            except Exception:
                arr[ry:ry+rh, rx:rx+rw] *= 0.9

        elif manip == 5:  # JPEG block artifact simulation
            block = 8
            for by in range(ry, ry + rh - block, block):
                for bx in range(rx, rx + rw - block, block):
                    mean_val = arr[by:by+block, bx:bx+block].mean(axis=(0, 1))
                    arr[by:by+block, bx:bx+block] = arr[by:by+block, bx:bx+block] * 0.85 + mean_val * 0.15

        elif manip == 6:  # Edge artifact (sharp boundary)
            border_w = 2
            arr[ry:ry+border_w, rx:rx+rw] *= 0.65
            arr[ry+rh-border_w:ry+rh, rx:rx+rw] *= 0.65
            arr[ry:ry+rh, rx:rx+border_w] *= 0.65
            arr[ry:ry+rh, rx+rw-border_w:rx+rw] *= 0.65

        else:  # Contrast mismatch
            arr[ry:ry+rh, rx:rx+rw] = (arr[ry:ry+rh, rx:rx+rw] - 128) * 1.3 + 128

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ── Download functions ────────────────────────────────────────────────────

def download_source(dataset_name, split, max_samples, source_name, start_idx):
    """Download images from a HuggingFace dataset."""
    print(f"\n  [{source_name}] Streaming {dataset_name} ({split})...")

    try:
        ds = load_dataset(dataset_name, split=split, streaming=True)
    except Exception as e:
        print(f"  [{source_name}] Failed to load: {e}")
        return 0

    count = 0
    for sample in ds:
        if count >= max_samples:
            break

        img = sample.get("image")
        label = sample.get("label", None)

        if img is None:
            continue

        try:
            img_resized = img.convert("RGB").resize(TARGET_SIZE, Image.LANCZOS)

            # Save as genuine
            idx = start_idx + count
            save_path = GENUINE_DIR / f"{source_name}_{idx:06d}.jpg"
            img_resized.save(str(save_path), quality=95)

            # Create tampered version
            tampered = create_tampered_version(img_resized)
            save_path_t = TAMPERED_DIR / f"{source_name}_{idx:06d}.jpg"
            tampered.save(str(save_path_t), quality=95)

            count += 1

            if count % 50 == 0:
                print(f"    {count}/{max_samples}...")

        except Exception as e:
            pass  # Skip problematic images

    print(f"  [{source_name}] Downloaded {count} genuine + {count} tampered")
    return count


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-per-source", type=int, default=150, help="Max images per source")
    parser.add_argument("--max-total", type=int, default=0, help="Max total images (0=unlimited)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Deep-Check — Download All Document Datasets")
    print(f"{'='*60}")
    print(f"  Max per source: {args.max_per_source}")

    GENUINE_DIR.mkdir(parents=True, exist_ok=True)
    TAMPERED_DIR.mkdir(parents=True, exist_ok=True)
    SPLITS_DIR.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    total = 0

    # Source 1: Passport dataset
    n = download_source(
        "ud-biometrics/passport-dataset", "train",
        args.max_per_source, "passport", total
    )
    total += n

    # Source 2: Selfie and ID dataset
    n = download_source(
        "ud-biometrics/Selfie-and-ID-Dataset", "train",
        args.max_per_source, "selfie_id", total
    )
    total += n

    # Source 3: UniDataPro synthetic passports
    n = download_source(
        "UniDataPro/synthetic-passports", "train",
        args.max_per_source, "unidatapro", total
    )
    total += n

    # Source 4: IDNet-2025
    print(f"\n  [idnet] Attempting IDNet-2025...")
    n = download_source(
        "cactuslab/IDNet-2025", "train",
        args.max_per_source, "idnet", total
    )
    total += n

    elapsed = time.time() - t0

    # Create train/test splits
    print(f"\n  Creating train/test splits...")
    genuine_files = sorted(GENUINE_DIR.glob("*.jpg"))
    tampered_files = sorted(TAMPERED_DIR.glob("*.jpg"))

    all_samples = []
    for f in genuine_files:
        all_samples.append((f"genuine/{f.name}", 0))
    for f in tampered_files:
        all_samples.append((f"tampered/{f.name}", 1))

    np.random.seed(42)
    np.random.shuffle(all_samples)

    n_test = max(20, len(all_samples) // 5)
    n_train = len(all_samples) - n_test

    with open(SPLITS_DIR / "combined_train.csv", "w") as f:
        f.write("path,label\n")
        for path, label in all_samples[:n_train]:
            f.write(f"{path},{label}\n")

    with open(SPLITS_DIR / "combined_test.csv", "w") as f:
        f.write("path,label\n")
        for path, label in all_samples[n_train:]:
            f.write(f"{path},{label}\n")

    # Save manifest
    manifest = {
        "total_genuine": len(genuine_files),
        "total_tampered": len(tampered_files),
        "total_samples": len(all_samples),
        "train_samples": n_train,
        "test_samples": n_test,
        "sources": ["passport-dataset", "Selfie-and-ID-Dataset", "synthetic-passports", "IDNet-2025"],
        "download_time_s": round(elapsed, 1),
        "download_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(DATA_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  DOWNLOAD COMPLETE!")
    print(f"{'='*60}")
    print(f"  Genuine:  {len(genuine_files)}")
    print(f"  Tampered: {len(tampered_files)}")
    print(f"  Total:    {len(all_samples)}")
    print(f"  Train:    {n_train}, Test: {n_test}")
    print(f"  Time:     {elapsed:.1f}s")
    print(f"  Data:     {DATA_DIR}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
