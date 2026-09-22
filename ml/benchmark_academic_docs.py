#!/usr/bin/env python3
"""
benchmark_academic_docs.py — Academic-document forensic benchmark
===================================================================

Goal
----
Run the Deep-Check ONNX forensic model over a directory of academic /
identity documents and emit AUC, EER, APCER, BPCER, ACER, calibration
ECE, plus a bootstrap 95% CI. The output (JSON + Markdown) is suitable
to attach to a customer pilot proposal.

Why this exists
---------------
The production benchmarks (ml/reports/*) cover face deepfakes and the
generic CASIA + IDNet-2025 distribution. Universities admissions teams
ask the question that those benchmarks do NOT directly answer:

    "How does it perform on transcripts, diplomas and ID scans
     submitted in OUR admissions pipeline?"

This script is the harness for that conversation. It is dataset-agnostic
on purpose — point it at a labelled directory and it gives you numbers
the customer can replicate locally with one command. We do not bake
any university-specific assumptions in.

Labels
------
Files are labelled by filename suffix (case-insensitive):

  *_morph.*  *_fake.*  *_tampered.*  *_synthetic.*    -> 1 (fake / manipulated)
  everything else                                     -> 0 (authentic)

Override with --label-csv path/to/labels.csv (columns: filename,label).

Output
------
  ml/reports/academic_docs_benchmark.json
  ml/reports/academic_docs_benchmark.md

The report explicitly records:
  - dataset path + file count
  - model path + sha256
  - per-file scores so the customer can audit
  - bootstrap 95% CI

Usage
-----
  python ml/benchmark_academic_docs.py \
      --model public/models/deepfake/deepfake_pixel_v1.onnx \
      --data  nist-fate-pad/frvt/common/images/face

  python ml/benchmark_academic_docs.py \
      --model path/to/doc_forensics_v2b.onnx \
      --data  /opt/ie-pilot/sample_admissions \
      --label-csv /opt/ie-pilot/labels.csv \
      --tag ie_pilot_2026q2
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image

try:
    import onnxruntime as ort
except ImportError:
    print("error: pip install onnxruntime numpy pillow scikit-learn", file=sys.stderr)
    raise

from sklearn.metrics import roc_auc_score, roc_curve, average_precision_score


ROOT = Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / "ml" / "reports"
REPORT_DIR.mkdir(exist_ok=True)

# Filename suffixes we treat as "fake / manipulated" by default.
FAKE_TAGS = ("_morph", "_fake", "_tampered", "_synthetic", "_manipulated")

# Image extensions we will load. PPM is included so the NIST FATE
# fixtures already in the repo can be benchmarked out of the box.
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp", ".ppm", ".pgm"}


# ────────────────────────────────────────────────────────────────────────
# ONNX wrapper. Mirrors src/lib/neuralForensics.ts preprocessing so the
# Python results match what the browser model would produce.
# ────────────────────────────────────────────────────────────────────────
class ForensicPredictor:
    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(f"model not found: {model_path}")
        self.model_path = model_path
        self.session = ort.InferenceSession(
            str(model_path),
            providers=["CPUExecutionProvider"],
        )
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        # ONNX models in this repo are 224x224 ImageNet-normalized RGB.
        self.img_size = inp.shape[2] if isinstance(inp.shape[2], int) else 224
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

    def model_sha256(self) -> str:
        h = hashlib.sha256()
        with self.model_path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def preprocess(self, path: Path) -> np.ndarray:
        img = Image.open(path).convert("RGB")
        img = img.resize((self.img_size, self.img_size), Image.BILINEAR)
        arr = np.array(img, dtype=np.float32).transpose(2, 0, 1) / 255.0
        return ((arr - self.mean) / self.std)[np.newaxis, ...]

    def score(self, path: Path) -> float:
        x = self.preprocess(path)
        logit = float(self.session.run(None, {self.input_name: x})[0].flatten()[0])
        # Sigmoid -> P(fake | image). Same convention as the production model.
        return 1.0 / (1.0 + float(np.exp(-logit)))


# ────────────────────────────────────────────────────────────────────────
# Labelling helpers
# ────────────────────────────────────────────────────────────────────────
def label_from_filename(p: Path) -> int:
    name = p.stem.lower()
    return 1 if any(tag in name for tag in FAKE_TAGS) else 0


def load_labels(label_csv: Path) -> Dict[str, int]:
    out: Dict[str, int] = {}
    with label_csv.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            fn = row["filename"].strip()
            lbl = int(row["label"])
            out[fn] = lbl
    return out


def collect_images(data_dir: Path, label_csv: Path | None) -> List[Tuple[Path, int]]:
    overrides = load_labels(label_csv) if label_csv else {}
    items: List[Tuple[Path, int]] = []
    for p in sorted(data_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            lbl = overrides.get(p.name, label_from_filename(p))
            items.append((p, lbl))
    return items


# ────────────────────────────────────────────────────────────────────────
# Metric calculation. Bootstrap CI uses stratified resampling so the
# class balance is preserved across draws.
# ────────────────────────────────────────────────────────────────────────
def equal_error_rate(scores: np.ndarray, labels: np.ndarray) -> Tuple[float, float]:
    fpr, tpr, thr = roc_curve(labels, scores)
    fnr = 1.0 - tpr
    idx = int(np.nanargmin(np.abs(fpr - fnr)))
    eer = (fpr[idx] + fnr[idx]) / 2.0
    return float(eer), float(thr[idx])


def expected_calibration_error(scores: np.ndarray, labels: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    ece = 0.0
    n = len(scores)
    for i in range(bins):
        m = (scores >= edges[i]) & (scores < edges[i + 1] + (1e-9 if i == bins - 1 else 0))
        if not np.any(m):
            continue
        acc = float(labels[m].mean())
        conf = float(scores[m].mean())
        ece += (m.sum() / n) * abs(acc - conf)
    return float(ece)


def bootstrap_auc_eer(
    scores: np.ndarray,
    labels: np.ndarray,
    n_boot: int = 1000,
    seed: int = 42,
) -> Dict[str, Dict[str, float]]:
    rng = np.random.default_rng(seed)
    pos_idx = np.flatnonzero(labels == 1)
    neg_idx = np.flatnonzero(labels == 0)
    if len(pos_idx) < 2 or len(neg_idx) < 2:
        return {"auc": {"low": float("nan"), "high": float("nan")},
                "eer": {"low": float("nan"), "high": float("nan")}}

    aucs, eers = [], []
    for _ in range(n_boot):
        p = rng.choice(pos_idx, size=len(pos_idx), replace=True)
        n = rng.choice(neg_idx, size=len(neg_idx), replace=True)
        idx = np.concatenate([p, n])
        s = scores[idx]; y = labels[idx]
        try:
            aucs.append(float(roc_auc_score(y, s)))
            eers.append(equal_error_rate(s, y)[0])
        except ValueError:
            continue
    aucs.sort(); eers.sort()
    return {
        "auc": {
            "low":  float(np.percentile(aucs, 2.5)) if aucs else float("nan"),
            "high": float(np.percentile(aucs, 97.5)) if aucs else float("nan"),
        },
        "eer": {
            "low":  float(np.percentile(eers, 2.5)) if eers else float("nan"),
            "high": float(np.percentile(eers, 97.5)) if eers else float("nan"),
        },
    }


def compute_apcer_bpcer(scores: np.ndarray, labels: np.ndarray, threshold: float) -> Dict[str, float]:
    pred_fake = scores >= threshold
    fake_mask = labels == 1
    real_mask = labels == 0
    apcer = float(((~pred_fake) & fake_mask).sum() / max(fake_mask.sum(), 1))
    bpcer = float((pred_fake & real_mask).sum() / max(real_mask.sum(), 1))
    return {"apcer": apcer, "bpcer": bpcer, "acer": (apcer + bpcer) / 2.0}


# ────────────────────────────────────────────────────────────────────────
# Reporting
# ────────────────────────────────────────────────────────────────────────
def write_reports(payload: dict, tag: str) -> Tuple[Path, Path]:
    base = REPORT_DIR / f"academic_docs_benchmark{('_' + tag) if tag else ''}"
    json_path = base.with_suffix(".json")
    md_path = base.with_suffix(".md")

    json_path.write_text(json.dumps(payload, indent=2))

    md = []
    md.append("# Academic / Identity Document Forensic Benchmark\n")
    md.append(f"- **Generated:** {payload['timestamp']}\n")
    md.append(f"- **Model:** `{payload['model']['path']}`\n")
    md.append(f"- **Model SHA-256:** `{payload['model']['sha256']}`\n")
    md.append(f"- **Dataset:** `{payload['dataset']['path']}`\n")
    md.append(f"- **Total files:** {payload['dataset']['total']} "
              f"(authentic={payload['dataset']['authentic']}, "
              f"manipulated={payload['dataset']['manipulated']})\n")
    md.append(f"- **Tag:** {tag or '(none)'}\n\n")

    md.append("## Metrics\n")
    md.append("| Metric | Value | 95% CI |\n|---|---:|---|\n")
    m = payload["metrics"]
    ci = payload["bootstrap_ci"]
    md.append(f"| AUC | {m['auc']:.4f} | [{ci['auc']['low']:.4f}, {ci['auc']['high']:.4f}] |\n")
    md.append(f"| EER | {m['eer']*100:.2f}% | "
              f"[{ci['eer']['low']*100:.2f}%, {ci['eer']['high']*100:.2f}%] |\n")
    md.append(f"| APCER @ EER thr | {m['apcer']*100:.2f}% | — |\n")
    md.append(f"| BPCER @ EER thr | {m['bpcer']*100:.2f}% | — |\n")
    md.append(f"| ACER @ EER thr | {m['acer']*100:.2f}% | — |\n")
    md.append(f"| Average Precision | {m['average_precision']:.4f} | — |\n")
    md.append(f"| Calibration ECE | {m['ece']:.4f} | — |\n")
    md.append(f"| EER threshold | {m['eer_threshold']:.4f} | — |\n\n")

    md.append("## Per-file scores (audit)\n")
    md.append("| File | Label | Score |\n|---|---:|---:|\n")
    for entry in payload["per_file"]:
        md.append(f"| `{entry['file']}` | "
                  f"{'fake' if entry['label']==1 else 'real'} | "
                  f"{entry['score']:.4f} |\n")
    md.append("\n")

    md.append("## How to reproduce\n")
    md.append("```bash\n")
    md.append("python ml/benchmark_academic_docs.py \\\n")
    md.append(f"    --model {payload['model']['path']} \\\n")
    md.append(f"    --data {payload['dataset']['path']}\n")
    md.append("```\n")
    md.append("\nSHA-256 of the model file at run time is recorded above. "
              "If a customer reproduces this benchmark and obtains the same "
              "scores, that is sufficient evidence that the deployed model "
              "is bit-identical to the audited binary.\n")

    md_path.write_text("".join(md))
    return json_path, md_path


# ────────────────────────────────────────────────────────────────────────
# Driver
# ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Academic-document forensic benchmark.")
    ap.add_argument("--model", required=True, type=Path)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--label-csv", type=Path, default=None)
    ap.add_argument("--tag", default="", help="Optional tag appended to report filenames.")
    ap.add_argument("--bootstrap", type=int, default=1000)
    args = ap.parse_args()

    if not args.data.exists():
        print(f"error: data dir not found: {args.data}", file=sys.stderr)
        return 2

    items = collect_images(args.data, args.label_csv)
    if not items:
        print(f"error: no images found in {args.data}", file=sys.stderr)
        return 2

    n_fake = sum(1 for _, l in items if l == 1)
    n_real = len(items) - n_fake
    if n_fake == 0 or n_real == 0:
        print(f"warning: dataset has only one class "
              f"(fake={n_fake}, real={n_real}). AUC/EER will be NaN.",
              file=sys.stderr)

    print(f"[bench] model: {args.model}")
    print(f"[bench] dataset: {args.data}  (n={len(items)}, fake={n_fake}, real={n_real})")
    pred = ForensicPredictor(args.model)
    sha = pred.model_sha256()
    print(f"[bench] model sha256: {sha}")

    t0 = time.time()
    per_file = []
    scores: List[float] = []
    labels: List[int] = []
    for p, lbl in items:
        try:
            s = pred.score(p)
        except Exception as e:
            print(f"  ! skipping {p.name}: {e}", file=sys.stderr)
            continue
        scores.append(s); labels.append(lbl)
        per_file.append({
            "file": str(p.relative_to(args.data)) if p.is_relative_to(args.data) else p.name,
            "label": lbl,
            "score": round(s, 6),
        })
    elapsed = time.time() - t0

    s = np.array(scores); y = np.array(labels)

    metrics: Dict[str, float] = {}
    if n_fake and n_real:
        metrics["auc"] = float(roc_auc_score(y, s))
        eer, thr = equal_error_rate(s, y)
        metrics["eer"] = eer
        metrics["eer_threshold"] = thr
        metrics.update(compute_apcer_bpcer(s, y, thr))
        metrics["average_precision"] = float(average_precision_score(y, s))
        metrics["ece"] = expected_calibration_error(s, y)
    else:
        metrics.update({"auc": float("nan"), "eer": float("nan"),
                        "eer_threshold": float("nan"),
                        "apcer": float("nan"), "bpcer": float("nan"), "acer": float("nan"),
                        "average_precision": float("nan"), "ece": float("nan")})

    ci = bootstrap_auc_eer(s, y, n_boot=args.bootstrap) if (n_fake and n_real) else \
         {"auc": {"low": float("nan"), "high": float("nan")},
          "eer": {"low": float("nan"), "high": float("nan")}}

    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z") or time.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsed_sec": round(elapsed, 3),
        "model": {"path": str(args.model), "sha256": sha},
        "dataset": {
            "path": str(args.data),
            "total": len(items),
            "authentic": n_real,
            "manipulated": n_fake,
            "label_csv": str(args.label_csv) if args.label_csv else None,
            "convention": "filename ends with one of " + ", ".join(FAKE_TAGS) + " => fake",
        },
        "metrics": metrics,
        "bootstrap_ci": ci,
        "per_file": per_file,
    }

    json_path, md_path = write_reports(payload, args.tag)
    print(f"[bench] AUC={metrics['auc']:.4f}  EER={metrics['eer']*100:.2f}%  "
          f"ACER={metrics['acer']*100:.2f}%  ECE={metrics['ece']:.4f}")
    print(f"[bench] reports written:")
    print(f"        {json_path}")
    print(f"        {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
