#!/usr/bin/env python3
"""
download_max_data.py — Download maximum real document images for training
=========================================================================
Downloads from WORKING HuggingFace sources (IDNet-2025 confirmed unresponsive).
Generates tampered variants and creates balanced train/test splits.

Usage:
  python3 ml/download_max_data.py
"""

import os
import sys
import time
import json
import signal
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

# ── Tamper generation (8 manipulation types) ────────────────────────────

def create_tampered_version(img: Image.Image, difficulty='mixed') -> Image.Image:
    """Create a realistically tampered version of a document image."""
    arr = np.array(img).astype(np.float32)
    h, w = arr.shape[:2]

    if difficulty == 'easy':
        n_manips = np.random.choice([2, 3])
        strength = 1.5
    elif difficulty == 'hard':
        n_manips = 1
        strength = 0.6
    else:
        n_manips = np.random.choice([1, 2, 3], p=[0.3, 0.5, 0.2])
        strength = 1.0

    for _ in range(n_manips):
        manip = np.random.randint(0, 8)

        ry = np.random.randint(10, max(11, h - 80))
        rx = np.random.randint(10, max(11, w - 80))
        rh = np.random.randint(20, min(70, h - ry))
        rw = np.random.randint(30, min(90, w - rx))

        if manip == 0:  # Color shift
            arr[ry:ry+rh, rx:rx+rw, 0] *= np.random.uniform(1.03, 1.12) * strength
            arr[ry:ry+rh, rx:rx+rw, 2] *= np.random.uniform(0.85, 0.97)

        elif manip == 1:  # Noise injection
            noise = np.random.randn(rh, rw, 3) * np.random.uniform(6, 20) * strength
            arr[ry:ry+rh, rx:rx+rw] += noise

        elif manip == 2:  # Brightness patch
            arr[ry:ry+rh, rx:rx+rw] *= np.random.uniform(1.05, 1.25) * strength

        elif manip == 3:  # Copy-move
            sy = np.random.randint(0, max(1, h - rh))
            sx = np.random.randint(0, max(1, w - rw))
            arr[ry:ry+rh, rx:rx+rw] = arr[sy:sy+rh, sx:sx+rw].copy()

        elif manip == 4:  # Blur patch
            try:
                patch = Image.fromarray(np.clip(arr[ry:ry+rh, rx:rx+rw], 0, 255).astype(np.uint8))
                radius = np.random.uniform(1.5, 3.5) * strength
                patch = patch.filter(ImageFilter.GaussianBlur(radius=radius))
                arr[ry:ry+rh, rx:rx+rw] = np.array(patch).astype(np.float32)
            except Exception:
                arr[ry:ry+rh, rx:rx+rw] *= 0.9

        elif manip == 5:  # JPEG block artifacts
            block = 8
            for by in range(ry, ry + rh - block, block):
                for bx in range(rx, rx + rw - block, block):
                    mean_val = arr[by:by+block, bx:bx+block].mean(axis=(0, 1))
                    blend = 0.15 * strength
                    arr[by:by+block, bx:bx+block] = arr[by:by+block, bx:bx+block] * (1 - blend) + mean_val * blend

        elif manip == 6:  # Edge artifact
            border_w = max(1, int(2 * strength))
            arr[ry:ry+border_w, rx:rx+rw] *= 0.65
            arr[ry+rh-border_w:ry+rh, rx:rx+rw] *= 0.65
            arr[ry:ry+rh, rx:rx+border_w] *= 0.65
            arr[ry:ry+rh, rx+rw-border_w:rx+rw] *= 0.65

        else:  # Contrast mismatch
            arr[ry:ry+rh, rx:rx+rw] = (arr[ry:ry+rh, rx:rx+rw] - 128) * (1.2 * strength) + 128

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ── Download functions ────────────────────────────────────────────────────

