"""Biometric and probabilistic metrics used across BPAS models.

All metrics follow ISO/IEC 19795-1 terminology:
  FAR  = False Acceptance Rate
  FRR  = False Rejection Rate
  EER  = Equal Error Rate (FAR == FRR)
  APCER = Attack Presentation Classification Error Rate
  BPCER = Bona fide Presentation Classification Error Rate
  ACER = (APCER + BPCER) / 2
  ECE  = Expected Calibration Error

Everything is numpy-first and PyTorch-agnostic so the same functions can be
run offline on stored predictions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np


@dataclass
class BiometricReport:
    """Structured biometric evaluation report."""

    eer: float
    eer_threshold: float
    far_at_frr_0_1: float
    frr_at_far_0_01: float
    det_auc: float
    ece: float
    n_bona_fide: int
    n_impostor: int
    per_threshold: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Return a JSON-serialisable representation."""
        return {
            "eer": self.eer,
            "eer_threshold": self.eer_threshold,
            "far_at_frr_0_1": self.far_at_frr_0_1,
            "frr_at_far_0_01": self.frr_at_far_0_01,
            "det_auc": self.det_auc,
            "ece": self.ece,
            "n_bona_fide": self.n_bona_fide,
            "n_impostor": self.n_impostor,
        }


def equal_error_rate(
    scores_genuine: np.ndarray, scores_impostor: np.ndarray
) -> tuple[float, float]:
    """Return (EER, threshold).

    ``scores_genuine`` and ``scores_impostor`` are 1-D arrays of model scores
    where higher = more likely to be the legitimate user. The returned EER is
    in [0, 1].
    """
    scores = np.concatenate([scores_genuine, scores_impostor])
    labels = np.concatenate(
        [np.ones_like(scores_genuine, dtype=np.int8), np.zeros_like(scores_impostor, dtype=np.int8)]
    )
    # Sort descending by score
    order = np.argsort(-scores, kind="stable")
    labels = labels[order]
    scores = scores[order]

    n_pos = int(labels.sum())
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        raise ValueError("Need both positive and negative scores")

    tp = np.cumsum(labels)
    fp = np.cumsum(1 - labels)
    frr = 1.0 - tp / n_pos
    far = fp / n_neg

    diff = far - frr
    # Sign change location → EER
    idx = int(np.argmin(np.abs(diff)))
    eer = float((far[idx] + frr[idx]) / 2)
    threshold = float(scores[idx])
    return eer, threshold


def det_curve_auc(scores_genuine: np.ndarray, scores_impostor: np.ndarray) -> float:
    """AUC under the Detection Error Tradeoff curve.

    Returns 1 - AUC(ROC) so higher is better (matches the convention used in
    the Deep-Check dashboard).
    """
    return 1.0 - _roc_auc(scores_genuine, scores_impostor)


