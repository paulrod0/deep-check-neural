"""Dataset utilities for keystroke v2 training.

Handles:
  - Aalto 136M-events corpus (CSV rows ``participant, test_section, keycode,
    press_time, release_time``)
  - Buffalo / CMU style CSVs
  - Synthetic duress sequences (slow, erratic timing for the Head C label)

All loaders emit ``KeystrokeSession`` records that the training script can
window and batch uniformly.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .features import (
    SCALAR_FEAT_DIM,
    KeyEvent,
    build_scalar_features,
    digram_log_freq_from_events,
    pack_tokens,
)


@dataclass
class KeystrokeSession:
    """Raw events of one user's session."""

    user: str
    events: list[KeyEvent]
    is_bot: bool = False
    is_duress: bool = False
    is_drift: bool = False
    meta: dict = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Loaders
# --------------------------------------------------------------------------- #

def load_aalto_csv(path: Path, max_users: int | None = None) -> list[KeystrokeSession]:
    """Parse a flattened Aalto CSV.

    Expected columns: ``participant``, ``keycode``, ``press_time``, ``release_time``,
    ``test_section``. Timestamps are in milliseconds.
    """
    sessions_map: dict[tuple[str, str], list[KeyEvent]] = {}
    with path.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                user = row["participant"]
                sec = row.get("test_section", "default")
                code = int(row["keycode"])
                down = float(row["press_time"])
                up = float(row["release_time"])
            except (KeyError, ValueError):
                continue
            key = (user, sec)
            sessions_map.setdefault(key, []).append(
                KeyEvent(keycode=code, down_ts_ms=down, up_ts_ms=up)
            )

    sessions = [
        KeystrokeSession(user=u, events=sorted(evs, key=lambda e: e.down_ts_ms))
        for (u, _), evs in sessions_map.items()
    ]
    if max_users is not None:
        users_kept: set[str] = set()
        out: list[KeystrokeSession] = []
        for s in sessions:
            if s.user not in users_kept and len(users_kept) >= max_users:
                continue
            users_kept.add(s.user)
            out.append(s)
        sessions = out
    return sessions


def synth_bot_sessions(n: int, seq_len: int = 200, seed: int = 1) -> list[KeystrokeSession]:
    """Generate synthetic keystroke sequences with bot-like timing.

    Bots are characterised by:
      - Very regular flight times (low jitter)
      - No corrections
      - Uniform distribution over the keycode vocabulary (no English-text bias)
    """
    rng = random.Random(seed)
    out: list[KeystrokeSession] = []
    for i in range(n):
        t = 0.0
        flight = rng.uniform(50, 150)  # almost constant within session
        hold = rng.uniform(40, 80)
        events: list[KeyEvent] = []
        for _ in range(seq_len):
            t += flight + rng.gauss(0, 2)
            events.append(
                KeyEvent(
                    keycode=rng.randint(16, 50),  # a-z evdev range
                    down_ts_ms=t,
                    up_ts_ms=t + hold + rng.gauss(0, 1),
                )
            )
        out.append(
            KeystrokeSession(
                user=f"bot_{i}",
                events=events,
                is_bot=True,
            )
        )
    return out


def synth_duress_sessions(
    base: list[KeystrokeSession], rate: float = 0.15, seed: int = 2
) -> list[KeystrokeSession]:
    """Derive duress sessions from legitimate ones.

    Models coercion/stress as:
      - 2-3× longer flight times (hesitation)
      - More corrections (Backspace)
      - Higher variance in hold times
    """
    rng = random.Random(seed)
    out: list[KeystrokeSession] = []
    for s in base:
        if rng.random() > rate:
            continue
        new_events: list[KeyEvent] = []
        prev_up: float | None = None
        for ev in s.events:
            flight_orig = 0 if prev_up is None else ev.down_ts_ms - prev_up
            flight_new = flight_orig * rng.uniform(1.8, 3.2)
            hold_new = (ev.up_ts_ms - ev.down_ts_ms) * rng.uniform(0.7, 1.6)
            down = (new_events[-1].up_ts_ms if new_events else ev.down_ts_ms) + flight_new
            up = down + hold_new
            new_events.append(KeyEvent(keycode=ev.keycode, down_ts_ms=down, up_ts_ms=up))
            # 10% chance of an extra backspace correction.
            if rng.random() < 0.1:
                bdown = up + rng.uniform(80, 200)
                bup = bdown + rng.uniform(40, 80)
                new_events.append(
                    KeyEvent(keycode=14, down_ts_ms=bdown, up_ts_ms=bup)  # BACKSPACE
                )
            prev_up = new_events[-1].up_ts_ms
        out.append(
            KeystrokeSession(
                user=s.user,
                events=new_events,
                is_duress=True,
            )
        )
    return out


