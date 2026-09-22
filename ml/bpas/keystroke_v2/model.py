"""Keystroke Transformer v2.

Architecture:

    Input token (72-D) = [keycode_embed_64, flight, hold, mod, corr, dwell_z,
                          digram_freq, pos_norm, reserved]

    → 4 encoder layers × 8 attention heads × 256-D model dim
    → RoPE applied inside each Q/K projection
    → CLS-style pooled representation via masked mean

    4 output heads:

        A  embed128       (L2-normalised) → triplet + InfoNCE loss
        B  bot_logit       → BCE(+label smoothing)
        C  duress_logit    → BCE(pos_weight=3.5)
        D  drift_logit     → BCE (concept drift auto-flag)

Parameter count ≈ 3.3 M (≈ existing Deep-Check keystroke model).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class KsV2Config:
    """Hyper-parameters for the Transformer."""

    keycode_vocab: int = 512      # generous for cross-layout robustness
    keycode_embed: int = 64
    scalar_feat_dim: int = 8      # see features.py
    d_model: int = 256
    n_heads: int = 8
    n_layers: int = 4
    ff_dim: int = 1024
    dropout: float = 0.1
    embed_dim: int = 128
    max_seq_len: int = 512
    rope_base: float = 10000.0


# --------------------------------------------------------------------------- #
# Rotary Position Embedding (Su et al. 2021, RoFormer)
# --------------------------------------------------------------------------- #

def _build_rope_cache(seq_len: int, head_dim: int, base: float, device: torch.device):
    """Pre-compute (cos, sin) tables of shape (seq_len, head_dim/2)."""
    if head_dim % 2:
        raise ValueError("RoPE requires an even head dimension")
    inv_freq = 1.0 / (base ** (torch.arange(0, head_dim, 2, device=device).float() / head_dim))
    t = torch.arange(seq_len, device=device, dtype=torch.float32)
    freqs = torch.einsum("i,j->ij", t, inv_freq)  # (T, D/2)
    return freqs.cos(), freqs.sin()


def _apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """Apply rotary embedding to ``x`` of shape (B, H, T, D_head)."""
    t = x.shape[-2]
    cos = cos[:t].unsqueeze(0).unsqueeze(0)  # (1, 1, T, D/2)
    sin = sin[:t].unsqueeze(0).unsqueeze(0)
    x1, x2 = x[..., ::2], x[..., 1::2]
    rot1 = x1 * cos - x2 * sin
    rot2 = x1 * sin + x2 * cos
    # Interleave the two halves back.
    out = torch.stack([rot1, rot2], dim=-1).flatten(-2)
    return out


# --------------------------------------------------------------------------- #
# Attention block
# --------------------------------------------------------------------------- #

class RopeAttention(nn.Module):
    """Multi-head attention with Rotary Position Embeddings on Q and K."""

    def __init__(self, cfg: KsV2Config):
        super().__init__()
        if cfg.d_model % cfg.n_heads:
            raise ValueError("d_model must be divisible by n_heads")
        self.n_heads = cfg.n_heads
        self.head_dim = cfg.d_model // cfg.n_heads
        self.qkv = nn.Linear(cfg.d_model, cfg.d_model * 3)
        self.out = nn.Linear(cfg.d_model, cfg.d_model)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(
        self,
        x: torch.Tensor,
        cos: torch.Tensor,
        sin: torch.Tensor,
        mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """``x``: (B, T, D). ``mask``: (B, T) with 1=valid, 0=pad."""
        batch, t, _ = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)
        q = q.view(batch, t, self.n_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch, t, self.n_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch, t, self.n_heads, self.head_dim).transpose(1, 2)

        q = _apply_rope(q, cos, sin)
        k = _apply_rope(k, cos, sin)

        scale = 1.0 / math.sqrt(self.head_dim)
        scores = (q @ k.transpose(-2, -1)) * scale  # (B, H, T, T)

        if mask is not None:
            pad = (mask == 0).unsqueeze(1).unsqueeze(1)  # (B, 1, 1, T)
            scores = scores.masked_fill(pad, float("-inf"))

        attn = F.softmax(scores, dim=-1)
        attn = self.drop(attn)
        out = attn @ v  # (B, H, T, D_head)
        out = out.transpose(1, 2).contiguous().view(batch, t, -1)
        return self.out(out)


class EncoderLayer(nn.Module):
    """Pre-norm Transformer block."""

    def __init__(self, cfg: KsV2Config):
        super().__init__()
        self.norm1 = nn.LayerNorm(cfg.d_model)
        self.attn = RopeAttention(cfg)
        self.norm2 = nn.LayerNorm(cfg.d_model)
        self.ff = nn.Sequential(
            nn.Linear(cfg.d_model, cfg.ff_dim),
            nn.GELU(),
            nn.Dropout(cfg.dropout),
            nn.Linear(cfg.ff_dim, cfg.d_model),
        )
        self.drop = nn.Dropout(cfg.dropout)

    def forward(self, x, cos, sin, mask):
        """Pre-norm block: ``x + attn(norm(x)) + ff(norm(...))``."""
        x = x + self.drop(self.attn(self.norm1(x), cos, sin, mask))
        x = x + self.drop(self.ff(self.norm2(x)))
        return x


# --------------------------------------------------------------------------- #
# Full model
# --------------------------------------------------------------------------- #

class KeystrokeV2(nn.Module):
    """Keystroke Transformer v2 with four output heads."""

    def __init__(self, cfg: KsV2Config | None = None):
        super().__init__()
        self.cfg = cfg or KsV2Config()
        self.key_embed = nn.Embedding(
            self.cfg.keycode_vocab, self.cfg.keycode_embed, padding_idx=0
        )
        self.token_in = nn.Linear(
            self.cfg.keycode_embed + self.cfg.scalar_feat_dim, self.cfg.d_model
        )
        self.layers = nn.ModuleList([EncoderLayer(self.cfg) for _ in range(self.cfg.n_layers)])
        self.norm = nn.LayerNorm(self.cfg.d_model)

        self.embed_head = nn.Linear(self.cfg.d_model, self.cfg.embed_dim)
        self.bot_head = nn.Linear(self.cfg.d_model, 1)
        self.duress_head = nn.Linear(self.cfg.d_model, 1)
        self.drift_head = nn.Linear(self.cfg.d_model, 1)

        cos, sin = _build_rope_cache(
            self.cfg.max_seq_len,
            self.cfg.d_model // self.cfg.n_heads,
            self.cfg.rope_base,
            torch.device("cpu"),
        )
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

    def encode(
        self,
        keycodes: torch.Tensor,
        scalars: torch.Tensor,
        mask: torch.Tensor,
    ) -> torch.Tensor:
        """Return pooled (B, D) representation."""
        kc_embed = self.key_embed(keycodes)  # (B, T, 64)
        tokens = torch.cat([kc_embed, scalars], dim=-1)  # (B, T, 72)
        h = self.token_in(tokens)  # (B, T, D)

        for layer in self.layers:
            h = layer(h, self.rope_cos, self.rope_sin, mask)
        h = self.norm(h)
        # Masked mean pool.
        m = mask.unsqueeze(-1).float()
        pooled = (h * m).sum(dim=1) / m.sum(dim=1).clamp(min=1.0)
        return pooled

    def forward(
        self,
        keycodes: torch.Tensor,
        scalars: torch.Tensor,
        mask: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        pooled = self.encode(keycodes, scalars, mask)
        embed = F.normalize(self.embed_head(pooled), dim=-1)
        return {
            "embed": embed,
            "bot_logit": self.bot_head(pooled).squeeze(-1),
            "duress_logit": self.duress_head(pooled).squeeze(-1),
            "drift_logit": self.drift_head(pooled).squeeze(-1),
            "pooled": pooled,
        }

    def count_parameters(self) -> int:
        """Total number of trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