def _roc_auc(scores_pos: np.ndarray, scores_neg: np.ndarray) -> float:
    """Wilcoxon-Mann-Whitney estimator of AUC."""
    scores = np.concatenate([scores_pos, scores_neg])
    labels = np.concatenate(
        [np.ones_like(scores_pos, dtype=np.int8), np.zeros_like(scores_neg, dtype=np.int8)]
    )
    order = np.argsort(scores, kind="stable")
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(scores) + 1, dtype=np.float64)
    n_pos = int(labels.sum())
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    sum_ranks_pos = float(ranks[labels == 1].sum())
    return (sum_ranks_pos - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


def expected_calibration_error(
    probs: np.ndarray, labels: np.ndarray, n_bins: int = 15
) -> float:
    """ECE with equal-width binning.

    ``probs`` are calibrated probabilities in [0, 1]. ``labels`` are 0/1.
    """
    if probs.shape != labels.shape:
        raise ValueError("probs and labels must have the same shape")
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n_total = len(probs)
    for i in range(n_bins):
        lo, hi = bins[i], bins[i + 1]
        mask = (probs >= lo) & (probs < hi) if i < n_bins - 1 else (probs >= lo) & (probs <= hi)
        if not mask.any():
            continue
        bin_conf = float(probs[mask].mean())
        bin_acc = float(labels[mask].mean())
        weight = float(mask.sum()) / n_total
        ece += weight * abs(bin_conf - bin_acc)
    return ece


def brier_score(probs: np.ndarray, labels: np.ndarray) -> float:
    """Brier proper scoring rule."""
    return float(np.mean((probs - labels) ** 2))


def far_at_frr(
    scores_genuine: np.ndarray,
    scores_impostor: np.ndarray,
    target_frr: float,
) -> float:
    """Return the FAR at a fixed target FRR."""
    thr = _quantile(scores_genuine, target_frr)
    return float((scores_impostor >= thr).mean())


def frr_at_far(
    scores_genuine: np.ndarray,
    scores_impostor: np.ndarray,
    target_far: float,
) -> float:
    """Return the FRR at a fixed target FAR."""
    thr = _quantile(scores_impostor, 1.0 - target_far)
    return float((scores_genuine < thr).mean())


def _quantile(arr: np.ndarray, q: float) -> float:
    """Quantile with boundary clipping."""
    if len(arr) == 0:
        raise ValueError("empty array for quantile")
    return float(np.quantile(arr, np.clip(q, 0.0, 1.0)))


def biometric_report(
    scores_genuine: np.ndarray,
    scores_impostor: np.ndarray,
    probs: np.ndarray | None = None,
    labels: np.ndarray | None = None,
) -> BiometricReport:
    """Compile a full ISO-19795 style report.

    If ``probs`` and ``labels`` are provided, ECE is computed; otherwise
    reported as NaN.
    """
    eer, thr = equal_error_rate(scores_genuine, scores_impostor)
    return BiometricReport(
        eer=eer,
        eer_threshold=thr,
        far_at_frr_0_1=far_at_frr(scores_genuine, scores_impostor, 0.001),
        frr_at_far_0_01=frr_at_far(scores_genuine, scores_impostor, 0.0001),
        det_auc=det_curve_auc(scores_genuine, scores_impostor),
        ece=(
            float("nan")
            if probs is None or labels is None
            else expected_calibration_error(probs, labels)
        ),
        n_bona_fide=len(scores_genuine),
        n_impostor=len(scores_impostor),
    )


# --------------------------------------------------------------------------- #
# Conformal prediction utilities
# --------------------------------------------------------------------------- #

def conformal_quantile(calibration_nonconformity: np.ndarray, alpha: float) -> float:
    """Return the finite-sample conformal quantile.

    For n calibration points and miscoverage ``alpha``, the quantile is
    the ceil((n+1)(1-alpha))/n empirical quantile of the non-conformity
    scores. See Vovk, Gammerman & Shafer (2005).
    """
    n = len(calibration_nonconformity)
    if n == 0:
        raise ValueError("calibration set is empty")
    k = int(np.ceil((n + 1) * (1 - alpha)))
    k = max(1, min(k, n))
    sorted_scores = np.sort(calibration_nonconformity)
    return float(sorted_scores[k - 1])


def conformal_decision(
    prob: float,
    calibration_nonconformity: np.ndarray,
    alpha: float,
) -> str:
    """Return one of ``{"legitimate", "impostor", "uncertain"}``.

    ``prob`` is the posterior probability of being the legitimate user.
    """
    q = conformal_quantile(calibration_nonconformity, alpha)
    if prob >= 1.0 - q:
        return "legitimate"
    if prob <= q:
        return "impostor"
    return "uncertain"


# --------------------------------------------------------------------------- #
# Subgroup fairness auditing
# --------------------------------------------------------------------------- #

def per_subgroup_eer(
    scores_genuine: np.ndarray,
    scores_impostor: np.ndarray,
    subgroup_genuine: Sequence[str],
    subgroup_impostor: Sequence[str],
) -> dict[str, float]:
    """EER broken down by subgroup.

    Raises if any subgroup contains no genuine or no impostor samples.
    """
    if len(scores_genuine) != len(subgroup_genuine) or len(scores_impostor) != len(
        subgroup_impostor
    ):
        raise ValueError("score / subgroup length mismatch")
    out: dict[str, float] = {}
    all_groups = set(subgroup_genuine) | set(subgroup_impostor)
    sg = np.asarray(subgroup_genuine)
    si = np.asarray(subgroup_impostor)
    for group in sorted(all_groups):
        g = scores_genuine[sg == group]
        i = scores_impostor[si == group]
        if len(g) == 0 or len(i) == 0:
            raise ValueError(f"subgroup {group!r} has no genuine or no impostor samples")
        eer, _ = equal_error_rate(g, i)
        out[group] = eer
    return out


def fairness_disparity(group_errs: dict[str, float]) -> float:
    """Maximum pairwise EER gap across subgroups (in absolute terms)."""
    if not group_errs:
        return 0.0
    errs = np.array(list(group_errs.values()))
    return float(errs.max() - errs.min())


# --------------------------------------------------------------------------- #
# Aggregation over sessions
# --------------------------------------------------------------------------- #

def aggregate_window_scores(
    window_probs: Iterable[float],
    method: str = "trimmed_mean",
    trim: float = 0.1,
) -> float:
    """Aggregate per-window probabilities into a single session decision.

    ``method`` ∈ {"mean", "median", "trimmed_mean", "min"}.
    """
    arr = np.asarray(list(window_probs), dtype=np.float64)
    if len(arr) == 0:
        raise ValueError("no windows to aggregate")
    if method == "mean":
        return float(arr.mean())
    if method == "median":
        return float(np.median(arr))
    if method == "min":
        return float(arr.min())
    if method == "trimmed_mean":
        k = int(len(arr) * trim)
        if 2 * k >= len(arr):
            return float(np.median(arr))
        sorted_arr = np.sort(arr)
        return float(sorted_arr[k : len(arr) - k].mean())
    raise ValueError(f"unknown aggregation method: {method}")
