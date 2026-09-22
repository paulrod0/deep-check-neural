"""Dataset wrapper for the mouse-dynamics TCN.

Reads per-user CSVs of shape (timestamp, dx, dy) and yields pre-computed
feature windows alongside the user ID and a bot label.

Splits strictly by user — no user appears in both train and test — so all
reported metrics measure cross-user generalisation (ISO 19795-1 scenario C).
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .features import WINDOW_SIZE, MouseSample, sliding_windows


@dataclass
class UserSplit:
    """User-level train/val/test assignment."""

    train: list[str]
    val: list[str]
    test: list[str]

    def assignment_for(self, user_id: str) -> str:
        """Return ``"train"``, ``"val"``, ``"test"`` or raise."""
        if user_id in self.train:
            return "train"
        if user_id in self.val:
            return "val"
        if user_id in self.test:
            return "test"
        raise KeyError(f"user {user_id} not in any split")


def make_split(
    users: list[str], val_frac: float = 0.1, test_frac: float = 0.2, seed: int = 42
) -> UserSplit:
    """Reproducible leave-groups-out split at the user level."""
    rng = random.Random(seed)
    users = sorted(users)
    rng.shuffle(users)
    n = len(users)
    n_val = int(n * val_frac)
    n_test = int(n * test_frac)
    val = users[:n_val]
    test = users[n_val : n_val + n_test]
    train = users[n_val + n_test :]
    return UserSplit(train=train, val=val, test=test)


class MouseWindowsDataset(Dataset):
    """In-memory mouse-windows dataset.

    For large corpora, switch to a streaming variant — not required at
    Balabit / CMU scale (≤ 100 K windows).
    """

    def __init__(
        self,
        windows: list[np.ndarray],
        user_ids: list[str],
        bot_labels: list[int],
    ):
        if not (len(windows) == len(user_ids) == len(bot_labels)):
            raise ValueError("windows / user_ids / bot_labels length mismatch")
        self.windows = windows
        self.user_ids = user_ids
        self.bot_labels = bot_labels
        self._vocab: dict[str, int] = {}
        for u in user_ids:
            self._vocab.setdefault(u, len(self._vocab))

    def __len__(self) -> int:
        return len(self.windows)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor | int]:
        return {
            "x": torch.from_numpy(self.windows[idx]),
            "user_idx": self._vocab[self.user_ids[idx]],
            "bot": torch.tensor(self.bot_labels[idx], dtype=torch.float32),
        }

    @property
    def vocab_size(self) -> int:
        """Number of distinct users in this dataset."""
        return len(self._vocab)

    def dataset_hash(self) -> str:
        """Deterministic SHA-256 of the stored windows, for reproducibility."""
        h = hashlib.sha256()
        for w in self.windows:
            h.update(w.tobytes())
        for u in self.user_ids:
            h.update(u.encode())
        for b in self.bot_labels:
            h.update(bytes([b]))
        return h.hexdigest()


def load_balabit(path: Path, users_to_load: list[str] | None = None) -> MouseWindowsDataset:
    """Parse the Balabit Mouse Dynamics corpus into feature windows.

    Expects ``path/<user_id>/session_*.csv`` with columns
    ``record timestamp,client timestamp,button,state,x,y``.
    """
    windows: list[np.ndarray] = []
    user_ids: list[str] = []
    bot_labels: list[int] = []

    user_dirs = sorted(p for p in path.iterdir() if p.is_dir())
    if users_to_load is not None:
        allowed = set(users_to_load)
        user_dirs = [p for p in user_dirs if p.name in allowed]

    for user_dir in user_dirs:
        user_id = user_dir.name
        for session_csv in sorted(user_dir.glob("*.csv")):
            samples = _parse_session(session_csv)
            if len(samples) < WINDOW_SIZE:
                continue
            for w in sliding_windows(samples):
                windows.append(w)
                user_ids.append(user_id)
                bot_labels.append(0)

    return MouseWindowsDataset(windows, user_ids, bot_labels)


def _parse_session(csv_path: Path) -> list[MouseSample]:
    """Convert raw Balabit rows into decimated 50 Hz samples."""
    prev_t: float | None = None
    prev_x: float | None = None
    prev_y: float | None = None
    out: list[MouseSample] = []

    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                t = float(row["client timestamp"])
                x = float(row["x"])
                y = float(row["y"])
            except (KeyError, ValueError):
                continue
            if prev_t is None:
                prev_t, prev_x, prev_y = t, x, y
                continue
            dt_ms = max((t - prev_t) * 1000.0, 1.0)
            dx = x - prev_x if prev_x is not None else 0.0
            dy = y - prev_y if prev_y is not None else 0.0
            out.append(MouseSample(dx=dx, dy=dy, dt_ms=dt_ms))
            prev_t, prev_x, prev_y = t, x, y
    return _decimate(out)


def _decimate(samples: list[MouseSample], target_hz: float = 50.0) -> list[MouseSample]:
    """Integrate samples into target-rate buckets (approximate decimation)."""
    target_dt_ms = 1000.0 / target_hz
    out: list[MouseSample] = []
    acc_dx = 0.0
    acc_dy = 0.0
    acc_dt = 0.0
    for s in samples:
        acc_dx += s.dx
        acc_dy += s.dy
        acc_dt += s.dt_ms
        if acc_dt >= target_dt_ms:
            out.append(MouseSample(dx=acc_dx, dy=acc_dy, dt_ms=acc_dt))
            acc_dx = 0.0
            acc_dy = 0.0
            acc_dt = 0.0
    return out


def save_split(split: UserSplit, path: Path) -> None:
    """Serialise a ``UserSplit`` to JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"train": split.train, "val": split.val, "test": split.test},
            indent=2,
        )
    )


def load_split(path: Path) -> UserSplit:
    """Load a previously saved split."""
    data = json.loads(path.read_text())
    return UserSplit(train=data["train"], val=data["val"], test=data["test"])
