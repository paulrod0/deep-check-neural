"""Training loop for the operational β-VAE (one-class novelty detection)."""

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

from .dataset import (
    ACTION_VOCAB_SIZE,
    AppVocab,
    OperationalWindowsDataset,
    load_jsonl_sequences,
    synthesize_corpus,
)
from .model import OperationalVAE, VaeConfig


@dataclass
class TrainConfig:
    """Run configuration captured in the output manifest."""

    data: str | None
    out: str
    epochs: int = 40
    batch: int = 64
    lr: float = 1e-3
    beta: float = 4.0
    alpha_novelty: float = 0.7
    seed: int = 42
    window_size: int = 100
    synthetic: bool = False


def set_seeds(seed: int) -> None:
    """Seed every RNG we rely on."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def parse_args() -> TrainConfig:
    """Argparse wrapper returning a ``TrainConfig``."""
    p = argparse.ArgumentParser(description="Train the BPAS operational β-VAE")
    p.add_argument("--data", default=None, help="JSONL file with legitimate sequences")
    p.add_argument("--out", required=True, help="Output directory")
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--beta", type=float, default=4.0)
    p.add_argument("--alpha-novelty", type=float, default=0.7)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--window-size", type=int, default=100)
    p.add_argument(
        "--synthetic",
        action="store_true",
        help="Train on synthesised corpus (smoke test only)",
    )
    args = p.parse_args()
    return TrainConfig(
        data=args.data,
        out=args.out,
        epochs=args.epochs,
        batch=args.batch,
        lr=args.lr,
        beta=args.beta,
        alpha_novelty=args.alpha_novelty,
        seed=args.seed,
        window_size=args.window_size,
        synthetic=args.synthetic,
    )


def run_epoch(
    model: OperationalVAE,
    loader: DataLoader,
    opt: torch.optim.Optimizer | None,
    device: str,
) -> dict[str, float]:
    """Run one epoch of the β-VAE on legitimate sequences."""
    training = opt is not None
    model.train(training)
    totals = {"loss": 0.0, "recon": 0.0, "kl": 0.0, "n": 0}
    for batch in loader:
        app = batch["app"].to(device)
        action = batch["action"].to(device)
        dt = batch["dt"].to(device)
        out = model(app, action, dt)
        terms = model.elbo(out, app, action, dt)

        if training:
            opt.zero_grad()
            terms["loss"].backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

        bsz = len(app)
        totals["loss"] += float(terms["loss"].item()) * bsz
        totals["recon"] += float(terms["recon"].item()) * bsz
        totals["kl"] += float(terms["kl"].item()) * bsz
        totals["n"] += bsz
    n = max(totals["n"], 1)
    return {
        "loss": totals["loss"] / n,
        "recon": totals["recon"] / n,
        "kl": totals["kl"] / n,
    }


def evaluate_novelty(
    model: OperationalVAE,
    legit_loader: DataLoader,
    anomaly_loader: DataLoader,
    device: str,
) -> dict[str, float]:
    """Compute novelty score distributions and return basic stats."""
    model.train(False)
    legit_scores: list[float] = []
    anomaly_scores: list[float] = []
    with torch.no_grad():
        for batch in legit_loader:
            s = model.novelty_score(
                batch["app"].to(device),
                batch["action"].to(device),
                batch["dt"].to(device),
            )
            legit_scores.extend(s.cpu().tolist())
        for batch in anomaly_loader:
            s = model.novelty_score(
                batch["app"].to(device),
                batch["action"].to(device),
                batch["dt"].to(device),
            )
            anomaly_scores.extend(s.cpu().tolist())

    legit = np.array(legit_scores)
    anom = np.array(anomaly_scores)
    if len(legit) == 0 or len(anom) == 0:
        return {
            "legit_mean": float(legit.mean()) if len(legit) else float("nan"),
            "anom_mean": float(anom.mean()) if len(anom) else float("nan"),
            "separation": float("nan"),
        }
    # Higher separation = better detector; Mahalanobis-like separation.
    sep = (anom.mean() - legit.mean()) / (np.sqrt(legit.var() + anom.var()) + 1e-6)
    return {
        "legit_mean": float(legit.mean()),
        "legit_std": float(legit.std()),
        "anom_mean": float(anom.mean()),
        "anom_std": float(anom.std()),
        "separation": float(sep),
        "n_legit": len(legit),
        "n_anom": len(anom),
    }


def main() -> None:
    """Train, evaluate, and write a result manifest."""
    cfg = parse_args()
    set_seeds(cfg.seed)

    out_dir = Path(cfg.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if cfg.synthetic or cfg.data is None:
        print("[bpas-opvae] using synthesised corpus (smoke test)")
        legit_seqs = synthesize_corpus(n_sequences=2000, seq_len=200, seed=cfg.seed, anomaly_rate=0.0)
        anom_seqs = synthesize_corpus(
            n_sequences=200, seq_len=200, seed=cfg.seed + 1, anomaly_rate=1.0
        )
    else:
        data_path = Path(cfg.data)
        print(f"[bpas-opvae] loading {data_path}...")
        legit_seqs = load_jsonl_sequences(data_path)
        anom_path = data_path.parent / f"{data_path.stem}.anomalies.jsonl"
        anom_seqs = (
            load_jsonl_sequences(anom_path)
            if anom_path.exists()
            else synthesize_corpus(200, 200, cfg.seed + 1, anomaly_rate=1.0)
        )

    # Build vocabulary over training apps only.
    apps = [e.app for s in legit_seqs for e in s]
    vocab = AppVocab(max_size=2048)
    vocab.fit(apps)
    (out_dir / "app_vocab.json").write_text(vocab.to_json())
    print(f"[bpas-opvae] app vocab size = {vocab.size}")

    # Split legitimate sequences into train / val.
    rng = random.Random(cfg.seed)
    rng.shuffle(legit_seqs)
    split = int(len(legit_seqs) * 0.9)
    train_seqs = legit_seqs[:split]
    val_seqs = legit_seqs[split:]

    train_ds = OperationalWindowsDataset(train_seqs, vocab, window_size=cfg.window_size)
    val_ds = OperationalWindowsDataset(val_seqs, vocab, window_size=cfg.window_size)
    anom_ds = OperationalWindowsDataset(anom_seqs, vocab, window_size=cfg.window_size)
    print(
        f"[bpas-opvae] windows train/val/anom = "
        f"{len(train_ds)}/{len(val_ds)}/{len(anom_ds)}"
    )
    (out_dir / "dataset_hashes.json").write_text(
        json.dumps(
            {
                "train": train_ds.dataset_hash(),
                "val": val_ds.dataset_hash(),
                "anom": anom_ds.dataset_hash(),
            },
            indent=2,
        )
    )

    train_loader = DataLoader(train_ds, batch_size=cfg.batch, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch, shuffle=False)
    anom_loader = DataLoader(anom_ds, batch_size=cfg.batch, shuffle=False)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = OperationalVAE(
        VaeConfig(
            app_vocab=vocab.size,
            action_vocab=ACTION_VOCAB_SIZE,
            beta=cfg.beta,
            alpha_novelty=cfg.alpha_novelty,
        )
    ).to(device)
    print(f"[bpas-opvae] parameters = {model.count_parameters():,}")

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr)

    history = []
    best_sep = float("-inf")
    best_weights = None

    for epoch in range(cfg.epochs):
        t0 = time.time()
        train_stats = run_epoch(model, train_loader, opt, device)
        val_stats = run_epoch(model, val_loader, None, device)
        novelty_stats = evaluate_novelty(model, val_loader, anom_loader, device)
        dt = time.time() - t0
        history.append(
            {
                "epoch": epoch,
                "train": train_stats,
                "val": val_stats,
                "novelty": novelty_stats,
                "secs": round(dt, 2),
            }
        )
        print(
            f"[epoch {epoch:02d}] "
            f"loss={train_stats['loss']:.4f} "
            f"val_loss={val_stats['loss']:.4f} "
            f"sep={novelty_stats['separation']:.3f} "
            f"({dt:.1f}s)"
        )
        if novelty_stats["separation"] > best_sep:
            best_sep = novelty_stats["separation"]
            best_weights = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_weights is not None:
        model.load_state_dict(best_weights)

    weights_path = out_dir / "op_vae_best.pt"
    torch.save(model.state_dict(), weights_path)
    weights_hash = hashlib.sha256(weights_path.read_bytes()).hexdigest()

    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": "1.0.0",
                "config": asdict(cfg),
                "parameters": model.count_parameters(),
                "weights_hash_sha256": weights_hash,
                "best_separation": best_sep,
                "history": history,
            },
            indent=2,
        )
    )
    print(f"[bpas-opvae] manifest written to {out_dir/'manifest.json'}")


if __name__ == "__main__":
    main()
