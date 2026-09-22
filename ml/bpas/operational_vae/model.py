"""β-VAE for operational-sequence novelty detection.

Encoder: embedding(app) ⊕ embedding(action) ⊕ log1p(Δt) → BiGRU → (μ, logσ²)
Decoder: z → GRU autoregresivo → softmax per step

Outputs:
    - elbo:    reconstruction + β·KL
    - novelty: reconstruction + (1-α)·KL as anomaly score
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class VaeConfig:
    """Hyper-parameters for the β-VAE."""

    app_vocab: int
    action_vocab: int
    app_embed: int = 16
    action_embed: int = 8
    hidden: int = 128
    latent: int = 32
    dropout: float = 0.1
    beta: float = 4.0
    alpha_novelty: float = 0.7


class OperationalVAE(nn.Module):
    """β-VAE over operational sequences."""

    def __init__(self, cfg: VaeConfig):
        super().__init__()
        self.cfg = cfg
        self.app_emb = nn.Embedding(cfg.app_vocab, cfg.app_embed, padding_idx=1)
        self.action_emb = nn.Embedding(cfg.action_vocab, cfg.action_embed, padding_idx=1)

        enc_in = cfg.app_embed + cfg.action_embed + 1  # +1 for Δt
        self.encoder_rnn = nn.GRU(
            enc_in,
            cfg.hidden,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=cfg.dropout,
        )
        self.mu_head = nn.Linear(cfg.hidden * 2, cfg.latent)
        self.logvar_head = nn.Linear(cfg.hidden * 2, cfg.latent)

        self.decoder_init = nn.Linear(cfg.latent, cfg.hidden * 2)
        self.decoder_rnn = nn.GRU(
            enc_in, cfg.hidden, num_layers=2, batch_first=True, dropout=cfg.dropout
        )
        self.app_out = nn.Linear(cfg.hidden, cfg.app_vocab)
        self.action_out = nn.Linear(cfg.hidden, cfg.action_vocab)
        self.dt_out = nn.Linear(cfg.hidden, 1)

    def _embed(self, app: torch.Tensor, action: torch.Tensor, dt: torch.Tensor) -> torch.Tensor:
        return torch.cat(
            [
                self.app_emb(app),
                self.action_emb(action),
                dt.unsqueeze(-1),
            ],
            dim=-1,
        )

    def encode(
        self, app: torch.Tensor, action: torch.Tensor, dt: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Return (μ, logσ²)."""
        x = self._embed(app, action, dt)
        _, h = self.encoder_rnn(x)
        # h: (num_layers*2, B, hidden) — take the last layer, both directions
        h_fwd = h[-2]
        h_bwd = h[-1]
        h_full = torch.cat([h_fwd, h_bwd], dim=-1)
        return self.mu_head(h_full), self.logvar_head(h_full)

    def reparameterize(self, mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        """Standard reparameterisation trick."""
        std = torch.exp(0.5 * logvar)
        return mu + std * torch.randn_like(std)

    def decode(
        self,
        z: torch.Tensor,
        app: torch.Tensor,
        action: torch.Tensor,
        dt: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        """Teacher-forced decoding: produce per-step logits for each output."""
        batch, seq_len = app.shape
        x = self._embed(app, action, dt)
        h0 = self.decoder_init(z).view(2, batch, -1)
        out, _ = self.decoder_rnn(x, h0)
        return {
            "app_logits": self.app_out(out),
            "action_logits": self.action_out(out),
            "dt_hat": self.dt_out(out).squeeze(-1),
        }

    def forward(
        self, app: torch.Tensor, action: torch.Tensor, dt: torch.Tensor
    ) -> dict[str, torch.Tensor]:
        mu, logvar = self.encode(app, action, dt)
        z = self.reparameterize(mu, logvar)
        out = self.decode(z, app, action, dt)
        out["mu"] = mu
        out["logvar"] = logvar
        out["z"] = z
        return out

    def elbo(
        self,
        out: dict[str, torch.Tensor],
        app: torch.Tensor,
        action: torch.Tensor,
        dt: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        """ELBO terms: CE_app + CE_action + MSE_dt + β·KL."""
        ce_app = F.cross_entropy(
            out["app_logits"].reshape(-1, out["app_logits"].shape[-1]),
            app.reshape(-1),
            ignore_index=1,  # APP_PAD
            reduction="mean",
        )
        ce_action = F.cross_entropy(
            out["action_logits"].reshape(-1, out["action_logits"].shape[-1]),
            action.reshape(-1),
            ignore_index=1,  # ACTION_PAD
            reduction="mean",
        )
        mse_dt = F.mse_loss(out["dt_hat"], dt, reduction="mean")
        kl = -0.5 * torch.mean(1 + out["logvar"] - out["mu"].pow(2) - out["logvar"].exp())
        loss = ce_app + ce_action + mse_dt + self.cfg.beta * kl
        return {
            "loss": loss,
            "recon": ce_app + ce_action + mse_dt,
            "kl": kl,
        }

    def novelty_score(
        self, app: torch.Tensor, action: torch.Tensor, dt: torch.Tensor
    ) -> torch.Tensor:
        """Return a per-sequence novelty score (higher = more anomalous).

        Uses reconstruction error + (1 - α)·KL. Crucially it does NOT use
        the β scaling — that's a training choice, not a scoring one.
        """
        out = self.forward(app, action, dt)
        recon = F.cross_entropy(
            out["app_logits"].reshape(-1, out["app_logits"].shape[-1]),
            app.reshape(-1),
            ignore_index=1,
            reduction="none",
        ).reshape(app.shape).mean(dim=-1)
        recon += F.cross_entropy(
            out["action_logits"].reshape(-1, out["action_logits"].shape[-1]),
            action.reshape(-1),
            ignore_index=1,
            reduction="none",
        ).reshape(action.shape).mean(dim=-1)
        recon += F.mse_loss(out["dt_hat"], dt, reduction="none").mean(dim=-1)

        kl = -0.5 * torch.mean(
            1 + out["logvar"] - out["mu"].pow(2) - out["logvar"].exp(), dim=-1
        )
        alpha = self.cfg.alpha_novelty
        return alpha * recon + (1 - alpha) * kl

    def count_parameters(self) -> int:
        """Trainable parameter count."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