def download_source(dataset_name, split, max_samples, source_name, start_idx, timeout_s=120):
    """Download images from a HuggingFace dataset with timeout."""
    print(f"\n  [{source_name}] Streaming {dataset_name} ({split})... max={max_samples}")
    sys.stdout.flush()

    try:
        ds = load_dataset(dataset_name, split=split, streaming=True)
    except Exception as e:
        print(f"  [{source_name}] Failed to load: {e}")
        sys.stdout.flush()
        return 0

    count = 0
    t0 = time.time()
    stall_start = time.time()

    for sample in ds:
        if count >= max_samples:
            break

        # Timeout check
        elapsed = time.time() - t0
        if elapsed > timeout_s:
            print(f"  [{source_name}] Timeout after {elapsed:.0f}s, got {count} images")
            sys.stdout.flush()
            break

        img = sample.get("image")
        if img is None:
            continue

        try:
            img_resized = img.convert("RGB").resize(TARGET_SIZE, Image.LANCZOS)

            idx = start_idx + count

            # Save genuine
            save_path = GENUINE_DIR / f"{source_name}_{idx:06d}.jpg"
            img_resized.save(str(save_path), quality=95)

            # Create 2 tampered versions (easy + hard) for data diversity
            tampered_easy = create_tampered_version(img_resized, 'easy')
            save_easy = TAMPERED_DIR / f"{source_name}_{idx:06d}_easy.jpg"
            tampered_easy.save(str(save_easy), quality=95)

            tampered_hard = create_tampered_version(img_resized, 'hard')
            save_hard = TAMPERED_DIR / f"{source_name}_{idx:06d}_hard.jpg"
            tampered_hard.save(str(save_hard), quality=95)

            # Also a mixed version
            tampered_mixed = create_tampered_version(img_resized, 'mixed')
            save_mixed = TAMPERED_DIR / f"{source_name}_{idx:06d}.jpg"
            tampered_mixed.save(str(save_mixed), quality=95)

            count += 1
            stall_start = time.time()

            if count % 25 == 0:
                rate = count / (time.time() - t0)
                print(f"    {count}/{max_samples} ({rate:.1f} img/s)")
                sys.stdout.flush()

        except Exception:
            pass

        # Stall detection
        if time.time() - stall_start > 30:
            print(f"  [{source_name}] Stalled for 30s, stopping at {count}")
            sys.stdout.flush()
            break

    print(f"  [{source_name}] Done: {count} genuine + {count*3} tampered = {count*4} total images")
    sys.stdout.flush()
    return count


def main():
    print(f"\n{'='*60}")
    print(f"  Deep-Check — MAX DATA DOWNLOAD (Real Documents)")
    print(f"{'='*60}")

    # Clean old data
    print(f"\n  Cleaning old data...")
    for d in [GENUINE_DIR, TAMPERED_DIR]:
        if d.exists():
            for f in d.glob("*.jpg"):
                f.unlink()

    GENUINE_DIR.mkdir(parents=True, exist_ok=True)
    TAMPERED_DIR.mkdir(parents=True, exist_ok=True)
    SPLITS_DIR.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    total = 0

    # Source 1: Passport dataset (100K+ passports, ~15 via streaming before repeats)
    n = download_source(
        "ud-biometrics/passport-dataset", "train",
        500, "passport", total, timeout_s=180
    )
    total += n

    # Source 2: Selfie and ID dataset (much larger, more diverse docs)
    n = download_source(
        "ud-biometrics/Selfie-and-ID-Dataset", "train",
        500, "selfie_id", total, timeout_s=300
    )
    total += n

    # Source 3: UniDataPro synthetic passports
    n = download_source(
        "UniDataPro/synthetic-passports", "train",
        500, "unidatapro", total, timeout_s=180
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

    n_test = max(40, len(all_samples) // 5)  # 20% test
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
        "genuine_per_source_image": 1,
        "tampered_per_source_image": 3,
        "tamper_difficulties": ["easy", "hard", "mixed"],
        "sources_attempted": ["passport-dataset", "Selfie-and-ID-Dataset", "synthetic-passports"],
        "sources_failed": ["IDNet-2025 (unresponsive)"],
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
    sys.stdout.flush()


if __name__ == "__main__":
    main()
