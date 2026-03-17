#!/usr/bin/env python3
"""
Deep_Check_Train_Colab.py — One-click training in Google Colab
================================================================

Copy-paste this into a Colab notebook cell to train the full pipeline:

  !git clone https://github.com/YOUR_REPO/deep-check.git
  %cd deep-check
  !pip install -r ml/requirements.txt
  !python ml/Deep_Check_Train_Colab.py

Or run each step manually:

  Step 1: Download datasets (10% subset for fast test)
  !python ml/download_datasets.py --idnet --subset 10 --splits

  Step 2: Train EfficientNet-B4
  !python ml/train_efficientnet.py --epochs 25 --batch-size 32

  Step 3: Run benchmarks
  !python ml/benchmark.py

  Step 4: Download the trained model
  from google.colab import files
  files.download('ml/models/efficientnet_doc_fraud.onnx')
  files.download('ml/models/training_metrics.json')
"""

import subprocess
import sys
from pathlib import Path

ML_DIR = Path(__file__).parent


def run(cmd: str):
    print(f"\n{'='*60}")
    print(f"  $ {cmd}")
    print(f"{'='*60}\n")
    subprocess.check_call(cmd.split(), cwd=str(ML_DIR.parent))


def main():
    # Check GPU
    try:
        import torch
        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0)
            mem = torch.cuda.get_device_properties(0).total_mem / (1024**3)
            print(f"GPU: {gpu} ({mem:.1f} GB)")
        else:
            print("WARNING: No GPU detected. Training will be slow.")
            print("In Colab: Runtime -> Change runtime type -> GPU")
    except ImportError:
        pass

    # Step 1: Install deps
    print("\n[1/4] Installing dependencies...")
    run(f"{sys.executable} -m pip install -r ml/requirements.txt")

    # Step 2: Download datasets
    # Start with 20% subset (Spain + 1 other EU country) for fast iteration
    # Increase to 100% for production training
    print("\n[2/4] Downloading IDNet-2025 (EU subset)...")
    run(f"{sys.executable} ml/download_datasets.py --idnet --passports --subset 20 --splits")

    # Step 3: Train
    print("\n[3/4] Training EfficientNet-B4...")
    run(f"{sys.executable} ml/train_efficientnet.py --epochs 25 --batch-size 32 --lr 1e-4")

    # Step 4: Benchmark
    print("\n[4/4] Running benchmarks...")
    run(f"{sys.executable} ml/benchmark.py")

    # Summary
    metrics_path = ML_DIR / "models" / "training_metrics.json"
    onnx_path = ML_DIR / "models" / "efficientnet_doc_fraud.onnx"

    print(f"\n{'='*60}")
    print(f"  TRAINING COMPLETE!")
    print(f"{'='*60}")

    if onnx_path.exists():
        size_mb = onnx_path.stat().st_size / (1024 * 1024)
        print(f"  Model: {onnx_path} ({size_mb:.1f} MB)")

    if metrics_path.exists():
        import json
        with open(metrics_path) as f:
            m = json.load(f)
        print(f"  Test AUC:  {m.get('test_auc', 'N/A')}")
        print(f"  Test F1:   {m.get('test_f1', 'N/A')}")
        print(f"  Test Acc:  {m.get('test_accuracy', 'N/A')}")

    print(f"\n  Next steps:")
    print(f"  1. Copy efficientnet_doc_fraud.onnx to public/models/")
    print(f"  2. Copy training_metrics.json to public/models/efficientnet_doc_fraud_metadata.json")
    print(f"  3. Deploy: git push")
    print(f"\n  In Colab, download files:")
    print(f"    from google.colab import files")
    print(f"    files.download('{onnx_path}')")
    print(f"    files.download('{metrics_path}')")


if __name__ == "__main__":
    main()