def synthesise_offline_corpus(
    n_users: int = 40, seq_len: int = 300, seed: int = 123
) -> list[KeystrokeSession]:
    """Offline smoke corpus — used only for local tests without Aalto/CMU."""
    rng = random.Random(seed)
    out: list[KeystrokeSession] = []
    for u in range(n_users):
        # Each user has their own flight / hold distributions.
        flight_mu = rng.uniform(80, 200)
        hold_mu = rng.uniform(50, 120)
        events: list[KeyEvent] = []
        t = 0.0
        for _ in range(seq_len):
            t += max(30, rng.gauss(flight_mu, flight_mu * 0.15))
            hold = max(15, rng.gauss(hold_mu, hold_mu * 0.15))
            events.append(
                KeyEvent(
                    keycode=rng.randint(16, 50),
                    down_ts_ms=t,
                    up_ts_ms=t + hold,
                )
            )
        out.append(KeystrokeSession(user=f"user_{u:03d}", events=events))
    return out


# --------------------------------------------------------------------------- #
# Torch dataset
# --------------------------------------------------------------------------- #

class KeystrokeWindowsDataset(Dataset):
    """Windowed keystroke dataset."""

    def __init__(
        self,
        sessions: list[KeystrokeSession],
        window_size: int = 256,
        stride: int = 128,
    ):
        self.window_size = window_size
        self.user_vocab: dict[str, int] = {}
        self.samples: list[tuple[np.ndarray, np.ndarray, np.ndarray, int, int, int, int]] = []

        for s in sessions:
            self.user_vocab.setdefault(s.user, len(self.user_vocab))
            user_idx = self.user_vocab[s.user]
            # Baseline stats for dwell z-score.
            holds = np.array(
                [e.up_ts_ms - e.down_ts_ms for e in s.events], dtype=np.float64
            )
            dwell_mean = float(holds.mean()) if len(holds) else 0.0
            dwell_std = float(holds.std()) if len(holds) else 1.0
            digrams = digram_log_freq_from_events(s.events)

            codes = np.array([e.keycode for e in s.events], dtype=np.int64)
            scalars = build_scalar_features(s.events, dwell_mean, dwell_std, digrams)

            for start in range(0, max(1, len(codes) - window_size + 1), stride):
                kc_w = codes[start : start + window_size]
                sc_w = scalars[start : start + window_size]
                kc_p, sc_p, mask = pack_tokens(kc_w, sc_w, window_size)
                self.samples.append(
                    (
                        kc_p,
                        sc_p,
                        mask,
                        user_idx,
                        int(s.is_bot),
                        int(s.is_duress),
                        int(s.is_drift),
                    )
                )

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        kc, sc, mask, u, bot, dur, drift = self.samples[idx]
        return {
            "keycodes": torch.from_numpy(kc),
            "scalars": torch.from_numpy(sc),
            "mask": torch.from_numpy(mask),
            "user_idx": torch.tensor(u, dtype=torch.long),
            "bot": torch.tensor(bot, dtype=torch.float32),
            "duress": torch.tensor(dur, dtype=torch.float32),
            "drift": torch.tensor(drift, dtype=torch.float32),
        }

    def dataset_hash(self) -> str:
        """Deterministic hash of all windows for reproducibility."""
        h = hashlib.sha256()
        for kc, sc, m, u, b, d, dr in self.samples:
            h.update(kc.tobytes())
            h.update(sc.tobytes())
            h.update(m.tobytes())
            h.update(bytes([u & 0xFF, b, d, dr]))
        return h.hexdigest()

    def save_vocab(self, path: Path) -> None:
        """Persist the ``user → idx`` vocabulary."""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.user_vocab, indent=2))
