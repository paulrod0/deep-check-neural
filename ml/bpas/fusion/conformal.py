"""Split conformal prediction layer for BPAS.

For each role R, we maintain:
  - A calibration set of non-conformity scores α_i = 1 - p_i (legitimate).
  - A miscoverage level α_R (e.g. 0.01 for high-trust roles, 0.05 for general).
  - A threshold q = finite-sample quantile of (α_i).

At inference time:
  - If p(x) ≥ 1 - q → "legitimate"
  - If p(x) ≤ q     → "impostor"
  - else            → "uncertain"

The finite-sample correction guarantees coverage ≥ 1 - α independently of the
underlying model — as long as the calibration data is exchangeable with the
test data (which we enforce by refreshing the calibration set on drift).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ConformalRole:
    """Per-role conformal configuration."""

    alpha: float
    calibration_nonconformity: np.ndarray  # shape (n_cal,)

    @property
    def threshold(self) -> float:
        """Current finite-sample quantile q."""
        n = len(self.calibration_nonconformity)
        if n == 0:
            return 0.5
        k = int(np.ceil((n + 1) * (1 - self.alpha)))
        k = max(1, min(k, n))
        return float(np.sort(self.calibration_nonconformity)[k - 1])

    def decide(self, prob: float) -> str:
        """Return ``"legitimate"``, ``"impostor"`` or ``"uncertain"``."""
        q = self.threshold
        if prob >= 1.0 - q:
            return "legitimate"
        if prob <= q:
            return "impostor"
        return "uncertain"


class RolePolicy:
    """Registry of per-role conformal layers."""

    def __init__(self) -> None:
        self.roles: dict[str, ConformalRole] = {}

    def register(
        self, role: str, calibration_probs: np.ndarray, alpha: float
    ) -> None:
        """Fit or refresh the calibration for a role.

        ``calibration_probs`` are probabilities assigned by the ensemble to
        *genuine* sessions of operators in this role.
        """
        noncon = 1.0 - np.asarray(calibration_probs, dtype=np.float64)
        self.roles[role] = ConformalRole(
            alpha=alpha, calibration_nonconformity=noncon
        )

    def decide(self, role: str, prob: float) -> str:
        """Decide for a given role; unknown roles fall back to 'general'."""
        conf = self.roles.get(role) or self.roles.get("general")
        if conf is None:
            raise KeyError(f"no conformal layer registered for role={role!r}")
        return conf.decide(prob)

    def coverage_check(self, role: str, probs: np.ndarray, labels: np.ndarray) -> dict:
        """Report empirical coverage vs. the nominal 1-α target."""
        conf = self.roles[role]
        decisions = np.array([conf.decide(float(p)) for p in probs])
        covered = (
            ((decisions == "legitimate") & (labels == 1))
            | ((decisions == "impostor") & (labels == 0))
        )
        return {
            "role": role,
            "alpha": conf.alpha,
            "target_coverage": 1.0 - conf.alpha,
            "empirical_coverage": float(covered.mean()),
            "n": len(probs),
            "uncertain_rate": float((decisions == "uncertain").mean()),
        }
