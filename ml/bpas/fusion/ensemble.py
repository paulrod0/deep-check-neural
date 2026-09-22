"""Bayesian logit-space ensemble with per-modality isotonic calibration.

Given raw logits ``ℓ_k(x_k)`` produced by each modality (keystroke, mouse,
operational VAE, stylometry, facial delta), the fused probability is:

    p(legít | x) = σ( Σ_k w_k · logit(isotonic_k(σ(ℓ_k))) + b )

where:
  - ``isotonic_k`` is a monotone calibrator fit on validation data
  - ``w_k`` is learned by minimising Brier score on the simplex via
    projected gradient (SLSQP via scipy is not needed; we use a lightweight
    FISTA-like projected-gradient routine).
  - ``b`` is a role-specific bias.

The final conformal layer on top turns probabilities into {legitimate,
impostor, uncertain} decisions with a formal coverage guarantee (see
``conformal.py``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..common.metrics import (
    biometric_report,
    brier_score,
    expected_calibration_error,
)
from .conformal import RolePolicy
from .isotonic import IsotonicCalibrator


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def sigmoid(x: np.ndarray) -> np.ndarray:
    """Numerically-stable sigmoid."""
    out = np.empty_like(x, dtype=np.float64)
    pos = x >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-x[pos]))
    neg = ~pos
    ex = np.exp(x[neg])
    out[neg] = ex / (1.0 + ex)
    return out


def logit(p: np.ndarray, eps: float = 1e-6, clip: float = 20.0) -> np.ndarray:
    """Inverse sigmoid with edge clipping on both input and output.

    We clip the output logit to ``±clip`` because isotonic outputs can be
    exactly 0 or 1 after quantisation, and a subsequent matmul with
    potentially-large logits would otherwise overflow for exotic inputs.
    ``±20`` is well beyond the usable dynamic range (σ(20) ≈ 1 - 2e-9) so
    the clip is numerically invisible in healthy cases.
    """
    p = np.clip(p, eps, 1 - eps)
    raw = np.log(p / (1 - p))
    return np.clip(raw, -clip, clip)


def project_simplex(v: np.ndarray) -> np.ndarray:
    """Project onto the probability simplex {w ≥ 0, Σw = 1}.

    Follows Duchi et al. 2008.
    """
    n = len(v)
    u = np.sort(v)[::-1]
    cssv = np.cumsum(u) - 1
    rho = np.nonzero(u - cssv / (np.arange(1, n + 1)) > 0)[0]
    if len(rho) == 0:
        return np.full_like(v, 1.0 / n)
    rho = rho[-1]
    theta = cssv[rho] / (rho + 1)
    return np.maximum(v - theta, 0)


# --------------------------------------------------------------------------- #
# Ensemble
# --------------------------------------------------------------------------- #

@dataclass
class EnsembleState:
    """Serialisable ensemble parameters."""

    modalities: list[str]
    weights: list[float]
    bias: float
    isotonic: dict[str, dict]  # per-modality isotonic knots

    def to_dict(self) -> dict:
        """Return a JSON-safe representation."""
        return {
            "modalities": self.modalities,
            "weights": self.weights,
            "bias": self.bias,
            "isotonic": self.isotonic,
        }


class BayesianLogitEnsemble:
    """Bayesian logit-space fusion trained via projected gradient on Brier."""

    def __init__(self, modalities: list[str]):
        self.modalities = modalities
        self.isotonic: dict[str, IsotonicCalibrator] = {}
        self.weights: np.ndarray = np.full(
            len(modalities), 1.0 / len(modalities), dtype=np.float64
        )
        self.bias: float = 0.0

    def fit_calibration(
        self, modality_probs: dict[str, np.ndarray], labels: np.ndarray
    ) -> None:
        """Fit one isotonic calibrator per modality."""
        for m in self.modalities:
            probs = np.asarray(modality_probs[m], dtype=np.float64)
            self.isotonic[m] = IsotonicCalibrator.fit(probs, labels)

    def _fused_logits(self, modality_probs: dict[str, np.ndarray]) -> np.ndarray:
        """Compute Σ w_k · logit(isotonic(p_k)) for a batch.

        The matmul runs under ``np.errstate(divide='ignore', invalid='ignore',
        over='ignore')`` because some numpy BLAS backends set the FPU
        divide-by-zero flag during internal computation even when the final
        result is finite; the values are already clipped inside ``logit``.
        """
        stacked = np.stack(
            [
                logit(self.isotonic[m].predict(np.asarray(modality_probs[m], dtype=np.float64)))
                for m in self.modalities
            ],
            axis=1,
        )  # shape (N, K)
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            return stacked @ self.weights + self.bias

    def predict_proba(self, modality_probs: dict[str, np.ndarray]) -> np.ndarray:
        """Return fused probabilities p(legitimate | x)."""
        return sigmoid(self._fused_logits(modality_probs))

    def fit_weights(
        self,
        modality_probs: dict[str, np.ndarray],
        labels: np.ndarray,
        *,
        lr: float = 0.05,
        n_iter: int = 500,
    ) -> list[float]:
        """Optimise weights on the simplex by minimising Brier score.

        Returns a list of Brier scores per iteration.
        """
        labels = np.asarray(labels, dtype=np.float64)
        stacked = np.stack(
            [
                logit(self.isotonic[m].predict(np.asarray(modality_probs[m], dtype=np.float64)))
                for m in self.modalities
            ],
            axis=1,
        )

        history: list[float] = []
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            for _ in range(n_iter):
                fused = stacked @ self.weights + self.bias
                p = sigmoid(fused)
                err = p - labels
                # d(Brier)/d(logit) = 2·err·σ(1-σ)
                dldl = 2 * err * p * (1 - p)
                grad_w = stacked.T @ dldl / len(labels)
                grad_b = float(dldl.mean())
                self.weights = project_simplex(self.weights - lr * grad_w)
                self.bias -= lr * grad_b
                history.append(brier_score(p, labels))
        return history

    def state(self) -> EnsembleState:
        """Export ensemble parameters in JSON-serialisable form."""
        return EnsembleState(
            modalities=self.modalities,
            weights=self.weights.tolist(),
            bias=self.bias,
            isotonic={m: self.isotonic[m].to_dict() for m in self.modalities},
        )

    @classmethod
    def from_state(cls, state: EnsembleState) -> "BayesianLogitEnsemble":
        """Inverse of ``state``."""
        inst = cls(state.modalities)
        inst.weights = np.array(state.weights, dtype=np.float64)
        inst.bias = float(state.bias)
        inst.isotonic = {
            m: IsotonicCalibrator.from_dict(d) for m, d in state.isotonic.items()
        }
        return inst


# --------------------------------------------------------------------------- #
# CLI entry point for training on per-modality output JSON
# --------------------------------------------------------------------------- #

def parse_args() -> argparse.Namespace:
    """CLI wrapper."""
    p = argparse.ArgumentParser(
        description="Train the BPAS fusion ensemble on per-modality outputs"
    )
    p.add_argument(
        "--inputs",
        required=True,
        help="JSON file: {modality: {scores_val: [...], scores_test: [...], labels_val: [...], labels_test: [...]}}",
    )
    p.add_argument("--out", required=True, help="Output directory")
    p.add_argument(
        "--roles-alpha",
        default='{"general": 0.05, "command": 0.01, "scif": 0.005}',
        help="JSON mapping of role → miscoverage α for conformal layer",
    )
    p.add_argument("--lr", type=float, default=0.05)
    p.add_argument("--iter", type=int, default=500)
    return p.parse_args()


def main() -> None:
    """Train the fusion layer and write the calibrated bundle."""
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    data = json.loads(Path(args.inputs).read_text())
    modalities = sorted(data.keys())

    # Validation split for fitting weights + isotonic.
    mod_probs_val: dict[str, np.ndarray] = {}
    mod_probs_test: dict[str, np.ndarray] = {}
    labels_val = np.array(data[modalities[0]]["labels_val"], dtype=np.float64)
    labels_test = np.array(data[modalities[0]]["labels_test"], dtype=np.float64)

    for m in modalities:
        mod_probs_val[m] = np.asarray(data[m]["scores_val"], dtype=np.float64)
        mod_probs_test[m] = np.asarray(data[m]["scores_test"], dtype=np.float64)

    ensemble = BayesianLogitEnsemble(modalities)
    ensemble.fit_calibration(mod_probs_val, labels_val)
    history = ensemble.fit_weights(mod_probs_val, labels_val, lr=args.lr, n_iter=args.iter)

    probs_test = ensemble.predict_proba(mod_probs_test)
    report = biometric_report(
        scores_genuine=probs_test[labels_test == 1],
        scores_impostor=probs_test[labels_test == 0],
        probs=probs_test,
        labels=labels_test,
    )
    report_dict = report.to_dict()
    report_dict["ece"] = expected_calibration_error(probs_test, labels_test)

    print(f"[bpas-fusion] weights = {ensemble.weights.tolist()}")
    print(f"[bpas-fusion] bias = {ensemble.bias:.4f}")
    print(f"[bpas-fusion] test = {json.dumps(report_dict, indent=2)}")

    # Conformal layer with per-role α.
    roles_alpha = json.loads(args.roles_alpha)
    policy = RolePolicy()
    # Use genuine validation samples as calibration set.
    gen_val = ensemble.predict_proba(mod_probs_val)[labels_val == 1]
    for role, alpha in roles_alpha.items():
        policy.register(role, gen_val, alpha=float(alpha))

    ensemble_state = ensemble.state().to_dict()
    bundle = {
        "version": "1.0.0",
        "ensemble": ensemble_state,
        "conformal": {
            role: {
                "alpha": conf.alpha,
                "calibration_nonconformity": conf.calibration_nonconformity.tolist(),
            }
            for role, conf in policy.roles.items()
        },
        "training_history": history[-50:],  # tail only
        "test_report": report_dict,
    }
    bundle_path = out_dir / "bpas_ensemble.json"
    bundle_path.write_text(json.dumps(bundle, indent=2))

    h = hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": "1.0.0",
                "bundle_hash_sha256": h,
                "modalities": modalities,
                "test_report": report_dict,
            },
            indent=2,
        )
    )
    print(f"[bpas-fusion] bundle written to {bundle_path}")


if __name__ == "__main__":
    main()
