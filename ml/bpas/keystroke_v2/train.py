"""Training loop for the keystroke v2 Transformer.

Combined loss:

    L = α·L_triplet + β·L_infoNCE + γ·L_bot + δ·L_duress + ε·L_drift + λ·L_cal

where L_cal is the in-batch ECE (Guo et al. 2017) applied to all three
probabilistic heads. α..ε, λ default to the values recommended in
``SPEC.md §4.1.4``.
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
import torch.nn.functional as F
from torch.utils.data import DataLoader

from ..common.metrics import biometric_report, expected_calibration_error
from .dataset import (
    KeystrokeWindowsDataset,
    synth_bot_sessions,
    synth_duress_sessions,
    synthesise_offline_corpus,
)
from .model import KeystrokeV2, KsV2Config


@dataclass
class TrainConfig:
    """Runtime configuration (all fields appear in the manifest)."""

    data: str | None
    out: str
    epochs: int = 30
    batch: int = 32
    lr: float = 3e-4
    weight_decay: float = 1e-4
    seed: int = 42
    window_size: int = 256
    alpha_triplet: float = 1.0
    beta_infonce: float = 0.5
    gamma_bot: float = 0.3
    delta_duress: float = 0.4
    epsilon_drift: float = 0.1
    lambda_cal: float = 0.1
    triplet_margin: float = 0.4
    infonce_temp: float = 0.1
    duress_pos_weight: float = 3.5
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
    p = argparse.ArgumentParser(description="Train the BPAS keystroke Transformer v2")
    p.add_argument("--data", default=None, help="Aalto CSV path")
    p.add_argument("--out", required=True)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--window-size", type=int, default=256)
    p.add_argument("--synthetic", action="store_true")
    args = p.parse_args()
    return TrainConfig(
        data=args.data,
        out=args.out,
        epochs=args.epochs,
        batch=args.batch,
        lr=args.lr,
        seed=args.seed,
        window_size=args.window_size,
        synthetic=args.synthetic,
    )


# --------------------------------------------------------------------------- #
# Loss components
# --------------------------------------------------------------------------- #

def batch_hard_triplet(
    embed: torch.Tensor, user_ids: torch.Tensor, margin: float
) -> torch.Tensor:
    """Batch-hard triplet loss (see mouse_tcn for the reference version)."""
    dists = torch.cdist(embed, embed)
    same = user_ids.unsqueeze(0) == user_ids.unsqueeze(1)
    eye = torch.eye(len(embed), dtype=torch.bool, device=embed.device)
    pos_mask = same & ~eye
    neg_mask = ~same

    keep = pos_mask.any(dim=1) & neg_mask.any(dim=1)
    if keep.sum() == 0:
        return torch.zeros((), device=embed.device, requires_grad=True)

    pos = dists.masked_fill(~pos_mask, float("-inf"))[keep].max(dim=1).values
    neg = dists.masked_fill(~neg_mask, float("inf"))[keep].min(dim=1).values
    return torch.clamp(pos - neg + margin, min=0).mean()


def infonce_loss(embed: torch.Tensor, user_ids: torch.Tensor, temp: float) -> torch.Tensor:
    """SimCLR-style InfoNCE over same-user positives."""
    sim = (embed @ embed.t()) / temp
    labels = user_ids.unsqueeze(0) == user_ids.unsqueeze(1)
    # Mask the diagonal.
    eye = torch.eye(len(embed), dtype=torch.bool, device=embed.device)
    labels = labels & ~eye
    if not labels.any():
        return torch.zeros((), device=embed.device, requires_grad=True)

    # For each row, use log-softmax over columns and pick positives.
    log_prob = sim - torch.logsumexp(sim.masked_fill(eye, float("-inf")), dim=1, keepdim=True)
    pos_count = labels.sum(dim=1).clamp(min=1)
    mean_log_prob_pos = (log_prob * labels.float()).sum(dim=1) / pos_count.float()
    return -mean_log_prob_pos.mean()


def batch_ece(probs: torch.Tensor, labels: torch.Tensor, n_bins: int = 10) -> torch.Tensor:
    """Differentiable-in-shape ECE computed within a batch.

    Not truly differentiable (bin membership is discrete), but it is useful
    as a regulariser whose value shrinks when calibration improves, and the
    optimiser keeps nudging the logits that contribute most to the bias.
    """
    with torch.no_grad():
        edges = torch.linspace(0.0, 1.0, n_bins + 1, device=probs.device)
        bin_ids = torch.bucketize(probs.detach(), edges) - 1
        bin_ids = bin_ids.clamp(0, n_bins - 1)
    total = torch.zeros((), device=probs.device)
    n = probs.numel()
    for b in range(n_bins):
        mask = bin_ids == b
        if mask.any():
            mean_prob = probs[mask].mean()
            mean_label = labels[mask].mean()
            weight = mask.sum().float() / n
            total = total + weight * (mean_prob - mean_label).abs()
    return total


# --------------------------------------------------------------------------- #
# Epoch driver
# --------------------------------------------------------------------------- #

def run_epoch(
    model: KeystrokeV2,
    loader: DataLoader,
    opt: torch.optim.Optimizer | None,
    cfg: TrainConfig,
    device: str,
) -> dict[str, float]:
    """Run one epoch (training if ``opt`` is not None, else evaluation)."""
    training = opt is not None
    model.train(training)
    totals = {
        "loss": 0.0,
        "trip": 0.0,
        "infonce": 0.0,
        "bot": 0.0,
        "duress": 0.0,
        "drift": 0.0,
        "cal": 0.0,
        "n": 0,
    }

    for batch in loader:
        kc = batch["keycodes"].to(device)
        sc = batch["scalars"].to(device)
        mask = batch["mask"].to(device)
        user_ids = batch["user_idx"].to(device)
        bot_label = batch["bot"].to(device)
        duress_label = batch["duress"].to(device)
        drift_label = batch["drift"].to(device)

        out = model(kc, sc, mask)

        # Embedding losses only apply to sessions with a meaningful user.
        valid_user = user_ids >= 0
        if valid_user.any() and (user_ids[valid_user].unique().numel() > 1):
            trip_l = batch_hard_triplet(
                out["embed"][valid_user], user_ids[valid_user], margin=cfg.triplet_margin
            )
            infonce_l = infonce_loss(
                out["embed"][valid_user], user_ids[valid_user], temp=cfg.infonce_temp
            )
        else:
            trip_l = torch.zeros((), device=device, requires_grad=True)
            infonce_l = torch.zeros((), device=device, requires_grad=True)

        bot_l = F.binary_cross_entropy_with_logits(
            out["bot_logit"], bot_label, reduction="mean"
        )
        # label smoothing for the bot head (ε = 0.05)
        with torch.no_grad():
            smoothed_bot = bot_label * 0.95 + 0.025
        bot_l = (
            bot_l
            + 0.05
            * F.binary_cross_entropy_with_logits(out["bot_logit"], smoothed_bot, reduction="mean")
        )

        duress_l = F.binary_cross_entropy_with_logits(
            out["duress_logit"],
            duress_label,
            pos_weight=torch.tensor(cfg.duress_pos_weight, device=device),
        )
        drift_l = F.binary_cross_entropy_with_logits(out["drift_logit"], drift_label)

        # L_calibration: batch-level ECE across all prob heads.
        bot_probs = torch.sigmoid(out["bot_logit"])
        duress_probs = torch.sigmoid(out["duress_logit"])
        drift_probs = torch.sigmoid(out["drift_logit"])
        cal_l = (
            batch_ece(bot_probs, bot_label)
            + batch_ece(duress_probs, duress_label)
            + batch_ece(drift_probs, drift_label)
        ) / 3.0

        loss = (
            cfg.alpha_triplet * trip_l
            + cfg.beta_infonce * infonce_l
            + cfg.gamma_bot * bot_l
            + cfg.delta_duress * duress_l
            + cfg.epsilon_drift * drift_l
            + cfg.lambda_cal * cal_l
        )

        if training:
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

        bsz = len(kc)
        totals["loss"] += float(loss.item()) * bsz
        totals["trip"] += float(trip_l.item()) * bsz
        totals["infonce"] += float(infonce_l.item()) * bsz
        totals["bot"] += float(bot_l.item()) * bsz
        totals["duress"] += float(duress_l.item()) * bsz
        totals["drift"] += float(drift_l.item()) * bsz
        totals["cal"] += float(cal_l.item()) * bsz
        totals["n"] += bsz

    n = max(totals["n"], 1)
    return {k: totals[k] / n for k in totals if k != "n"}


def eer_on_embeddings(
    model: KeystrokeV2, loader: DataLoader, device: str, max_pairs: int = 50_000
) -> dict[str, float]:
    """Report biometric metrics on the embedding head."""
    model.train(False)
    embeds: list[np.ndarray] = []
    users: list[int] = []
    with torch.no_grad():
        for batch in loader:
            out = model(
                batch["keycodes"].to(device),
                batch["scalars"].to(device),
                batch["mask"].to(device),
            )
            embeds.append(out["embed"].cpu().numpy())
            users.extend(int(u) for u in batch["user_idx"])
    arr = np.concatenate(embeds, axis=0)
    user_arr = np.array(users)

    genuine: list[float] = []
    impostor: list[float] = []
    rng = np.random.default_rng(0)
    n = len(arr)
    for _ in range(max_pairs):
        i, j = rng.integers(0, n, size=2)
        if i == j:
            continue
        sim = float(np.dot(arr[i], arr[j]))
        (genuine if user_arr[i] == user_arr[j] else impostor).append(sim)

    if not genuine or not impostor:
        return {"eer": float("nan")}
    report = biometric_report(np.array(genuine), np.array(impostor))
    return report.to_dict()


def build_sessions(cfg: TrainConfig) -> list:
    """Assemble the training corpus either from the Aalto CSV or synthetic."""
    if cfg.synthetic or cfg.data is None:
        print("[bpas-ksv2] using synthesised corpus (smoke test)")
        sessions = synthesise_offline_corpus(n_users=40, seq_len=600, seed=cfg.seed)
    else:
        from .dataset import load_aalto_csv

        print(f"[bpas-ksv2] loading Aalto from {cfg.data}")
        sessions = load_aalto_csv(Path(cfg.data), max_users=200)
        if not sessions:
            raise RuntimeError("no sessions loaded from Aalto CSV")

    # Add bot and duress augmentation.
    sessions += synth_bot_sessions(n=len(sessions) // 10, seq_len=300, seed=cfg.seed + 1)
    sessions += synth_duress_sessions(sessions, rate=0.15, seed=cfg.seed + 2)
    random.Random(cfg.seed).shuffle(sessions)
    return sessions


def main() -> None:
    """Train the keystroke v2 Transformer and write a result manifest."""
    cfg = parse_args()
    set_seeds(cfg.seed)

    out_dir = Path(cfg.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    sessions = build_sessions(cfg)
    # Split by user for cross-user evaluation (scenario C).
    users = sorted({s.user for s in sessions if not s.is_bot})
    rng = random.Random(cfg.seed)
    rng.shuffle(users)
    n_test = max(1, len(users) // 5)
    test_users = set(users[:n_test])
    train_sessions = [s for s in sessions if s.user not in test_users]
    test_sessions = [s for s in sessions if s.user in test_users]

    train_ds = KeystrokeWindowsDataset(train_sessions, window_size=cfg.window_size, stride=128)
    test_ds = KeystrokeWindowsDataset(test_sessions, window_size=cfg.window_size, stride=128)
    print(f"[bpas-ksv2] windows train/test = {len(train_ds)}/{len(test_ds)}")

    (out_dir / "dataset_hashes.json").write_text(
        json.dumps({"train": train_ds.dataset_hash(), "test": test_ds.dataset_hash()}, indent=2)
    )

    train_loader = DataLoader(train_ds, batch_size=cfg.batch, shuffle=True, drop_last=True)
    test_loader = DataLoader(test_ds, batch_size=cfg.batch, shuffle=False)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = KeystrokeV2(KsV2Config(max_seq_len=cfg.window_size)).to(device)
    print(f"[bpas-ksv2] parameters = {model.count_parameters():,}")

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.epochs)

    history: list[dict] = []
    best_eer = float("inf")
    best_state = None

    for epoch in range(cfg.epochs):
        t0 = time.time()
        train_stats = run_epoch(model, train_loader, opt, cfg, device)
        test_biom = eer_on_embeddings(model, test_loader, device)
        dt = time.time() - t0
        history.append({"epoch": epoch, "train": train_stats, "test": test_biom, "secs": dt})
        print(
            f"[epoch {epoch:02d}] "
            f"loss={train_stats['loss']:.4f} "
            f"bot={train_stats['bot']:.4f} "
            f"duress={train_stats['duress']:.4f} "
            f"cal={train_stats['cal']:.4f} "
            f"test_eer={test_biom.get('eer', float('nan')):.4f} "
            f"({dt:.1f}s)"
        )
        if test_biom.get("eer", float("inf")) < best_eer:
            best_eer = test_biom["eer"]
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        sched.step()

    if best_state is not None:
        model.load_state_dict(best_state)

    weights_path = out_dir / "keystroke_v2_best.pt"
    torch.save(model.state_dict(), weights_path)
    weights_hash = hashlib.sha256(weights_path.read_bytes()).hexdigest()

    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": "2.0.0",
                "config": asdict(cfg),
                "parameters": model.count_parameters(),
                "weights_hash_sha256": weights_hash,
                "best_test_eer": best_eer,
                "history": history[-20:],
            },
            indent=2,
        )
    )
    print(f"[bpas-ksv2] manifest written to {out_dir/'manifest.json'}")


if __name__ == "__main__":
    main()
