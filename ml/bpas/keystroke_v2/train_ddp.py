"""Multi-GPU DDP training for the keystroke v2 Transformer.

Launch with:

    torchrun --nproc_per_node=4 -m ml.bpas.keystroke_v2.train_ddp \
        --data /data/aalto.csv \
        --out /outputs/keystroke_v2 \
        --epochs 30 --batch 64 --lr 3e-4

Notes:
  - Rank 0 is the *only* writer of checkpoints, manifests, and stdout
    progress lines. Other ranks emit logs through Python ``logging`` so
    the orchestration layer can capture them per-rank.
  - We use bfloat16 autocast on Ampere+ GPUs (A10G, A100, H100); on older
    cards the script automatically falls back to float32.
  - The ``DistributedSampler`` shuffles deterministically per epoch so
    training is reproducible across restarts.
"""

import argparse
import hashlib
import json
import logging
import os
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
import torch.distributed as dist
import torch.nn.functional as F
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler

from ..common.metrics import biometric_report
from .dataset import (
    KeystrokeWindowsDataset,
    synth_bot_sessions,
    synth_duress_sessions,
    synthesise_offline_corpus,
)
from .model import KeystrokeV2, KsV2Config
from .train import batch_ece, batch_hard_triplet, infonce_loss


@dataclass
class DdpConfig:
    """Configuration captured in the run manifest."""

    data: str | None
    out: str
    epochs: int = 30
    batch: int = 64
    lr: float = 3e-4
    weight_decay: float = 1e-4
    seed: int = 42
    window_size: int = 256
    triplet_margin: float = 0.4
    infonce_temp: float = 0.1
    duress_pos_weight: float = 3.5
    bf16: bool = True
    grad_accum: int = 1
    synthetic: bool = False


# --------------------------------------------------------------------------- #
# DDP setup helpers
# --------------------------------------------------------------------------- #

def setup_ddp() -> tuple[int, int, int]:
    """Initialise the default process group from torchrun env vars.

    Returns ``(rank, world_size, local_rank)``.
    """
    if not dist.is_available():
        raise RuntimeError("torch.distributed unavailable in this build")
    rank = int(os.environ.get("RANK", "0"))
    world = int(os.environ.get("WORLD_SIZE", "1"))
    local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    backend = "nccl" if torch.cuda.is_available() else "gloo"
    dist.init_process_group(backend=backend, init_method="env://", rank=rank, world_size=world)
    if torch.cuda.is_available():
        torch.cuda.set_device(local_rank)
    return rank, world, local_rank


def cleanup_ddp() -> None:
    """Tear down the default process group on shutdown."""
    if dist.is_initialized():
        dist.destroy_process_group()


def is_main(rank: int) -> bool:
    """Single-source-of-truth for rank-0 gating."""
    return rank == 0


# --------------------------------------------------------------------------- #
# Args
# --------------------------------------------------------------------------- #

def parse_args() -> DdpConfig:
    """CLI wrapper returning a ``DdpConfig``."""
    p = argparse.ArgumentParser(description="DDP training for keystroke v2")
    p.add_argument("--data", default=None, help="Aalto CSV path")
    p.add_argument("--out", required=True)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch", type=int, default=64, help="per-GPU batch size")
    p.add_argument("--grad-accum", type=int, default=1)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--window-size", type=int, default=256)
    p.add_argument("--no-bf16", dest="bf16", action="store_false", default=True)
    p.add_argument("--synthetic", action="store_true")
    args = p.parse_args()
    return DdpConfig(
        data=args.data,
        out=args.out,
        epochs=args.epochs,
        batch=args.batch,
        grad_accum=args.grad_accum,
        lr=args.lr,
        weight_decay=args.weight_decay,
        seed=args.seed,
        window_size=args.window_size,
        bf16=args.bf16,
        synthetic=args.synthetic,
    )


def seed_all(seed: int, rank: int) -> None:
    """Seed every RNG; offset by rank so workers see different shuffling order."""
    base = seed + 1000 * rank
    random.seed(base)
    np.random.seed(base)
    torch.manual_seed(base)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(base)


