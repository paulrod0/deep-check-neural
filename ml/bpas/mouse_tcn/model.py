"""Dilated Temporal Convolutional Network for mouse dynamics.

Six Conv1D layers with exponentially increasing dilation. Receptive field ≈
3.84 s at 50 Hz sampling, which covers almost any single mouse-to-click
trajectory.

Outputs:
    - 64-D embedding for identification / triplet loss
    - 1-D logit for bot detection

Parameter count is ~150 K — small enough for CPU inference with p95 < 5 ms.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class TCNConfig:
    """Hyper-parameters for the TCN backbone."""

    feat_dim: int = 8
    channels: tuple[int, ...] = (32, 64, 128, 128, 64, 32)
    kernel: int = 3
    dropout: float = 0.1
    embed_dim: int = 64


class _DilatedBlock(nn.Module):
    """One dilated Conv1D + ReLU + Dropout + residual connection."""

    def __init__(self, in_ch: int, out_ch: int, k: int, dilation: int, dropout: float):
        super().__init__()
        padding = (k - 1) * dilation // 2
        self.conv = nn.Conv1d(in_ch, out_ch, k, dilation=dilation, padding=padding)
        self.norm = nn.GroupNorm(num_groups=min(8, out_ch), num_channels=out_ch)
        self.drop = nn.Dropout(dropout)
        self.proj = None if in_ch == out_ch else nn.Conv1d(in_ch, out_ch, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x if self.proj is None else self.proj(x)
        out = self.conv(x)
        out = F.relu(self.norm(out))
        out = self.drop(out)
        # Adjust shape if padding produced off-by-one (rare with k=3).
        if out.shape[-1] != residual.shape[-1]:
            out = out[..., : residual.shape[-1]]
        return out + residual


class MouseTCN(nn.Module):
    """Mouse-dynamics dilated TCN with dual heads (embedding + bot)."""

    def __init__(self, cfg: TCNConfig | None = None):
        super().__init__()
        self.cfg = cfg or TCNConfig()

        blocks: list[nn.Module] = []
        in_ch = self.cfg.feat_dim
        for i, out_ch in enumerate(self.cfg.channels):
            blocks.append(
                _DilatedBlock(in_ch, out_ch, self.cfg.kernel, 2**i, self.cfg.dropout)
            )
            in_ch = out_ch
        self.trunk = nn.Sequential(*blocks)
        self.pool = nn.AdaptiveAvgPool1d(1)
        self.embed_head = nn.Linear(in_ch, self.cfg.embed_dim)
        self.bot_head = nn.Linear(in_ch, 1)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """Forward pass.

        ``x`` has shape ``(B, T, F)``. Returns a dict with keys ``embed`` and
        ``bot_logit``.
        """
        # Conv1D expects (B, C, T)
        h = x.transpose(1, 2)
        h = self.trunk(h)
        pooled = self.pool(h).squeeze(-1)  # (B, C)
        embed = F.normalize(self.embed_head(pooled), dim=-1)
        bot_logit = self.bot_head(pooled).squeeze(-1)
        return {"embed": embed, "bot_logit": bot_logit}

    def count_parameters(self) -> int:
        """Return the total number of trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
