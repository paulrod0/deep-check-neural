"""Feature engineering for mouse-dynamics windows.

Input: a stream of ``(Δx, Δy, Δt)`` tuples in pixel and microsecond units.
Output: a tensor of shape ``(T=250, F=8)`` for a 5-second window at 50 Hz.

The 8 engineered features are:

    [0] velocity          in pixel/ms
    [1] acceleration      derivative of velocity
    [2] jerk              derivative of acceleration
    [3] curvature         |dθ/ds| with θ = atan2(dy, dx)
    [4] direction         θ in radians, normalized to [-1, 1]
    [5] overshoot         signed deviation from the straight line to target
    [6] idle               1 if the mouse is idle over the sample, 0 else
    [7] micro_corrections  count of sign changes in dv/dt within the window

These are deterministic, cheap to compute, and preserve no information that
could be used to reconstruct screen coordinates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


WINDOW_SECONDS = 5.0
SAMPLE_RATE_HZ = 50.0
WINDOW_SIZE = int(WINDOW_SECONDS * SAMPLE_RATE_HZ)  # 250
FEATURE_DIM = 8


@dataclass
class MouseSample:
    """A single decimated mouse sample."""

    dx: float  # pixels
    dy: float  # pixels
    dt_ms: float  # milliseconds since previous sample


def build_window(samples: list[MouseSample]) -> np.ndarray:
    """Compute the (250, 8) feature window from exactly 250 samples.

    Raises ``ValueError`` if the input length is wrong. In real training the
    caller pads or slices upstream.
    """
    if len(samples) != WINDOW_SIZE:
        raise ValueError(f"expected {WINDOW_SIZE} samples, got {len(samples)}")

    dx = np.array([s.dx for s in samples], dtype=np.float64)
    dy = np.array([s.dy for s in samples], dtype=np.float64)
    dt = np.array([max(s.dt_ms, 1e-3) for s in samples], dtype=np.float64)

    # Velocity (pixel / ms)
    step_len = np.sqrt(dx * dx + dy * dy)
    velocity = step_len / dt

    # Acceleration = dv/dt
    accel = np.zeros_like(velocity)
    accel[1:] = (velocity[1:] - velocity[:-1]) / dt[1:]

    # Jerk = da/dt
    jerk = np.zeros_like(velocity)
    jerk[1:] = (accel[1:] - accel[:-1]) / dt[1:]

    # Direction (θ) and its derivative = curvature (rough, not arc-length
    # normalised to keep it robust to sparsely sampled windows).
    theta = np.arctan2(dy, dx)
    dtheta = np.zeros_like(theta)
    dtheta[1:] = _wrap_pi(theta[1:] - theta[:-1])
    curvature = np.abs(dtheta) / (step_len + 1e-3)

    # Overshoot relative to the window-wide net displacement line.
    total_dx = dx.sum()
    total_dy = dy.sum()
    total_len = math.sqrt(total_dx * total_dx + total_dy * total_dy) + 1e-3
    # Projection of each (dx_i, dy_i) onto the total displacement vector.
    proj = (dx * total_dx + dy * total_dy) / total_len
    overshoot = step_len - proj  # positive = deviation from ideal path

    # Idle mask
    idle = (step_len < 0.5).astype(np.float64)

    # Micro-corrections: count of sign changes in accel (sliding cumulative).
    sign_changes = np.zeros_like(velocity)
    sign = np.sign(accel)
    for i in range(1, len(samples)):
        if sign[i] != sign[i - 1] and sign[i] != 0:
            sign_changes[i] = sign_changes[i - 1] + 1
        else:
            sign_changes[i] = sign_changes[i - 1]
    # Normalize to rate per second.
    micro_corr = sign_changes / (np.arange(1, WINDOW_SIZE + 1) / SAMPLE_RATE_HZ)

    # Normalize direction to [-1, 1]
    theta_norm = theta / math.pi

    out = np.stack(
        [
            velocity,
            accel,
            jerk,
            curvature,
            theta_norm,
            overshoot,
            idle,
            micro_corr,
        ],
        axis=-1,
    )
    assert out.shape == (WINDOW_SIZE, FEATURE_DIM)
    return _standardize(out)


def _wrap_pi(angles: np.ndarray) -> np.ndarray:
    """Wrap angular differences into (-π, π]."""
    return (angles + math.pi) % (2 * math.pi) - math.pi


def _standardize(window: np.ndarray) -> np.ndarray:
    """Per-feature z-score within the window.

    Doing it at the window level (rather than dataset-level) means the model
    sees shape information rather than absolute scale, which is what
    generalises across users and input devices.
    """
    mean = window.mean(axis=0, keepdims=True)
    std = window.std(axis=0, keepdims=True) + 1e-6
    return ((window - mean) / std).astype(np.float32)


def sliding_windows(
    samples: list[MouseSample], stride_samples: int = 50
) -> list[np.ndarray]:
    """Yield overlapping windows of size 250 with the given stride."""
    out: list[np.ndarray] = []
    if len(samples) < WINDOW_SIZE:
        return out
    for start in range(0, len(samples) - WINDOW_SIZE + 1, stride_samples):
        out.append(build_window(samples[start : start + WINDOW_SIZE]))
    return out
