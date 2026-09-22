"""Pool-Adjacent-Violators isotonic regression.

Used for per-modality calibration of raw logits to monotone probabilities.
Dependency-free implementation so the fusion layer can run on a stripped-down
Python environment (no scikit-learn) on the inference worker.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class IsotonicCalibrator:
    """Piecewise-constant monotone mapping ``x -> y_iso``."""

    x_knots: np.ndarray
    y_knots: np.ndarray

    @classmethod
    def fit(cls, x: np.ndarray, y: np.ndarray, sample_weight: np.ndarray | None = None) -> "IsotonicCalibrator":
        """Fit isotonic regression via PAV.

        ``x`` are raw scores (logits). ``y`` are 0/1 labels. ``sample_weight``
        can up- or down-weight individual samples (default uniform).
        """
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        if sample_weight is None:
            sample_weight = np.ones_like(x)
        else:
            sample_weight = np.asarray(sample_weight, dtype=np.float64)
        order = np.argsort(x, kind="stable")
        xs = x[order]
        ys = y[order]
        ws = sample_weight[order]

        # PAV
        values = ys.copy()
        weights = ws.copy()
        index = list(range(len(xs)))  # pointer to the first element of each block

        i = 0
        while i < len(values) - 1:
            if values[i] <= values[i + 1]:
                i += 1
                continue
            # Merge block i+1 into block i
            w_new = weights[i] + weights[i + 1]
            v_new = (values[i] * weights[i] + values[i + 1] * weights[i + 1]) / w_new
            values[i] = v_new
            weights[i] = w_new
            # Shift everything left
            values = np.delete(values, i + 1)
            weights = np.delete(weights, i + 1)
            index.pop(i + 1)
            if i > 0:
                i -= 1

        # Reconstruct step function aligned with original xs.
        y_knots = np.empty_like(xs)
        for k, start_idx in enumerate(index):
            end_idx = index[k + 1] if k + 1 < len(index) else len(xs)
            y_knots[start_idx:end_idx] = values[k]
        # Clip to [0, 1] to be safe.
        y_knots = np.clip(y_knots, 0.0, 1.0)
        return cls(x_knots=xs, y_knots=y_knots)

    def predict(self, x: np.ndarray) -> np.ndarray:
        """Apply the fitted mapping (piecewise-constant, right-continuous)."""
        x = np.asarray(x, dtype=np.float64)
        # Find the largest knot <= each x.
        idx = np.searchsorted(self.x_knots, x, side="right") - 1
        idx = np.clip(idx, 0, len(self.y_knots) - 1)
        return self.y_knots[idx]

    def to_dict(self) -> dict:
        """JSON-serialisable representation."""
        return {
            "x_knots": self.x_knots.tolist(),
            "y_knots": self.y_knots.tolist(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "IsotonicCalibrator":
        """Inverse of ``to_dict``."""
        return cls(
            x_knots=np.array(data["x_knots"], dtype=np.float64),
            y_knots=np.array(data["y_knots"], dtype=np.float64),
        )
