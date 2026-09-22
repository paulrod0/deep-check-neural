"""Training loop for the mouse-dynamics TCN.

Supports:
    - Triplet loss on the embedding head for per-user identification
    - BCE loss on the bot-detection head with synthetic bot samples
    - Optional TRADES adversarial training (``--adversarial``)

Designed to run on a single A10G (g5.xlarge). Fully reproducible: the final
manifest includes the config, dataset hash, weights hash, and final metrics.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from ..common.adversarial import TradesConfig, trades_loss
from ..common.metrics import biometric_report
from .dataset import (
    MouseWindowsDataset,
    load_balabit,
    make_split,
    save_split,
)
from .model import MouseTCN, TCNConfig


@dataclass
class TrainConfig:
    """Arguments controlling the training run."""

    data: str
    out: str
    epochs: int = 60
    batch: int = 128
    lr: float = 2e-3
    weight_decay: float = 1e-4
    seed: int = 42
    adversarial: bool = False
    triplet_margin: float = 0.4
    bot_weight: float = 0.3
    bot_synth_ratio: float = 0.2  # fraction of synthetic bot samples in each batch


def set_seeds(seed: int) -> None:
    """Seed every RNG we rely on."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def parse_args() -> TrainConfig:
    """CLI wrapper returning a ``TrainConfig``."""
    p = argparse.ArgumentParser(description="Train the BPAS mouse-dynamics TCN")
    p.add_argument("--data", required=True, help="Balabit corpus root")
    p.add_argument("--out", required=True, help="Output directory")
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--batch", type=int, default=128)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--adversarial", action="store_true")
    args = p.parse_args()
    return TrainConfig(
        data=args.data,
        out=args.out,
        epochs=args.epochs,
        batch=args.batch,
        lr=args.lr,
        weight_decay=args.weight_decay,
        seed=args.seed,
        adversarial=args.adversarial,
    )


def triplet_loss(
    embeddings: torch.Tensor, user_ids: torch.Tensor, margin: float
) -> torch.Tensor:
    """Batch-hard triplet loss.

    For each anchor, the hardest positive (same user, farthest) and hardest
    negative (different user, closest) in the batch are selected.
    """
    dists = torch.cdist(embeddings, embeddings)  # (B, B)
    mask_pos = user_ids.unsqueeze(0) == user_ids.unsqueeze(1)
    mask_neg = ~mask_pos
    # Exclude self-distances from positives.
    mask_pos = mask_pos & ~torch.eye(len(embeddings), dtype=torch.bool, device=embeddings.device)

    # If a row has no positive, skip it (happens when batch has singleton user).
    has_pos = mask_pos.any(dim=1)
    has_neg = mask_neg.any(dim=1)
    keep = has_pos & has_neg
    if keep.sum() == 0:
        return torch.zeros((), device=embeddings.device, requires_grad=True)

    pos_dists = dists.clone()
    pos_dists[~mask_pos] = float("-inf")
    neg_dists = dists.clone()
    neg_dists[~mask_neg] = float("inf")

    hardest_pos = pos_dists[keep].max(dim=1).values
    hardest_neg = neg_dists[keep].min(dim=1).values

    return torch.clamp(hardest_pos - hardest_neg + margin, min=0).mean()


def synth_bot_batch(batch_size: int, feat_dim: int, length: int, device: str) -> torch.Tensor:
    """Return a batch of synthetic "bot-like" sequences.

    Characteristics:
        - Very regular velocity (low jerk)
        - Straight trajectories (low curvature)
        - No micro-corrections

    The model should learn to flag these as non-human.
    """
    x = torch.randn(batch_size, length, feat_dim, device=device) * 0.1
    # Inject regular velocity pattern in feature 0 (velocity)
    t = torch.linspace(0.0, 2 * np.pi, length, device=device)
    x[:, :, 0] = torch.sin(t).unsqueeze(0).expand(batch_size, -1)
    # Zero out jerk, curvature and micro-corrections
    x[:, :, 2] = 0.0  # jerk
    x[:, :, 3] = 0.0  # curvature
    x[:, :, 7] = 0.0  # micro_corrections
    return x


