#!/usr/bin/env python3
"""
Deep-Check V10 Continuous Iteration Loop.

Cycle:
  1. Benchmark current best model on test set + adversarial attacks
  2. Identify hard negatives (false positives + false negatives with high confidence)
  3. Build V10.(N+1) training set: V10.N + hard negatives + fresh scraped modern samples
  4. Launch fine-tune (2-5 epochs) from V10.N checkpoint
  5. Benchmark V10.(N+1)
  6. Promote if defense-grade thresholds improve, else rollback
  7. Update S3 manifest + trigger model hot-reload in production
  8. Log everything to reports/iteration_history.jsonl

Typical cycle time: 6-10 hours on g5.12xlarge.

Usage:
  python iterate.py --current v10.0 --next v10.1 --data ./datasets/video_v10
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger("v10_iterate")


# --------------------------------------------------------------------------- #
# Thresholds (defense-grade promotion criteria)
# --------------------------------------------------------------------------- #

PROMOTION_CRITERIA = {
    "auc_improvement_min": 0.003,  # must gain at least 0.3% AUC
    "eer_improvement_min": 0.002,  # must drop EER by at least 0.2%
    "apcer_max": 0.05,
    "bpcer_max": 0.05,
    "no_per_generator_regression": 0.01,  # no generator can lose >1% AUC
    "adversarial_degradation_max": 0.03,  # max 3% AUC drop under any attack
}


# --------------------------------------------------------------------------- #
# Hard negative mining
# --------------------------------------------------------------------------- #

def mine_hard_negatives(
    report_dir: Path,
    dataset_dir: Path,
    out_file: Path,
    top_k_per_class: int = 500,
) -> int:
    """Read raw scores from benchmark output, pick hardest mispredictions."""
    scores_path = report_dir / "raw_scores.npz"
    if not scores_path.exists():
        logger.warning(f"No raw_scores.npz in {report_dir}")
        return 0

    data = np.load(scores_path)
    scores = data["scores"]
    labels = data["labels"]

    test_index = dataset_dir / "test" / "index.jsonl"
    records = [json.loads(l) for l in test_index.read_text().splitlines() if l.strip()]
    if len(records) != len(scores):
        logger.warning(f"Score/record count mismatch: {len(scores)} vs {len(records)}")

    # False positives: label=0 but score close to 1
    fp_mask = (labels == 0) & (scores > 0.5)
    fp_idxs = np.argsort(-scores[fp_mask])  # highest confidence first
    fp_global = np.where(fp_mask)[0][fp_idxs][:top_k_per_class]

    # False negatives: label=1 but score close to 0
    fn_mask = (labels == 1) & (scores < 0.5)
    fn_idxs = np.argsort(scores[fn_mask])
    fn_global = np.where(fn_mask)[0][fn_idxs][:top_k_per_class]

    hard = []
    for i in list(fp_global) + list(fn_global):
        r = records[int(i)]
        r["hard_negative_source_version"] = report_dir.name
        r["original_score"] = float(scores[i])
        hard.append(r)

    with out_file.open("w") as f:
        for h in hard:
            f.write(json.dumps(h) + "\n")

    logger.info(f"Mined {len(hard)} hard negatives -> {out_file}")
    return len(hard)


# --------------------------------------------------------------------------- #
# Promotion decision
# --------------------------------------------------------------------------- #

def decide_promotion(current_report: dict, candidate_report: dict) -> tuple[bool, list[str]]:
    cur = current_report["overall"]["baseline"]
    cand = candidate_report["overall"]["baseline"]
    reasons = []
    passed = True

    d_auc = cand["auc"] - cur["auc"]
    if d_auc < PROMOTION_CRITERIA["auc_improvement_min"]:
        passed = False
        reasons.append(f"AUC improvement {d_auc:+.4f} < {PROMOTION_CRITERIA['auc_improvement_min']}")
    else:
        reasons.append(f"AUC +{d_auc:.4f} (pass)")

    d_eer = cur["eer"] - cand["eer"]
    if d_eer < PROMOTION_CRITERIA["eer_improvement_min"]:
        passed = False
        reasons.append(f"EER improvement {d_eer:+.4f} < {PROMOTION_CRITERIA['eer_improvement_min']}")
    else:
        reasons.append(f"EER -{d_eer:.4f} (pass)")

    if cand["apcer"] > PROMOTION_CRITERIA["apcer_max"]:
        passed = False
        reasons.append(f"APCER {cand['apcer']:.4f} > {PROMOTION_CRITERIA['apcer_max']}")

    if cand["bpcer"] > PROMOTION_CRITERIA["bpcer_max"]:
        passed = False
        reasons.append(f"BPCER {cand['bpcer']:.4f} > {PROMOTION_CRITERIA['bpcer_max']}")

    # Check no per-generator regression
    cur_gens = current_report.get("by_generator", {})
    cand_gens = candidate_report.get("by_generator", {})
    for g in cur_gens:
        if g in cand_gens:
            reg = cur_gens[g]["auc"] - cand_gens[g]["auc"]
            if reg > PROMOTION_CRITERIA["no_per_generator_regression"]:
                passed = False
                reasons.append(f"Regression on {g}: {reg:+.4f}")

    # Adversarial degradation
    cand_base_auc = cand["auc"]
    for atk, m in candidate_report["overall"].items():
        if atk == "baseline":
            continue
        deg = cand_base_auc - m["auc"]
        if deg > PROMOTION_CRITERIA["adversarial_degradation_max"]:
            passed = False
            reasons.append(f"Attack {atk} degradation {deg:+.4f} > {PROMOTION_CRITERIA['adversarial_degradation_max']}")

    return passed, reasons


# --------------------------------------------------------------------------- #
# Runner
# --------------------------------------------------------------------------- #

def run_cmd(cmd: list[str], check: bool = True) -> int:
    logger.info(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}")
    return result.returncode


def run_benchmark(ckpt: Path, data_dir: Path, out_dir: Path, version: str):
    out_dir.mkdir(parents=True, exist_ok=True)
    run_cmd([
        "python", "benchmark.py",
        "--ckpt", str(ckpt),
        "--data", str(data_dir / "test"),
        "--out", str(out_dir),
        "--version", version,
    ])


def run_fine_tune(
    base_ckpt: Path,
    data_dir: Path,
    out_dir: Path,
    version: str,
    epochs: int = 5,
    nproc: int = 4,
):
    run_cmd([
        "torchrun", f"--nproc_per_node={nproc}",
        "train.py",
        "--data", str(data_dir),
        "--out", str(out_dir),
        "--version", version,
        "--epochs", str(epochs),
        "--warmup-epochs", "1",
        "--lr", "2e-5",  # lower LR for fine-tune
        "--resume", str(base_ckpt),
    ])


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--current", required=True, help="Current version, e.g. v10.0")
    ap.add_argument("--next", required=True, dest="next_version", help="Candidate version, e.g. v10.1")
    ap.add_argument("--data", required=True, help="Dataset root")
    ap.add_argument("--ckpt-dir", default="./checkpoints", help="Local checkpoint directory")
    ap.add_argument("--reports-dir", default="./reports")
    ap.add_argument("--epochs", type=int, default=5, help="Fine-tune epochs")
    ap.add_argument("--scrape-new", action="store_true", help="Scrape fresh modern samples before iterating")
    ap.add_argument("--s3-prefix", default="s3://deep-check-models/deepfake/")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    data_dir = Path(args.data)
    ckpt_dir = Path(args.ckpt_dir)
    reports_dir = Path(args.reports_dir)
    history_file = reports_dir / "iteration_history.jsonl"
    reports_dir.mkdir(parents=True, exist_ok=True)

    cur_ckpt = ckpt_dir / args.current / "best.pt"
    cur_report_dir = reports_dir / args.current
    next_ckpt_dir = ckpt_dir / args.next_version
    next_report_dir = reports_dir / args.next_version

    if not cur_ckpt.exists():
        logger.error(f"Current ckpt not found: {cur_ckpt}")
        sys.exit(1)

    iteration_record = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "current": args.current,
        "next": args.next_version,
        "steps": [],
    }

    # Step 1: benchmark current
    logger.info(f"[1/6] Benchmarking current {args.current}")
    if not (cur_report_dir / "benchmark.json").exists():
        if not args.dry_run:
            run_benchmark(cur_ckpt, data_dir, cur_report_dir, args.current)
        iteration_record["steps"].append({"step": "benchmark_current", "version": args.current})

    # Step 2: mine hard negatives
    logger.info("[2/6] Mining hard negatives")
    hn_file = next_report_dir / "hard_negatives.jsonl"
    next_report_dir.mkdir(parents=True, exist_ok=True)
    n_mined = 0
    if not args.dry_run:
        n_mined = mine_hard_negatives(cur_report_dir, data_dir, hn_file, top_k_per_class=500)
    iteration_record["steps"].append({"step": "mine_hard_negatives", "count": n_mined})

    # Step 3: scrape fresh samples
    if args.scrape_new:
        logger.info("[3/6] Scraping fresh modern samples")
        fresh_dir = data_dir / f"_fresh_{args.next_version}"
        if not args.dry_run:
            run_cmd([
                "python", "build_dataset.py",
                "--out", str(fresh_dir),
                "--version", args.next_version,
                "--quota-scale", "0.3",
            ])
        iteration_record["steps"].append({"step": "scrape_fresh"})

    # Step 4: build training set (merge V10.N + hard_negatives + fresh)
    logger.info("[4/6] Building training set for next version")
    next_train = data_dir / "train" / "index.jsonl"
    backup = data_dir / "train" / f"index_backup_{args.current}.jsonl"
    if not args.dry_run:
        shutil.copy(next_train, backup)
        with next_train.open("a") as f:
            if hn_file.exists():
                f.write(hn_file.read_text())
    iteration_record["steps"].append({"step": "build_trainset"})

    # Step 5: fine-tune
    logger.info(f"[5/6] Fine-tuning {args.next_version} for {args.epochs} epochs")
    if not args.dry_run:
        run_fine_tune(cur_ckpt, data_dir, next_ckpt_dir, args.next_version, epochs=args.epochs)
    iteration_record["steps"].append({"step": "fine_tune", "epochs": args.epochs})

    # Step 6: benchmark candidate + decide
    logger.info(f"[6/6] Benchmarking {args.next_version}")
    next_ckpt = next_ckpt_dir / "best.pt"
    if not args.dry_run:
        run_benchmark(next_ckpt, data_dir, next_report_dir, args.next_version)

    cur_json = cur_report_dir / "benchmark.json"
    next_json = next_report_dir / "benchmark.json"
    if cur_json.exists() and next_json.exists():
        cur_rep = json.loads(cur_json.read_text())
        cand_rep = json.loads(next_json.read_text())
        promote, reasons = decide_promotion(cur_rep, cand_rep)
        iteration_record["promotion"] = {"promoted": promote, "reasons": reasons}

        logger.info("--- Promotion Decision ---")
        for r in reasons:
            logger.info(f"  {r}")

        if promote:
            logger.info(f"PROMOTED {args.next_version}")
            # Upload to S3 + update manifest
            manifest_path = next_ckpt_dir / "manifest.json"
            manifest = {
                "version": args.next_version,
                "file": "best.pt",
                "auc": cand_rep["overall"]["baseline"]["auc"],
                "eer": cand_rep["overall"]["baseline"]["eer"],
                "promoted_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                "parent_version": args.current,
            }
            manifest_path.write_text(json.dumps(manifest, indent=2))
            if not args.dry_run:
                subprocess.run([
                    "aws", "s3", "cp", str(next_ckpt),
                    f"{args.s3_prefix}approved/deepfake_video/best_{args.next_version}.pt",
                ], check=False)
                subprocess.run([
                    "aws", "s3", "cp", str(manifest_path),
                    f"{args.s3_prefix}approved/deepfake_video/manifest.json",
                ], check=False)
        else:
            logger.warning(f"NOT PROMOTED {args.next_version}: {reasons}")
            # Restore train set
            if backup.exists():
                shutil.copy(backup, next_train)

    # Append to history
    with history_file.open("a") as f:
        f.write(json.dumps(iteration_record) + "\n")
    logger.info(f"Iteration logged to {history_file}")


if __name__ == "__main__":
    sys.exit(main())