# --------------------------------------------------------------------------- #
# Datasets
# --------------------------------------------------------------------------- #

def build_sessions(cfg: DdpConfig, rank: int):
    """Assemble a list of ``KeystrokeSession`` records.

    Only rank 0 talks to the disk; the resulting list is broadcast as a
    Python object via ``dist.broadcast_object_list`` so all ranks see the
    same data — and crucially, the same shuffle order before split.
    """
    sessions = None
    if is_main(rank):
        if cfg.synthetic or cfg.data is None:
            sessions = synthesise_offline_corpus(n_users=40, seq_len=600, seed=cfg.seed)
        else:
            from .dataset import load_aalto_csv

            sessions = load_aalto_csv(Path(cfg.data), max_users=200)
            if not sessions:
                raise RuntimeError("no sessions loaded from Aalto CSV")
        sessions += synth_bot_sessions(n=len(sessions) // 10, seq_len=300, seed=cfg.seed + 1)
        sessions += synth_duress_sessions(sessions, rate=0.15, seed=cfg.seed + 2)
        random.Random(cfg.seed).shuffle(sessions)
    container = [sessions]
    dist.broadcast_object_list(container, src=0)
    return container[0]


# --------------------------------------------------------------------------- #
# Train / eval loops
# --------------------------------------------------------------------------- #

def run_epoch_ddp(
    model: DDP,
    loader: DataLoader,
    sampler: DistributedSampler,
    opt: torch.optim.Optimizer | None,
    cfg: DdpConfig,
    device: torch.device,
    rank: int,
    world: int,
    epoch: int,
) -> dict:
    """Run a DDP epoch.

    All loss terms are reduced across ranks via ``all_reduce(SUM)`` for an
    averaged final value that's identical across processes.
    """
    sampler.set_epoch(epoch)
    training = opt is not None
    model.train(training)

    use_amp = cfg.bf16 and torch.cuda.is_available()
    amp_dtype = torch.bfloat16 if use_amp else torch.float32

    totals = torch.zeros(7, device=device)  # loss, trip, infonce, bot, duress, drift, n

    for step, batch in enumerate(loader):
        kc = batch["keycodes"].to(device, non_blocking=True)
        sc = batch["scalars"].to(device, non_blocking=True)
        mask = batch["mask"].to(device, non_blocking=True)
        user_ids = batch["user_idx"].to(device, non_blocking=True)
        bot_label = batch["bot"].to(device, non_blocking=True)
        duress_label = batch["duress"].to(device, non_blocking=True)
        drift_label = batch["drift"].to(device, non_blocking=True)

        with torch.autocast(device_type="cuda" if use_amp else "cpu", dtype=amp_dtype, enabled=use_amp):
            out = model(kc, sc, mask)

            valid = user_ids >= 0
            if valid.any() and user_ids[valid].unique().numel() > 1:
                trip_l = batch_hard_triplet(
                    out["embed"][valid], user_ids[valid], margin=cfg.triplet_margin
                )
                infonce_l = infonce_loss(
                    out["embed"][valid], user_ids[valid], temp=cfg.infonce_temp
                )
            else:
                trip_l = torch.zeros((), device=device, requires_grad=True)
                infonce_l = torch.zeros((), device=device, requires_grad=True)

            bot_l = F.binary_cross_entropy_with_logits(out["bot_logit"], bot_label)
            duress_l = F.binary_cross_entropy_with_logits(
                out["duress_logit"],
                duress_label,
                pos_weight=torch.tensor(cfg.duress_pos_weight, device=device),
            )
            drift_l = F.binary_cross_entropy_with_logits(out["drift_logit"], drift_label)

            cal_l = (
                batch_ece(torch.sigmoid(out["bot_logit"]), bot_label)
                + batch_ece(torch.sigmoid(out["duress_logit"]), duress_label)
                + batch_ece(torch.sigmoid(out["drift_logit"]), drift_label)
            ) / 3.0

            loss = trip_l + 0.5 * infonce_l + 0.3 * bot_l + 0.4 * duress_l + 0.1 * drift_l + 0.1 * cal_l
            loss = loss / cfg.grad_accum

        if training:
            loss.backward()
            if (step + 1) % cfg.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                opt.zero_grad()

        bsz = float(kc.shape[0])
        totals[0] += float(loss.item() * cfg.grad_accum) * bsz
        totals[1] += float(trip_l.item()) * bsz
        totals[2] += float(infonce_l.item()) * bsz
        totals[3] += float(bot_l.item()) * bsz
        totals[4] += float(duress_l.item()) * bsz
        totals[5] += float(drift_l.item()) * bsz
        totals[6] += bsz

    # Reduce sums across ranks.
    dist.all_reduce(totals, op=dist.ReduceOp.SUM)
    n = float(totals[6].item())
    if n == 0.0:
        n = 1.0
    return {
        "loss": float(totals[0].item()) / n,
        "trip": float(totals[1].item()) / n,
        "infonce": float(totals[2].item()) / n,
        "bot": float(totals[3].item()) / n,
        "duress": float(totals[4].item()) / n,
        "drift": float(totals[5].item()) / n,
    }


def eer_on_embeddings_ddp(
    model: DDP,
    loader: DataLoader,
    device: torch.device,
    rank: int,
    world: int,
    max_pairs: int = 50_000,
) -> dict:
    """Gather embeddings on rank 0, compute biometric report there."""
    model.train(False)
    embeds, users = [], []
    with torch.no_grad():
        for batch in loader:
            out = model.module(
                batch["keycodes"].to(device),
                batch["scalars"].to(device),
                batch["mask"].to(device),
            )
            embeds.append(out["embed"].cpu())
            users.append(batch["user_idx"])
    local_embed = torch.cat(embeds, dim=0)
    local_user = torch.cat(users, dim=0)

    # Gather to rank 0.
    sizes = [torch.tensor([0], dtype=torch.long, device=device) for _ in range(world)]
    local_size = torch.tensor([local_embed.shape[0]], dtype=torch.long, device=device)
    dist.all_gather(sizes, local_size)

    if not is_main(rank):
        # Send our chunk and exit — only rank 0 builds the report.
        dist.send(local_embed.to(device), dst=0)
        dist.send(local_user.to(device), dst=0)
        return {}

    all_embeds = [local_embed]
    all_users = [local_user]
    for src in range(1, world):
        n_src = int(sizes[src].item())
        buf_embed = torch.zeros((n_src, local_embed.shape[1]), device=device)
        buf_user = torch.zeros((n_src,), dtype=torch.long, device=device)
        dist.recv(buf_embed, src=src)
        dist.recv(buf_user, src=src)
        all_embeds.append(buf_embed.cpu())
        all_users.append(buf_user.cpu())
    arr = torch.cat(all_embeds, dim=0).numpy()
    user_arr = torch.cat(all_users, dim=0).numpy()

    rng = np.random.default_rng(0)
    n = len(arr)
    genuine, impostor = [], []
    for _ in range(max_pairs):
        i, j = rng.integers(0, n, size=2)
        if i == j:
            continue
        sim = float(np.dot(arr[i], arr[j]))
        (genuine if user_arr[i] == user_arr[j] else impostor).append(sim)
    if not genuine or not impostor:
        return {"eer": float("nan")}
    return biometric_report(np.array(genuine), np.array(impostor)).to_dict()


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> None:
    """Entry point for ``torchrun``."""
    cfg = parse_args()
    rank, world, local_rank = setup_ddp()
    seed_all(cfg.seed, rank)

    device = (
        torch.device(f"cuda:{local_rank}") if torch.cuda.is_available() else torch.device("cpu")
    )

    out_dir = Path(cfg.out)
    if is_main(rank):
        out_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(level=logging.INFO, format="[rank0] %(message)s")
        logging.info(
            "DDP world=%d, device=%s, bf16=%s, params/proc batch=%d", world, device, cfg.bf16, cfg.batch
        )

    sessions = build_sessions(cfg, rank)

    users = sorted({s.user for s in sessions if not s.is_bot})
    rng = random.Random(cfg.seed)
    rng.shuffle(users)
    n_test = max(1, len(users) // 5)
    test_users = set(users[:n_test])
    train_sessions = [s for s in sessions if s.user not in test_users]
    test_sessions = [s for s in sessions if s.user in test_users]

    train_ds = KeystrokeWindowsDataset(train_sessions, window_size=cfg.window_size, stride=128)
    test_ds = KeystrokeWindowsDataset(test_sessions, window_size=cfg.window_size, stride=128)
    if is_main(rank):
        logging.info("windows train/test = %d/%d", len(train_ds), len(test_ds))
        (out_dir / "dataset_hashes.json").write_text(
            json.dumps(
                {"train": train_ds.dataset_hash(), "test": test_ds.dataset_hash()},
                indent=2,
            )
        )

    train_sampler = DistributedSampler(
        train_ds, num_replicas=world, rank=rank, shuffle=True, drop_last=True, seed=cfg.seed
    )
    test_sampler = DistributedSampler(
        test_ds, num_replicas=world, rank=rank, shuffle=False, drop_last=False, seed=cfg.seed
    )
    train_loader = DataLoader(
        train_ds, batch_size=cfg.batch, sampler=train_sampler, num_workers=2, pin_memory=True
    )
    test_loader = DataLoader(
        test_ds, batch_size=cfg.batch, sampler=test_sampler, num_workers=2, pin_memory=True
    )

    model = KeystrokeV2(KsV2Config(max_seq_len=cfg.window_size)).to(device)
    # ``find_unused_parameters=True`` is required because the triplet /
    # InfoNCE losses skip themselves on batches without same-user pairs,
    # which leaves the embedding head temporarily without gradients. With
    # synthetic corpora — and any cold-start window — this happens often.
    # The runtime overhead vs. ``False`` is negligible at this model size.
    if torch.cuda.is_available():
        model = DDP(model, device_ids=[local_rank], find_unused_parameters=True)
    else:
        model = DDP(model, find_unused_parameters=True)
    if is_main(rank):
        n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
        logging.info("model params = %d", n_params)

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.epochs)

    history: list[dict] = []
    best_eer = float("inf")
    best_state = None

    for epoch in range(cfg.epochs):
        t0 = time.time()
        train_stats = run_epoch_ddp(
            model, train_loader, train_sampler, opt, cfg, device, rank, world, epoch
        )
        test_biom = eer_on_embeddings_ddp(model, test_loader, device, rank, world)
        dt = time.time() - t0

        if is_main(rank):
            history.append({"epoch": epoch, "train": train_stats, "test": test_biom, "secs": dt})
            logging.info(
                "epoch=%02d loss=%.4f duress=%.4f bot=%.4f test_eer=%.4f (%.1fs)",
                epoch,
                train_stats["loss"],
                train_stats["duress"],
                train_stats["bot"],
                test_biom.get("eer", float("nan")),
                dt,
            )
            if test_biom.get("eer", float("inf")) < best_eer:
                best_eer = test_biom["eer"]
                best_state = {
                    k: v.detach().cpu().clone() for k, v in model.module.state_dict().items()
                }
        sched.step()

    if is_main(rank) and best_state is not None:
        weights_path = out_dir / "keystroke_v2_best.pt"
        torch.save(best_state, weights_path)
        weights_hash = hashlib.sha256(weights_path.read_bytes()).hexdigest()
        (out_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "version": "2.0.0-ddp",
                    "world_size": world,
                    "config": asdict(cfg),
                    "weights_hash_sha256": weights_hash,
                    "best_test_eer": best_eer,
                    "history": history[-20:],
                },
                indent=2,
            )
        )
        logging.info("manifest written to %s", out_dir / "manifest.json")

    cleanup_ddp()


if __name__ == "__main__":
    main()