def run_epoch(
    model: MouseTCN,
    loader: DataLoader,
    opt: torch.optim.Optimizer | None,
    cfg: TrainConfig,
    device: str,
) -> dict[str, float]:
    """Run one epoch (training if ``opt is not None``, else evaluation)."""
    training = opt is not None
    model.train(training)
    totals = {
        "loss": 0.0,
        "triplet": 0.0,
        "bot": 0.0,
        "trades": 0.0,
        "n": 0,
    }

    for batch in loader:
        x = batch["x"].to(device)
        user_idx = batch["user_idx"].to(device)
        bot_label = batch["bot"].to(device)

        # Mix in synthetic bot samples.
        n_bots = int(cfg.bot_synth_ratio * len(x))
        if n_bots > 0:
            bots = synth_bot_batch(n_bots, x.shape[-1], x.shape[1], device)
            x = torch.cat([x, bots], dim=0)
            user_idx = torch.cat(
                [user_idx, torch.full((n_bots,), -1, dtype=user_idx.dtype, device=device)]
            )
            bot_label = torch.cat(
                [bot_label, torch.ones(n_bots, dtype=bot_label.dtype, device=device)]
            )

        out = model(x)
        valid = user_idx >= 0
        if valid.any():
            trip_l = triplet_loss(
                out["embed"][valid], user_idx[valid], margin=cfg.triplet_margin
            )
        else:
            trip_l = torch.zeros((), device=device)

        bot_l = torch.nn.functional.binary_cross_entropy_with_logits(
            out["bot_logit"], bot_label
        )

        loss = trip_l + cfg.bot_weight * bot_l

        trades_l_val = 0.0
        if cfg.adversarial and training and valid.any():
            # Apply TRADES only on the bot head for computational reasons.
            # Target: keep predictions stable under ε = 0.05 perturbations.
            def bot_only(z: torch.Tensor) -> torch.Tensor:
                return model(z)["bot_logit"]

            trades_l = trades_loss(
                bot_only,
                x[valid],
                bot_label[valid],
                config=TradesConfig(beta=6.0, eps=0.05, n_steps=5),
            )
            loss = loss + 0.5 * trades_l
            trades_l_val = float(trades_l.item())

        if training:
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

        bsz = len(x)
        totals["loss"] += float(loss.item()) * bsz
        totals["triplet"] += float(trip_l.item()) * bsz
        totals["bot"] += float(bot_l.item()) * bsz
        totals["trades"] += trades_l_val * bsz
        totals["n"] += bsz

    n = max(totals["n"], 1)
    return {
        "loss": totals["loss"] / n,
        "triplet": totals["triplet"] / n,
        "bot": totals["bot"] / n,
        "trades": totals["trades"] / n,
    }


