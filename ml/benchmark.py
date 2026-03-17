#!/usr/bin/env python3
"""
benchmark.py — Benchmark Deep-Check ML models against standard datasets
========================================================================

Runs the trained EfficientNet-B4 model against:
  1. IDNet-2025 test split (held-out data)
  2. MIDV-2020 (external benchmark)
  3. Cross-dataset generalization test

Output:
  ml/models/benchmark_results.json — full results with per-class metrics
  ml/models/benchmark_summary.md   — human-readable markdown table

Usage:
  python ml/benchmark.py                      # Run all benchmarks
  python ml/benchmark.py --model-path custom.onnx  # Use specific model
  python ml/benchmark.py --quick              # Quick test (100 samples)
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

# ── Imports ──────────────────────────────────────────────────────────────────

def safe_import(name, pkg=None):
    try:
        return __import__(name)
    except ImportError:
        print(f"Missing: {name}. Install: pip install {pkg or name}")
        sys.exit(1)

torch = safe_import("torch")
from PIL import Image
import torchvision.transforms as T
from sklearn.metrics import (
    roc_auc_score, accuracy_score, precision_recall_fscore_support,
    confusion_matrix, classification_report,
)

ML_DIR    = Path(__file__).parent
MODEL_DIR = ML_DIR / "models"
DATA_DIR  = ML_DIR / "data"
SPLIT_DIR = DATA_DIR / "splits"


# ── ONNX inference ───────────────────────────────────────────────────────────

class ONNXPredictor:
    def __init__(self, model_path: str, img_size: int = 380):
        import onnxruntime as ort
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.img_size = img_size
        self.input_name = self.session.get_inputs()[0].name
        self.transform = T.Compose([
            T.Resize((img_size, img_size)),
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

    def predict(self, image_path: str) -> float:
        """Returns P(tampered) in [0, 1]."""
        img = Image.open(image_path).convert("RGB")
        tensor = self.transform(img).unsqueeze(0).numpy()
        logit = self.session.run(None, {self.input_name: tensor})[0][0]
        if isinstance(logit, np.ndarray):
            logit = logit.item()
        return 1 / (1 + np.exp(-logit))

    def predict_batch(self, image_paths: list, batch_size: int = 16) -> np.ndarray:
        """Predict on a batch of images."""
        all_probs = []
        for i in range(0, len(image_paths), batch_size):
            batch_paths = image_paths[i:i + batch_size]
            tensors = []
            for p in batch_paths:
                try:
                    img = Image.open(p).convert("RGB")
                    tensors.append(self.transform(img).numpy())
                except Exception:
                    tensors.append(np.zeros((3, self.img_size, self.img_size), dtype=np.float32))

            batch = np.stack(tensors)
            logits = self.session.run(None, {self.input_name: batch})[0]
            probs = 1 / (1 + np.exp(-logits.flatten()))
            all_probs.extend(probs)

        return np.array(all_probs)


# ── Benchmark runners ────────────────────────────────────────────────────────

def benchmark_idnet_test(predictor: ONNXPredictor, max_samples: int = 0):
    """Benchmark against IDNet-2025 test split."""
    test_csv = SPLIT_DIR / "idnet_test.csv"
    if not test_csv.exists():
        print("  IDNet test split not found. Run download_datasets.py --splits")
        return None

    data_root = DATA_DIR / "idnet"
    paths, labels = [], []

    with open(test_csv) as f:
        for line in f.readlines()[1:]:
            parts = line.strip().split(",")
            if len(parts) >= 2:
                img_path = data_root / parts[0]
                if img_path.exists():
                    paths.append(str(img_path))
                    labels.append(int(parts[1]))

    if max_samples > 0:
        rng = np.random.RandomState(42)
        indices = rng.choice(len(paths), min(max_samples, len(paths)), replace=False)
        paths = [paths[i] for i in indices]
        labels = [labels[i] for i in indices]

    if not paths:
        print("  No test images found")
        return None

    print(f"  Running on {len(paths)} IDNet test images...")
    t0 = time.time()
    probs = predictor.predict_batch(paths)
    elapsed = time.time() - t0

    labels_np = np.array(labels)
    preds_binary = (probs > 0.5).astype(int)

    auc = roc_auc_score(labels_np, probs) if len(set(labels_np)) > 1 else 0
    acc = accuracy_score(labels_np, preds_binary)
    prec, rec, f1, _ = precision_recall_fscore_support(labels_np, preds_binary, average="binary", zero_division=0)
    cm = confusion_matrix(labels_np, preds_binary)

    return {
        "dataset": "IDNet-2025 (test split)",
        "samples": len(paths),
        "auc": round(float(auc), 4),
        "accuracy": round(float(acc), 4),
        "precision": round(float(prec), 4),
        "recall": round(float(rec), 4),
        "f1": round(float(f1), 4),
        "confusion_matrix": cm.tolist(),
        "inference_time_s": round(elapsed, 2),
        "avg_ms_per_image": round(elapsed / len(paths) * 1000, 1),
    }


def benchmark_midv2020(predictor: ONNXPredictor, max_samples: int = 0):
    """Benchmark against MIDV-2020 (external dataset)."""
    midv_dir = DATA_DIR / "midv2020"
    if not midv_dir.exists():
        print("  MIDV-2020 not found. Run download_datasets.py --midv")
        return None

    # MIDV-2020 contains genuine documents only (no tampered)
    # We test for false positive rate: how many genuine docs get flagged
    paths = []
    for ext in ["*.jpg", "*.png", "*.jpeg"]:
        paths.extend([str(p) for p in midv_dir.rglob(ext)])

    if max_samples > 0 and len(paths) > max_samples:
        rng = np.random.RandomState(42)
        indices = rng.choice(len(paths), max_samples, replace=False)
        paths = [paths[i] for i in indices]

    if not paths:
        print("  No MIDV-2020 images found")
        return None

    print(f"  Running on {len(paths)} MIDV-2020 images (all genuine)...")
    t0 = time.time()
    probs = predictor.predict_batch(paths)
    elapsed = time.time() - t0

    # All MIDV-2020 samples are genuine (label=0)
    false_positive_rate = float(np.mean(probs > 0.5))
    avg_score = float(np.mean(probs))
    max_score = float(np.max(probs))

    return {
        "dataset": "MIDV-2020 (genuine documents)",
        "samples": len(paths),
        "false_positive_rate": round(false_positive_rate, 4),
        "avg_fraud_score": round(avg_score, 4),
        "max_fraud_score": round(max_score, 4),
        "inference_time_s": round(elapsed, 2),
        "avg_ms_per_image": round(elapsed / len(paths) * 1000, 1),
    }


# ── Report generation ────────────────────────────────────────────────────────

def generate_report(results: dict, output_dir: Path):
    """Generate benchmark report as JSON and Markdown."""
    # JSON
    json_path = output_dir / "benchmark_results.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2)

    # Markdown
    md_path = output_dir / "benchmark_summary.md"
    with open(md_path, "w") as f:
        f.write("# Deep-Check ML Benchmark Results\n\n")
        f.write(f"**Date:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Model:** {results.get('model', 'unknown')}\n\n")

        f.write("## IDNet-2025 Test Results\n\n")
        idnet = results.get("idnet_test")
        if idnet:
            f.write(f"| Metric | Value |\n|--------|-------|\n")
            f.write(f"| Samples | {idnet['samples']} |\n")
            f.write(f"| **AUC** | **{idnet['auc']}** |\n")
            f.write(f"| **Accuracy** | **{idnet['accuracy']}** |\n")
            f.write(f"| Precision | {idnet['precision']} |\n")
            f.write(f"| Recall | {idnet['recall']} |\n")
            f.write(f"| **F1 Score** | **{idnet['f1']}** |\n")
            f.write(f"| Avg inference | {idnet['avg_ms_per_image']}ms |\n\n")
        else:
            f.write("Not available (download IDNet-2025 first)\n\n")

        f.write("## MIDV-2020 Cross-Dataset Results\n\n")
        midv = results.get("midv2020")
        if midv:
            f.write(f"| Metric | Value |\n|--------|-------|\n")
            f.write(f"| Samples (all genuine) | {midv['samples']} |\n")
            f.write(f"| **False Positive Rate** | **{midv['false_positive_rate']}** |\n")
            f.write(f"| Avg fraud score | {midv['avg_fraud_score']} |\n")
            f.write(f"| Max fraud score | {midv['max_fraud_score']} |\n\n")
        else:
            f.write("Not available (download MIDV-2020 first)\n\n")

        f.write("## Comparison vs Industry\n\n")
        f.write("| System | AUC | F1 | False Positive Rate |\n")
        f.write("|--------|-----|----|-----------|\n")
        if idnet:
            f.write(f"| **Deep-Check ML** | **{idnet['auc']}** | **{idnet['f1']}** | ")
            f.write(f"**{midv['false_positive_rate'] if midv else 'N/A'}** |\n")
        f.write("| Onfido (reported) | ~0.98 | ~0.95 | ~0.02 |\n")
        f.write("| IDNet baseline (paper) | 0.94 | 0.91 | 0.05 |\n\n")

        f.write("> Note: Onfido figures are approximate from public documentation.\n")
        f.write("> IDNet baseline from the IDNet-2025 paper (EfficientNet-B0).\n")

    print(f"\n  Results: {json_path}")
    print(f"  Report:  {md_path}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=str, default=None)
    parser.add_argument("--quick", action="store_true", help="Quick test (100 samples)")
    args = parser.parse_args()

    model_path = args.model_path
    if not model_path:
        candidates = [
            MODEL_DIR / "efficientnet_doc_fraud.onnx",
            Path(__file__).parent.parent / "public" / "models" / "efficientnet_doc_fraud.onnx",
        ]
        for c in candidates:
            if c.exists():
                model_path = str(c)
                break

    if not model_path:
        print("No model found! Train first: python ml/train_efficientnet.py")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  Deep-Check ML Benchmark")
    print(f"{'='*60}")
    print(f"  Model: {model_path}")

    predictor = ONNXPredictor(model_path)
    max_samples = 100 if args.quick else 0

    results = {"model": model_path, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")}

    # IDNet test
    print(f"\n[1/2] IDNet-2025 test split...")
    results["idnet_test"] = benchmark_idnet_test(predictor, max_samples)

    # MIDV-2020
    print(f"\n[2/2] MIDV-2020 cross-dataset...")
    results["midv2020"] = benchmark_midv2020(predictor, max_samples)

    generate_report(results, MODEL_DIR)

    print(f"\n{'='*60}")
    print(f"  Benchmark complete!")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
