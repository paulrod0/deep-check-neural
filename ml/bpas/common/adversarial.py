"""Adversarial training utilities for BPAS models.

Provides:
  - ``pgd_attack``: L_inf Projected Gradient Descent on continuous feature
    tensors (Madry et al. 2018).
  - ``trades_loss``: Surrogate loss for adversarial robustness (Zhang et al.
    2019) that decouples natural and robust risk.
  - ``MimicryAugmenter``: simple conditional generator for synthetic
    keystroke/mouse sequences used as adversarial positives in training.

All utilities work on batches of continuous features produced upstream of
the model's first learnable layer, so the same code is reused by the
keystroke Transformer and the mouse TCN.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


# --------------------------------------------------------------------------- #
# PGD
# --------------------------------------------------------------------------- #

def pgd_attack(
    model,
    x: torch.Tensor,
    y: torch.Tensor,
    *,
    eps: float = 0.05,
    step: float | None = None,
    n_steps: int = 10,
    loss_fn: nn.Module | None = None,
    clip_min: float = -10.0,
    clip_max: float = 10.0,
) -> torch.Tensor:
    """Return an adversarial example ``x + δ`` with ``||δ||_∞ ≤ eps``.

    Designed for continuous-valued feature tensors (flight/hold times,
    mouse deltas), not for raw categorical token IDs. The caller is
    responsible for re-embedding if needed.

    ``model`` may be an ``nn.Module`` or any callable that maps a tensor of
    shape ``x.shape`` to a tensor compatible with ``loss_fn``. The caller is
    responsible for putting the underlying module in eval mode if desired;
    we do not toggle training state on plain callables.
    """
    if step is None:
        step = eps / 4.0
    if loss_fn is None:
        loss_fn = nn.BCEWithLogitsLoss()

    was_training: bool | None = None
    if isinstance(model, nn.Module):
        was_training = model.training
        model.train(False)

    x_adv = x.clone().detach()
    # Random start inside the L_inf ball to avoid gradient masking.
    x_adv = x_adv + torch.empty_like(x_adv).uniform_(-eps, eps)
    x_adv = torch.clamp(x_adv, clip_min, clip_max)

    for _ in range(n_steps):
        x_adv.requires_grad_(True)
        out = model(x_adv)
        loss = loss_fn(out, y)
        grad = torch.autograd.grad(loss, x_adv, retain_graph=False, create_graph=False)[0]
        x_adv = x_adv.detach() + step * grad.sign()
        # Project back into eps-ball around x.
        x_adv = torch.max(torch.min(x_adv, x + eps), x - eps)
        x_adv = torch.clamp(x_adv, clip_min, clip_max)

    if isinstance(model, nn.Module) and was_training:
        model.train(True)
    return x_adv.detach()


# --------------------------------------------------------------------------- #
# TRADES loss
# --------------------------------------------------------------------------- #

@dataclass
class TradesConfig:
    """Hyper-parameters for TRADES."""

    beta: float = 6.0
    eps: float = 0.05
    step: float = 0.0125  # eps / 4
    n_steps: int = 10


def trades_loss(
    model: nn.Module,
    x: torch.Tensor,
    y: torch.Tensor,
    *,
    config: TradesConfig | None = None,
) -> torch.Tensor:
    """TRADES loss: ``L_nat + β · KL(p_nat || p_adv)``.

    ``y`` is the binary label (0/1) for the positive head. The function
    handles both logit-space outputs (single scalar per sample) and
    multi-class logits (last dim).
    """
    cfg = config or TradesConfig()
    l_nat = F.binary_cross_entropy_with_logits(model(x), y)

    # Adversarial example chasing KL divergence, not label-specific loss
    # (this is the TRADES inner maximisation).
    x_adv = x.clone().detach() + torch.empty_like(x).uniform_(-cfg.eps, cfg.eps)
    for _ in range(cfg.n_steps):
        x_adv.requires_grad_(True)
        out_nat = torch.sigmoid(model(x))
        out_adv = torch.sigmoid(model(x_adv))
        kl = _bernoulli_kl(out_adv, out_nat.detach())
        grad = torch.autograd.grad(kl.mean(), x_adv)[0]
        x_adv = x_adv.detach() + cfg.step * grad.sign()
        x_adv = torch.max(torch.min(x_adv, x + cfg.eps), x - cfg.eps)

    out_nat = torch.sigmoid(model(x))
    out_adv = torch.sigmoid(model(x_adv))
    kl_term = _bernoulli_kl(out_adv, out_nat.detach()).mean()
    return l_nat + cfg.beta * kl_term


def _bernoulli_kl(p: torch.Tensor, q: torch.Tensor, eps: float = 1e-7) -> torch.Tensor:
    """KL( Bernoulli(p) || Bernoulli(q) ), element-wise."""
    p = p.clamp(eps, 1 - eps)
    q = q.clamp(eps, 1 - eps)
    return p * torch.log(p / q) + (1 - p) * torch.log((1 - p) / (1 - q))


# --------------------------------------------------------------------------- #
# Mimicry augmentation
# --------------------------------------------------------------------------- #

class MimicryAugmenter(nn.Module):
    """Small conditional generator that emits synthetic per-user sequences.

    Used to produce hard negatives: sequences that look like the target user
    but weren't produced by them. During training, these are added to the
    impostor class with label 0.
    """

    def __init__(self, feat_dim: int, user_vocab: int, hidden: int = 64):
        super().__init__()
        self.user_embed = nn.Embedding(user_vocab, hidden)
        self.proj = nn.Linear(hidden + feat_dim, feat_dim * 2)

    def forward(
        self, user_ids: torch.Tensor, length: int, noise_scale: float = 0.1
    ) -> torch.Tensor:
        """Generate synthetic sequences conditioned on ``user_ids``.

        Returns a tensor of shape ``(B, length, feat_dim)``.
        """
        batch = user_ids.shape[0]
        cond = self.user_embed(user_ids)  # (B, hidden)
        feat_dim = self.proj.out_features // 2
        seq = torch.zeros(batch, length, feat_dim, device=user_ids.device)
        prev = torch.zeros(batch, feat_dim, device=user_ids.device)
        for t in range(length):
            inp = torch.cat([cond, prev], dim=-1)
            out = self.proj(inp)
            mean, logvar = out.chunk(2, dim=-1)
            eps = torch.randn_like(mean) * noise_scale
            step = mean + eps * torch.exp(0.5 * logvar)
            seq[:, t, :] = step
            prev = step
        return seq


def pgd_radius_sweep(
    model: nn.Module,
    x: torch.Tensor,
    y: torch.Tensor,
    radii: list[float],
    n_steps: int = 10,
) -> dict[float, float]:
    """Evaluate robust accuracy across a grid of attack radii.

    Returns a dict ``{eps: accuracy_under_PGD}``. Useful for reporting the
    full robustness curve rather than a single point estimate.
    """
    accs: dict[float, float] = {}
    for eps in radii:
        x_adv = pgd_attack(model, x, y, eps=eps, n_steps=n_steps)
        with torch.no_grad():
            preds = (torch.sigmoid(model(x_adv)) >= 0.5).float()
        accs[eps] = float((preds == y).float().mean().item())
    return accs
