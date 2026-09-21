#!/usr/bin/env python3
"""
download_datasets.py — Download all datasets for Deep-Check ML training
=======================================================================

Datasets downloaded:
  1. IDNet-2025       — 837K synthetic ID images (20 countries), genuine + tampered
  2. MIDV-2020        — 72K annotated identity document images (benchmark)
  3. Passport-Dataset  — 100K+ synthetic passports from 100+ countries

Usage:
  python ml/download_datasets.py --all               # Download everything
  python ml/download_datasets.py --idnet             # Just IDNet-2025
  python ml/download_datasets.py --idnet --subset 10  # 10% of IDNet (fast test)

Output: ml/data/{idnet,midv2020,passports}/
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import List

import numpy as np

DATA_DIR = Path(__file__).parent / "data"


def ensure_hf_hub():
    """Ensure huggingface_hub is installed."""
    try:
        import huggingface_hub
        return huggingface_hub
    except ImportError:
        print("[*] Installing huggingface_hub...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface-hub", "datasets"])
        import huggingface_hub
        return huggingface_hub


def download_idnet(subset_pct: int = 100):
    """
    Download IDNet-2025 from HuggingFace.
    Full dataset: ~490GB. We download EU countries only by default.
    """
    hf = ensure_hf_hub()

    out_dir = DATA_DIR / "idnet"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print("  IDNet-2025 — Synthetic Identity Documents (EU)")
    print(f"{'='*60}")
    print(f"  Source: https://huggingface.co/datasets/cactuslab/IDNet-2025")
    print(f"  Output: {out_dir}")
    print(f"  Subset: {subset_pct}%")
    print()

    eu_locations = ["DEU", "ESP", "FRA", "GBR", "ITA", "NLD", "POL", "PRT", "ROU", "SWE"]

    if subset_pct < 100:
        n_locs = max(1, len(eu_locations) * subset_pct // 100)
        selected = ["ESP"] + [loc for loc in eu_locations if loc != "ESP"][:n_locs - 1]
        print(f"  Selected locations ({n_locs}): {selected}")
    else:
        selected = eu_locations

    repo_id = "cactuslab/IDNet-2025"

    try:
        from datasets import load_dataset

        print(f"\n[1/2] Downloading IDNet-2025 metadata...")

        manifest = {
            "repo_id": repo_id,
            "locations": selected,
            "subset_pct": subset_pct,
            "status": "pending",
        }

        manifest_path = out_dir / "manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        print(f"\n[2/2] Downloading location archives...")

        for loc in selected:
            loc_dir = out_dir / loc
            if loc_dir.exists() and any(loc_dir.iterdir()):
                print(f"  ✓ {loc} already exists, skipping")
                continue

            loc_dir.mkdir(exist_ok=True)

            try:
                print(f"  ↓ Downloading {loc}...")
                hf.hf_hub_download(
                    repo_id=repo_id,
                    filename=f"{loc}.tar.gz",
                    local_dir=str(out_dir),
                    repo_type="dataset",
                )
                print(f"  ✓ {loc} downloaded")

                # Extract
                tar_path = out_dir / f"{loc}.tar.gz"
                if tar_path.exists():
                    print(f"    Extracting {loc}...")
                    subprocess.run(
                        ["tar", "xzf", str(tar_path), "-C", str(loc_dir)],
                        check=True
                    )
                    tar_path.unlink()
                    print(f"    ✓ {loc} extracted")

            except Exception as e:
                print(f"  ✗ {loc} failed: {e}")
                try:
                    ds = load_dataset(repo_id, split=loc, streaming=True)
                    count = 0
                    for sample in ds:
                        if subset_pct < 100 and count > 1000:
                            break
                        img = sample.get("image")
                        label = sample.get("label", "unknown")
                        if img:
                            img_dir = loc_dir / label
                            img_dir.mkdir(exist_ok=True)
                            img.save(str(img_dir / f"{count:06d}.jpg"))
                        count += 1
                    print(f"  ✓ {loc}: {count} images saved via streaming")
                except Exception as e2:
                    print(f"  ✗ {loc} streaming also failed: {e2}")

        manifest["status"] = "complete"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        print(f"\n✅ IDNet-2025 download complete → {out_dir}")

    except ImportError:
        print("  ⚠ datasets library not available. Install: pip install datasets")
        # Fallback: use HuggingFace CLI
        for loc in selected:
            cmd = [
                sys.executable, "-m", "huggingface_hub", "download",
                "cactuslab/IDNet-2025", f"{loc}.tar.gz",
                "--repo-type", "dataset", "--local-dir", str(out_dir),
            ]
            print(f"  Running: {' '.join(cmd)}")
            subprocess.run(cmd)


def download_midv2020():
    """Download MIDV-2020 benchmark dataset."""
    out_dir = DATA_DIR / "midv2020"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print("  MIDV-2020 — Identity Document Benchmark")
    print(f"{'='*60}")
    print(f"  Output: {out_dir}")
    print()

    urls = {
        "scans": "https://l3i-share.univ-lr.fr/MIDV2020/midv2020_scans.tar.gz",
        "photos": "https://l3i-share.univ-lr.fr/MIDV2020/midv2020_photos.tar.gz",
        "annotations": "https://l3i-share.univ-lr.fr/MIDV2020/midv2020_annotations.tar.gz",
    }

    for name, url in urls.items():
        out_file = out_dir / f"midv2020_{name}.tar.gz"
        if out_file.exists():
            print(f"  ✓ {name} already downloaded")
            continue

        print(f"  ↓ Downloading {name}...")
        try:
            subprocess.run(
                ["curl", "-L", "-o", str(out_file), url],
                check=True, timeout=600,
            )
            subprocess.run(["tar", "xzf", str(out_file), "-C", str(out_dir)], check=True)
            print(f"  ✓ {name} downloaded and extracted")
        except Exception as e:
            print(f"  ✗ {name} failed: {e}")
            print(f"    Download manually: {url}")

    print(f"\n✅ MIDV-2020 download complete → {out_dir}")


def download_passport_dataset():
    """Download synthetic passport dataset from HuggingFace."""
    ensure_hf_hub()

    out_dir = DATA_DIR / "passports"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print("  Passport Dataset — 100+ Countries")
    print(f"{'='*60}")
    print(f"  Output: {out_dir}")
    print()

    try:
        from datasets import load_dataset

        print("  Loading dataset (streaming mode)...")
        ds = load_dataset("ud-biometrics/passport-dataset", streaming=True, split="train")

        count = 0
        max_samples = 10000

        for sample in ds:
            if count >= max_samples:
                break

            img = sample.get("image")
            country = sample.get("country", "unknown")
            label = sample.get("label", "genuine")

            if img:
                country_dir = out_dir / country / label
                country_dir.mkdir(parents=True, exist_ok=True)
                img.save(str(country_dir / f"{count:06d}.jpg"))

            count += 1
            if count % 1000 == 0:
                print(f"    {count}/{max_samples} images saved...")

        print(f"\n✅ Passport dataset: {count} images → {out_dir}")

    except Exception as e:
        print(f"  ✗ Error: {e}")


def create_training_splits():
    """Scan downloaded data and create train/val/test splits as CSV manifests."""
    print(f"\n{'='*60}")
    print("  Creating Training Splits")
    print(f"{'='*60}")

    splits_dir = DATA_DIR / "splits"
    splits_dir.mkdir(exist_ok=True)

    idnet_dir = DATA_DIR / "idnet"
    if idnet_dir.exists():
        genuine: List[str] = []
        tampered: List[str] = []

        for loc_dir in sorted(idnet_dir.iterdir()):
            if not loc_dir.is_dir() or loc_dir.name.startswith("."):
                continue

            for ext in ["*.jpg", "*.png"]:
                for img_path in loc_dir.rglob(ext):
                    rel = str(img_path.relative_to(idnet_dir))
                    parent = img_path.parent.name.lower()
                    if "positive" in parent or "genuine" in parent:
                        genuine.append(rel)
                    elif "fraud" in parent or "tamper" in parent:
                        tampered.append(rel)

        print(f"  IDNet: {len(genuine)} genuine, {len(tampered)} tampered")

        if genuine or tampered:
            import random
            random.seed(42)

            all_samples = [(p, 0) for p in genuine] + [(p, 1) for p in tampered]
            random.shuffle(all_samples)

            n = len(all_samples)
            n_train = int(n * 0.8)
            n_val = int(n * 0.1)

            train_split = all_samples[:n_train]
            val_split = all_samples[n_train:n_train + n_val]
            test_split = all_samples[n_train + n_val:]

            for name, split in [("train", train_split), ("val", val_split), ("test", test_split)]:
                csv_path = splits_dir / f"idnet_{name}.csv"
                with open(csv_path, "w") as f:
                    f.write("path,label\n")
                    for path, label in split:
                        f.write(f"{path},{label}\n")
                print(f"    {name}: {len(split)} samples → {csv_path}")

    print(f"\n✅ Splits created → {splits_dir}")


def main():
    parser = argparse.ArgumentParser(description="Download datasets for Deep-Check ML")
    parser.add_argument("--all", action="store_true", help="Download all datasets")
    parser.add_argument("--idnet", action="store_true", help="Download IDNet-2025")
    parser.add_argument("--midv", action="store_true", help="Download MIDV-2020")
    parser.add_argument("--passports", action="store_true", help="Download passport dataset")
    parser.add_argument("--splits", action="store_true", help="Create training splits")
    parser.add_argument("--subset", type=int, default=100, help="Percentage subset (default: 100)")

    args = parser.parse_args()

    if not any([args.all, args.idnet, args.midv, args.passports, args.splits]):
        parser.print_help()
        print("\n Quick start: python ml/download_datasets.py --idnet --subset 10 --splits")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Data directory: {DATA_DIR}")

    if args.all or args.idnet:
        download_idnet(subset_pct=args.subset)
    if args.all or args.midv:
        download_midv2020()
    if args.all or args.passports:
        download_passport_dataset()
    if args.all or args.splits:
        create_training_splits()

    print(f"\n{'='*60}")
    print("  Next steps:")
    print(f"{'='*60}")
    print("  1. python ml/train_efficientnet.py")
    print("  2. python ml/benchmark.py")
    print()


if __name__ == "__main__":
    main()
