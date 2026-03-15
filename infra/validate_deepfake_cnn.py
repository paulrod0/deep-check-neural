#!/usr/bin/env python3
"""
Deep-Check — Deepfake CNN v1 Validator
=======================================
Measures precision / recall / F1 / AUC of the deployed
deepfake_detector.onnx on:
  1. Synthetic held-out test set (always available, instant)
  2. Real data from data/features/ if available

Usage:
  python validate_deepfake_cnn.py [--onnx ../public/models/deepfake/deepfake_detector.onnx]
                                   [--data-dir ./data/features]
                                   [--n-synthetic 2000]
                                   [--output validation_report.json]

Output: JSON report + ASCII table with per-class metrics

Veritas Engine v2 — Deep-Check
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

try:
    import onnxruntime as ort
except ImportError:
    print("ERROR: pip install onnxruntime")
    import sys; sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────

N_FRAMES      = 90
N_BLENDSHAPES = 52
N_FEATURES    = 59   # 52 bs + 4 iris + 3 depth
LABELS        = ['real_human', 'deepfake_video', 'photo_replay']

# ─── Synthetic test data generation ──────────────────────────────────────────

def generate_synthetic_test(n_per_class: int = 500, seed: int = 1337):
    """Generate held-out synthetic test sequences (different seed from training)."""
    rng = np.random.default_rng(seed)
    X, y = [], []

    for label in range(3):
        for _ in range(n_per_class):
            x = np.zeros((N_FRAMES, N_FEATURES), dtype=np.float32)

            if label == 0:  # real_human: correlated temporal dynamics + rPPG coupling
                t = np.linspace(0, 4 * np.pi, N_FRAMES)
                hr_freq = rng.uniform(0.9, 2.5)  # 54-150 BPM
                pulse = np.sin(2 * np.pi * hr_freq * t / N_FRAMES * N_FRAMES / 30)

                for j in range(N_BLENDSHAPES):
                    # Correlated with heartbeat (Granger causality present)
                    x[:, j] = np.clip(
                        0.1 * pulse * rng.uniform(0.3, 1.5) +
                        0.05 * np.sin(t * rng.uniform(0.3, 1.2) + rng.uniform(0, 2*np.pi)) +
                        rng.normal(0, 0.02, N_FRAMES),
                        0, 1
                    )
                # Iris tracks naturally
                x[:, 52:56] = 0.5 + 0.1 * rng.normal(0, 1, (N_FRAMES, 4))
                # Depth varies naturally (3D face)
                x[:, 56:59] = rng.uniform(-0.05, 0.05, (N_FRAMES, 3))

            elif label == 1:  # deepfake_video: smooth but de-correlated from pulse
                for j in range(N_BLENDSHAPES):
                    x[:, j] = np.clip(
                        rng.uniform(0.0, 0.15) + np.cumsum(rng.normal(0, 0.002, N_FRAMES)),
                        0, 1
                    )
                # Iris too stable (no saccades)
                x[:, 52:56] = 0.5 + rng.normal(0, 0.003, (N_FRAMES, 4))
                # Depth nearly flat (neural render)
                x[:, 56:59] = rng.uniform(-0.005, 0.005, (N_FRAMES, 3))

            else:  # photo_replay: near-static with quantization noise
                base_bs  = rng.uniform(0, 0.15, N_BLENDSHAPES)
                base_iris = rng.uniform(0.45, 0.55, 4)
                for j in range(N_BLENDSHAPES):
                    x[:, j] = np.clip(base_bs[j] + rng.normal(0, 0.003, N_FRAMES), 0, 1)
                x[:, 52:56] = base_iris + rng.normal(0, 0.001, (N_FRAMES, 4))
                x[:, 56:59] = 0.0  # zero depth (2D image)

            X.append(x)
            y.append(label)

    return np.stack(X), np.array(y)


# ─── Real data loading ────────────────────────────────────────────────────────

def load_real_data(data_dir: str, max_per_class: int = 500):
    """Load real extracted features from data_dir/{real,fake,photo}/*.npz"""
    root = Path(data_dir)
    label_dirs = [
        (root / 'real',  0),
        (root / 'fake',  1),
        (root / 'photo', 2),
    ]

    has_data = any(d.exists() and list(d.glob('*.npz')) for d, _ in label_dirs)
    if not has_data:
        return None

    X, y = [], []
    for d, label in label_dirs:
        if not d.exists():
            continue
        files = sorted(d.glob('*.npz'))[:max_per_class]
        for f in files:
            data = np.load(f)
            feats = data['features'].astype(np.float32)  # (T, 59)
            # Take first window of N_FRAMES
            if feats.shape[0] >= N_FRAMES:
                X.append(feats[:N_FRAMES])
            else:
                padded = np.zeros((N_FRAMES, feats.shape[1] if feats.ndim > 1 else N_FEATURES), np.float32)
                padded[:feats.shape[0]] = feats
                X.append(padded)
            y.append(label)

    if not X:
        return None
    return np.stack(X), np.array(y)


# ─── ONNX inference ───────────────────────────────────────────────────────────

def run_inference(session: ort.InferenceSession, X: np.ndarray, batch_size: int = 128) -> np.ndarray:
    """Run batch inference, returns (N, 3) probabilities."""
    input_name = session.get_inputs()[0].name
    all_probs  = []

    for i in range(0, len(X), batch_size):
        batch = X[i:i + batch_size]
        logits = session.run(None, {input_name: batch})[0]  # (B, 3)
        exp_l  = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs  = exp_l / exp_l.sum(axis=1, keepdims=True)
        all_probs.append(probs)

    return np.concatenate(all_probs, axis=0)


# ─── Metrics ─────────────────────────────────────────────────────────────────

def compute_metrics(y_true: np.ndarray, probs: np.ndarray) -> dict:
    """Compute per-class and macro-average metrics."""
    preds = probs.argmax(axis=1)
    n_classes = probs.shape[1]
    confusion = np.zeros((n_classes, n_classes), dtype=int)
    for t, p in zip(y_true, preds):
        confusion[t, p] += 1

    per_class = {}
    for i, name in enumerate(LABELS):
        tp = confusion[i, i]
        fp = confusion[:, i].sum() - tp
        fn = confusion[i, :].sum() - tp
        tn = confusion.sum() - tp - fp - fn

        prec = tp / max(1, tp + fp)
        rec  = tp / max(1, tp + fn)
        f1   = 2 * prec * rec / max(1e-9, prec + rec)
        spec = tn / max(1, tn + fp)

        # AUC (one-vs-rest, approximate trapezoidal)
        class_probs = probs[:, i]
        auc = _compute_auc(y_true == i, class_probs)

        per_class[name] = {
            'tp': int(tp), 'fp': int(fp), 'fn': int(fn), 'tn': int(tn),
            'precision': round(float(prec), 4),
            'recall':    round(float(rec), 4),
            'f1':        round(float(f1), 4),
            'specificity': round(float(spec), 4),
            'auc_ovr':   round(float(auc), 4),
            'support':   int(confusion[i].sum()),
        }

    accuracy  = int((preds == y_true).sum()) / len(y_true)
    macro_f1  = np.mean([m['f1']  for m in per_class.values()])
    macro_auc = np.mean([m['auc_ovr'] for m in per_class.values()])

    return {
        'per_class':  per_class,
        'accuracy':   round(float(accuracy), 4),
        'macro_f1':   round(float(macro_f1), 4),
        'macro_auc':  round(float(macro_auc), 4),
        'confusion':  confusion.tolist(),
    }


def _compute_auc(y_binary: np.ndarray, scores: np.ndarray) -> float:
    """Trapezoidal AUC-ROC."""
    thresholds = np.sort(np.unique(scores))[::-1]
    tpr_list = [0.0]
    fpr_list = [0.0]
    pos = y_binary.sum()
    neg = len(y_binary) - pos
    if pos == 0 or neg == 0:
        return 0.5

    for t in thresholds:
        pred = scores >= t
        tp = (pred & y_binary).sum()
        fp = (pred & ~y_binary).sum()
        tpr_list.append(tp / pos)
        fpr_list.append(fp / neg)
    tpr_list.append(1.0)
    fpr_list.append(1.0)

    # Trapezoid rule
    auc = 0.0
    for i in range(1, len(tpr_list)):
        auc += (fpr_list[i] - fpr_list[i-1]) * (tpr_list[i] + tpr_list[i-1]) / 2
    return max(0.0, min(1.0, auc))


# ─── Report printing ──────────────────────────────────────────────────────────

def print_report(metrics: dict, title: str):
    print(f"\n{'='*65}")
    print(f"  {title}")
    print(f"{'='*65}")
    print(f"  Accuracy: {metrics['accuracy']:.1%}  |  Macro F1: {metrics['macro_f1']:.3f}  |  Macro AUC: {metrics['macro_auc']:.3f}")
    print(f"{'─'*65}")
    print(f"  {'Class':<20} {'Prec':>6} {'Rec':>6} {'F1':>6} {'AUC':>6} {'Support':>8}")
    print(f"  {'─'*20} {'─'*6} {'─'*6} {'─'*6} {'─'*6} {'─'*8}")
    for name, m in metrics['per_class'].items():
        print(f"  {name:<20} {m['precision']:>6.3f} {m['recall']:>6.3f} {m['f1']:>6.3f} {m['auc_ovr']:>6.3f} {m['support']:>8}")
    print(f"{'─'*65}")
    print("  Confusion matrix (rows=true, cols=predicted):")
    print(f"  {'':>20} {'real_h':>8} {'deepfk':>8} {'photo':>8}")
    for i, name in enumerate(LABELS):
        row = metrics['confusion'][i]
        print(f"  {name[:20]:<20} {row[0]:>8} {row[1]:>8} {row[2]:>8}")
    print(f"{'='*65}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--onnx',        default='../public/models/deepfake/deepfake_detector.onnx')
    parser.add_argument('--data-dir',    default='./data/features')
    parser.add_argument('--n-synthetic', type=int, default=600)  # per class
    parser.add_argument('--output',      default='validation_report.json')
    args = parser.parse_args()

    onnx_path = Path(args.onnx)
    if not onnx_path.exists():
        print(f"ERROR: ONNX model not found: {onnx_path}")
        print("  Run: ls ../public/models/deepfake/")
        return

    print(f"\n[validate] Loading model: {onnx_path} ({onnx_path.stat().st_size // 1024}KB)")
    session = ort.InferenceSession(str(onnx_path))
    input_shape = session.get_inputs()[0].shape
    print(f"[validate] Input shape: {input_shape}")

    report = {
        'model': str(onnx_path),
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'evaluations': {}
    }

    # ── 1. Synthetic test ──────────────────────────────────────────────────────
    print(f"\n[validate] Generating {args.n_synthetic * 3} synthetic test samples...")
    X_syn, y_syn = generate_synthetic_test(n_per_class=args.n_synthetic)
    print(f"[validate] Shape: {X_syn.shape}")

    # Check input format: model expects (B, 90, 59) or (B, 59, 90)?
    try:
        probs_syn = run_inference(session, X_syn)
    except Exception as e:
        print(f"[validate] Input shape mismatch, trying transpose... ({e})")
        X_syn = X_syn.transpose(0, 2, 1)  # (B, 90, 59) -> (B, 59, 90)
        probs_syn = run_inference(session, X_syn)

    metrics_syn = compute_metrics(y_syn, probs_syn)
    print_report(metrics_syn, "SYNTHETIC TEST SET (held-out, seed=1337)")
    report['evaluations']['synthetic'] = metrics_syn

    # ── 2. Real data (if available) ────────────────────────────────────────────
    real_data = load_real_data(args.data_dir)
    if real_data is not None:
        X_real, y_real = real_data
        print(f"\n[validate] Real data found: {len(X_real)} samples")
        print(f"  Class distribution: {dict(zip(LABELS, [int((y_real==i).sum()) for i in range(3)]))}")

        try:
            probs_real = run_inference(session, X_real)
        except Exception:
            X_real = X_real.transpose(0, 2, 1)
            probs_real = run_inference(session, X_real)

        metrics_real = compute_metrics(y_real, probs_real)
        print_report(metrics_real, "REAL DATA TEST SET")
        report['evaluations']['real_data'] = metrics_real
    else:
        print(f"\n[validate] No real data at {args.data_dir} — synthetic only")
        print("           Run extract_features_mp.py to generate real features")

    # ── 3. Calibration check ────────────────────────────────────────────────────
    print(f"\n[validate] Calibration check (Expected Calibration Error):")
    probs_all = probs_syn
    y_all     = y_syn
    bins      = np.linspace(0, 1, 11)
    ece       = 0.0
    for i in range(len(bins) - 1):
        mask  = (probs_all.max(1) >= bins[i]) & (probs_all.max(1) < bins[i+1])
        if mask.sum() == 0:
            continue
        acc    = (probs_all[mask].argmax(1) == y_all[mask]).mean()
        conf   = probs_all[mask].max(1).mean()
        ece   += mask.mean() * abs(acc - conf)
        print(f"  [{bins[i]:.1f}-{bins[i+1]:.1f}]  samples={mask.sum():5d}  acc={acc:.3f}  conf={conf:.3f}  gap={abs(acc-conf):.3f}")
    report['ece'] = round(float(ece), 4)
    print(f"\n  ECE (lower=better): {ece:.4f}")

    # ── Save report ────────────────────────────────────────────────────────────
    with open(args.output, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"\n[validate] Report saved: {args.output}")

    # ── Summary ────────────────────────────────────────────────────────────────
    syn = report['evaluations']['synthetic']
    print(f"\n{'='*40}")
    print(f"  SUMMARY")
    print(f"{'='*40}")
    print(f"  Model:       deepfake_detector.onnx (v1, synthetic-trained)")
    print(f"  Syn Acc:     {syn['accuracy']:.1%}")
    print(f"  Syn Macro F1: {syn['macro_f1']:.3f}")
    print(f"  Syn AUC:     {syn['macro_auc']:.3f}")
    print(f"  ECE:         {ece:.4f}")
    if 'real_data' in report['evaluations']:
        rd = report['evaluations']['real_data']
        print(f"  Real Acc:    {rd['accuracy']:.1%}")
        print(f"  Real Macro F1: {rd['macro_f1']:.3f}")
    print(f"{'='*40}")
    print("  Next steps to improve:")
    print("   1. Train on real data: python train_deepfake_v2.py")
    print("   2. Target: Macro F1 > 0.85, AUC > 0.90 on real data")
    print("   3. Run FaceForensics++ pipeline: ./infra/download_datasets.sh --ff")


if __name__ == '__main__':
    main()
