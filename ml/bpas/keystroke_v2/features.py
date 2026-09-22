"""Keystroke v2 feature engineering.

Each key event is encoded into a 72-D token by concatenating:

    [  0..64)  keycode embedding (lookup, trained jointly)
    [ 64..65)  flight_time / 250 ms
    [ 65..66)  hold_time / 250 ms
    [ 66..67)  is_modifier   (Shift / Ctrl / Alt / Meta)
    [ 67..68)  is_correction (Backspace / Delete)
    [ 68..69)  dwell_zscore_user
    [ 69..70)  digram_freq_log
    [ 70..71)  session_position_norm
    [ 71..72)  reserved (zero)

The keycode lookup is implemented in the model itself via ``nn.Embedding``;
this module provides only the *scalar* feature vector that gets concatenated
to that embedding.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


# 8 scalar features (the 64-D keycode embedding lives in the model).
SCALAR_FEAT_DIM = 8
# Modifier codes on X11 / Linux evdev (KEY_*):
_MODIFIER_CODES: frozenset[int] = frozenset({29, 42, 54, 56, 97, 100, 125, 126})
# Correction keys: BACKSPACE(14), DELETE(111).
_CORRECTION_CODES: frozenset[int] = frozenset({14, 111})


@dataclass
class KeyEvent:
    """Single keyboard event."""

    keycode: int
    down_ts_ms: float
    up_ts_ms: float


def is_modifier(code: int) -> bool:
    """Return True for Shift / Ctrl / Alt / Meta and friends."""
    return code in _MODIFIER_CODES


def is_correction(code: int) -> bool:
    """Return True for Backspace / Delete."""
    return code in _CORRECTION_CODES


def build_scalar_features(
    events: list[KeyEvent],
    user_dwell_mean: float,
    user_dwell_std: float,
    digram_log_freq: dict[tuple[int, int], float],
) -> np.ndarray:
    """Return the per-event scalar feature matrix of shape (T, 8).

    - flight_time and hold_time are clipped to [0, 1000] ms and divided by 250
    - dwell_zscore_user uses the *user's* baseline, not the dataset average
    - digram_log_freq is the log-frequency of the (prev_keycode, keycode)
      digram in the user's baseline corpus (missing → mean - 1.0)

    Every scalar ends up in a roughly unit-scale range, which lets the
    downstream layer-norm do its job cleanly.
    """
    n = len(events)
    out = np.zeros((n, SCALAR_FEAT_DIM), dtype=np.float32)
    if n == 0:
        return out

    prev_up: float | None = None
    prev_code: int | None = None
    mean_freq = float(np.mean(list(digram_log_freq.values()))) if digram_log_freq else 0.0
    default_freq = mean_freq - 1.0  # fall-back for unknown digrams

    for i, ev in enumerate(events):
        hold = max(0.0, min(ev.up_ts_ms - ev.down_ts_ms, 1000.0))
        flight = 0.0 if prev_up is None else max(0.0, min(ev.down_ts_ms - prev_up, 1000.0))
        out[i, 0] = flight / 250.0
        out[i, 1] = hold / 250.0
        out[i, 2] = 1.0 if is_modifier(ev.keycode) else 0.0
        out[i, 3] = 1.0 if is_correction(ev.keycode) else 0.0

        # Dwell z-score against the user's own baseline.
        if user_dwell_std > 1e-6:
            out[i, 4] = float((hold - user_dwell_mean) / user_dwell_std)
        else:
            out[i, 4] = 0.0

        # Digram log-freq (or default for unseen).
        if prev_code is not None:
            out[i, 5] = digram_log_freq.get((prev_code, ev.keycode), default_freq)
        else:
            out[i, 5] = default_freq

        out[i, 6] = float(i) / max(n - 1, 1)
        # out[i, 7] reserved (kept 0)

        prev_up = ev.up_ts_ms
        prev_code = ev.keycode

    return out


def pack_tokens(
    keycodes: np.ndarray, scalars: np.ndarray, max_len: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pad or truncate to ``max_len`` tokens.

    Returns ``(keycodes, scalars, attention_mask)`` with shapes
    ``(max_len,)``, ``(max_len, 8)`` and ``(max_len,)`` respectively.
    """
    n = len(keycodes)
    if n >= max_len:
        kc = keycodes[-max_len:]
        sc = scalars[-max_len:]
        mask = np.ones(max_len, dtype=np.int64)
    else:
        pad = max_len - n
        kc = np.concatenate([np.zeros(pad, dtype=keycodes.dtype), keycodes])
        sc = np.concatenate([np.zeros((pad, SCALAR_FEAT_DIM), dtype=scalars.dtype), scalars], axis=0)
        mask = np.concatenate([np.zeros(pad, dtype=np.int64), np.ones(n, dtype=np.int64)])
    return kc, sc, mask


def digram_log_freq_from_events(events: list[KeyEvent]) -> dict[tuple[int, int], float]:
    """Compute log(count / total) for each ``(prev, cur)`` digram."""
    counts: dict[tuple[int, int], int] = {}
    total = 0
    prev: int | None = None
    for ev in events:
        if prev is not None:
            key = (prev, ev.keycode)
            counts[key] = counts.get(key, 0) + 1
            total += 1
        prev = ev.keycode
    if total == 0:
        return {}
    return {k: math.log(v / total) for k, v in counts.items()}