def evaluate_biometrics(
    model: MouseTCN, loader: DataLoader, device: str
) -> dict[str, float]:
    """Score genuine vs impostor pairs and return biometric metrics."""
    model.train(False)
    embeds = []
    users = []
    with torch.no_grad():
        for batch in loader:
            out = model(batch["x"].to(device))
            embeds.append(out["embed"].cpu().numpy())
            users.extend([int(u) for u in batch["user_idx"]])
    embeds_arr = np.concatenate(embeds, axis=0)
    users_arr = np.array(users)

    # Build genuine / impostor score lists: score = cosine similarity.
    genuine_scores: list[float] = []
    impostor_scores: list[float] = []
    n = len(embeds_arr)
    # Sampling to avoid O(n²) explosion on large sets.
    rng = np.random.default_rng(0)
    pairs = min(50_000, n * (n - 1) // 2)
    for _ in range(pairs):
        i, j = rng.integers(0, n, size=2)
        if i == j:
            continue
        sim = float(np.dot(embeds_arr[i], embeds_arr[j]))
        if users_arr[i] == users_arr[j]:
            genuine_scores.append(sim)
        else:
            impostor_scores.append(sim)

    if not genuine_scores or not impostor_scores:
        return {"eer": float("nan")}

    report = biometric_report(np.array(genuine_scores), np.array(impostor_scores))
    return report.to_dict()


def main() -> None:
    """Train, evaluate, and write a result manifest."""
    cfg = parse_args()
    set_seeds(cfg.seed)

    out_dir = Path(cfg.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[bpas-mouse] device={device}")

    # Load data and split.
    print("[bpas-mouse] loading data...")
    root = Path(cfg.data)
    users = sorted(p.name for p in root.iterdir() if p.is_dir())
    split = make_split(users, val_frac=0.1, test_frac=0.2, seed=cfg.seed)
    save_split(split, out_dir / "split.json")
    print(f"[bpas-mouse] users train/val/test = {len(split.train)}/{len(split.val)}/{len(split.test)}")

    train_ds = load_balabit(root, users_to_load=split.train)
    val_ds = load_balabit(root, users_to_load=split.val)
    test_ds = load_balabit(root, users_to_load=split.test)
    print(f"[bpas-mouse] windows train/val/test = {len(train_ds)}/{len(val_ds)}/{len(test_ds)}")

    (out_dir / "dataset_hashes.json").write_text(
        json.dumps(
            {
                "train": train_ds.dataset_hash(),
                "val": val_ds.dataset_hash(),
                "test": test_ds.dataset_hash(),
            },
            indent=2,
        )
    )

    train_loader = DataLoader(
        train_ds, batch_size=cfg.batch, shuffle=True, num_workers=2, drop_last=True
    )
    val_loader = DataLoader(val_ds, batch_size=cfg.batch, shuffle=False, num_workers=2)

    model = MouseTCN(TCNConfig()).to(device)
    print(f"[bpas-mouse] parameters = {model.count_parameters():,}")

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.epochs)

    history = []
    best_val_eer = float("inf")
    best_weights = None

    for epoch in range(cfg.epochs):
        t0 = time.time()
        train_stats = run_epoch(model, train_loader, opt, cfg, device)
        val_stats = evaluate_biometrics(model, val_loader, device)
        dt = time.time() - t0
        history.append(
            {
                "epoch": epoch,
                "train": train_stats,
                "val": val_stats,
                "secs": round(dt, 2),
            }
        )
        print(
            f"[epoch {epoch:02d}] "
            f"loss={train_stats['loss']:.4f} "
            f"trip={train_stats['triplet']:.4f} "
            f"bot={train_stats['bot']:.4f} "
            f"val_eer={val_stats.get('eer', float('nan')):.4f} "
            f"({dt:.1f}s)"
        )
        if val_stats.get("eer", float("inf")) < best_val_eer:
            best_val_eer = val_stats["eer"]
            best_weights = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        sched.step()

    # Restore best weights before test-set evaluation.
    if best_weights is not None:
        model.load_state_dict(best_weights)

    test_loader = DataLoader(test_ds, batch_size=cfg.batch, shuffle=False, num_workers=2)
    test_stats = evaluate_biometrics(model, test_loader, device)
    print(f"[bpas-mouse] FINAL test = {json.dumps(test_stats, indent=2)}")

    weights_path = out_dir / "mouse_tcn_best.pt"
    torch.save(model.state_dict(), weights_path)

    weights_hash = hashlib.sha256(weights_path.read_bytes()).hexdigest()
    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": "1.0.0",
                "config": asdict(cfg),
                "weights_hash_sha256": weights_hash,
                "parameters": model.count_parameters(),
                "best_val_eer": best_val_eer,
                "test": test_stats,
                "history": history,
            },
            indent=2,
        )
    )
    print(f"[bpas-mouse] manifest written to {out_dir/'manifest.json'}")


if __name__ == "__main__":
    main()
