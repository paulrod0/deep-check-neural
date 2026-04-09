"""
DeepCheck Face — Loss Functions
Clean-room implementation from academic papers.

Implements:
  - ArcFace angular margin (Deng et al., CVPR 2019)
  - AdaFace quality-adaptive margin (Kim et al., CVPR 2022)
  - ElasticFace stochastic margin (Boutros et al., CVPR-W 2022)
  - ExpFace exponential margin (Zheng et al., 2025)
  - HybridAdaptiveMargin (HAM) — our novel combination

All formulas derived from published papers. No code from any repository.
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F


class ArcMarginLoss(nn.Module):
    """
    ArcFace: Additive Angular Margin Loss (Deng et al., CVPR 2019)

    L = -log( exp(s * cos(θ_y + m)) / (exp(s * cos(θ_y + m)) + Σ_{j≠y} exp(s * cos(θ_j))) )

    where θ = arccos(W_normalized^T · x_normalized)
    """

    def __init__(self, in_features: int, num_classes: int, s: float = 64.0,
                 m: float = 0.5, easy_margin: bool = False):
        super().__init__()
        self.in_features = in_features
        self.num_classes = num_classes
        self.s = s
        self.m = m
        self.easy_margin = easy_margin

        # Class weight matrix (will be L2-normalized before use)
        self.weight = nn.Parameter(torch.FloatTensor(num_classes, in_features))
        nn.init.xavier_uniform_(self.weight)

        # Precompute constants
        self.cos_m = math.cos(m)
        self.sin_m = math.sin(m)
        # cos(π - m) threshold for numerical stability
        self.th = math.cos(math.pi - m)
        self.mm = math.sin(math.pi - m) * m

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        """
        Args:
            embeddings: (B, in_features) L2-normalized feature vectors
            labels: (B,) ground truth class indices
        Returns:
            Cross-entropy loss scalar
        """
        # Normalize weight vectors
        W = F.normalize(self.weight, dim=1)
        # Normalize embeddings
        x = F.normalize(embeddings, dim=1)

        # cos(θ) = x^T W  ∈ [-1, 1]
        cos_theta = torch.clamp(x @ W.t(), -1.0 + 1e-7, 1.0 - 1e-7)

        # sin(θ) from cos(θ)
        sin_theta = torch.sqrt(1.0 - cos_theta.pow(2))

        # cos(θ + m) = cos(θ)cos(m) - sin(θ)sin(m)
        cos_theta_plus_m = cos_theta * self.cos_m - sin_theta * self.sin_m

        if self.easy_margin:
            # If θ > π/2, don't add margin (easy margin strategy)
            cos_theta_plus_m = torch.where(cos_theta > 0, cos_theta_plus_m, cos_theta)
        else:
            # Hard margin: if θ + m > π, use monotonic decreasing approximation
            cos_theta_plus_m = torch.where(
                cos_theta > self.th, cos_theta_plus_m, cos_theta - self.mm
            )

        # One-hot encode target classes
        one_hot = torch.zeros_like(cos_theta)
        one_hot.scatter_(1, labels.unsqueeze(1), 1.0)

        # Apply margin only to target class
        logits = one_hot * cos_theta_plus_m + (1.0 - one_hot) * cos_theta
        logits *= self.s

        return F.cross_entropy(logits, labels)


class AdaptiveMarginLoss(nn.Module):
    """
    AdaFace: Quality Adaptive Margin (Kim et al., CVPR 2022)

    Uses feature norm ||z|| as image quality proxy.
    High quality → larger margin (push harder)
    Low quality → smaller margin (avoid memorizing noise)

    margin_scaler = clip((||z|| - μ) / (σ + ε) * h, -1, 1)
    g_angular = -m * margin_scaler
    g_additive = m + m * margin_scaler
    """

    def __init__(self, in_features: int, num_classes: int, s: float = 64.0,
                 m: float = 0.4, h: float = 0.333, ema_decay: float = 0.99):
        super().__init__()
        self.in_features = in_features
        self.num_classes = num_classes
        self.s = s
        self.m = m
        self.h = h

        self.weight = nn.Parameter(torch.FloatTensor(num_classes, in_features))
        nn.init.xavier_uniform_(self.weight)

        # EMA statistics for feature norms
        self.register_buffer('norm_mean', torch.tensor(20.0))
        self.register_buffer('norm_std', torch.tensor(4.0))
        self.ema_decay = ema_decay

    def _update_norm_stats(self, norms: torch.Tensor):
        """Update running mean/std of feature norms using EMA."""
        with torch.no_grad():
            batch_mean = norms.mean()
            batch_std = norms.std()
            self.norm_mean = self.ema_decay * self.norm_mean + (1 - self.ema_decay) * batch_mean
            self.norm_std = self.ema_decay * self.norm_std + (1 - self.ema_decay) * batch_std

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        """
        Args:
            embeddings: (B, in_features) raw feature vectors (NOT pre-normalized)
            labels: (B,) ground truth class indices
        """
        # Compute norms before normalizing
        norms = torch.norm(embeddings, dim=1)

        if self.training:
            self._update_norm_stats(norms)

        # Quality-adaptive margin scaling
        margin_scaler = (norms - self.norm_mean) / (self.norm_std + 1e-6)
        margin_scaler = (margin_scaler * self.h).clamp(-1.0, 1.0)

        # Normalize for cosine computation
        W = F.normalize(self.weight, dim=1)
        x = F.normalize(embeddings, dim=1)
        cos_theta = torch.clamp(x @ W.t(), -1.0 + 1e-7, 1.0 - 1e-7)

        # Per-sample adaptive angular margin
        # g_angular: negative means more margin for high-quality
        g_angular = -self.m * margin_scaler  # (B,)
        # g_additive: cosine space additive margin
        g_add = self.m + self.m * margin_scaler  # (B,)

        # Compute cos(θ + m_adaptive) for target class
        theta = torch.acos(cos_theta)

        one_hot = torch.zeros_like(cos_theta)
        one_hot.scatter_(1, labels.unsqueeze(1), 1.0)

        # Apply per-sample angular margin to target class angle
        # θ' = θ + g_angular (per sample, broadcast to all classes but masked by one_hot)
        theta_m = theta + g_angular.unsqueeze(1) * one_hot
        theta_m = theta_m.clamp(1e-7, math.pi - 1e-7)
        cos_theta_m = torch.cos(theta_m)

        # Apply additive cosine margin
        cos_theta_m = cos_theta_m - g_add.unsqueeze(1) * one_hot

        # Final logits
        logits = one_hot * cos_theta_m + (1.0 - one_hot) * cos_theta
        logits *= self.s

        return F.cross_entropy(logits, labels)


class HybridAdaptiveMarginLoss(nn.Module):
    """
    HAM: Hybrid Adaptive Margin Loss — DeepCheck's novel contribution.

    Combines three innovations from published papers into a new loss:
    1. AdaFace quality-adaptive margin (feature norm → margin scaling)
    2. ElasticFace stochastic margin perturbation (Gaussian noise regularization)
    3. ExpFace exponential margin mapping (guaranteed monotonicity)

    L_HAM = -log( exp(s · T(θ_y + m_adaptive + ε)) / Z )

    where:
      T(θ) = cos(π · (θ/π)^m_e)           — ExpFace monotonic transform
      m_adaptive = m · sigmoid(||z|| - μ)   — AdaFace quality scaling
      ε ~ N(0, σ²)                          — ElasticFace stochastic regularization
    """

    def __init__(self, in_features: int, num_classes: int, s: float = 64.0,
                 m: float = 0.5, m_exp: float = 0.7, elastic_std: float = 0.02,
                 h: float = 0.333, ema_decay: float = 0.99):
        super().__init__()
        self.in_features = in_features
        self.num_classes = num_classes
        self.s = s
        self.m = m
        self.m_exp = m_exp  # Exponential margin exponent
        self.elastic_std = elastic_std  # ElasticFace perturbation σ
        self.h = h  # AdaFace concentration

        self.weight = nn.Parameter(torch.FloatTensor(num_classes, in_features))
        nn.init.xavier_uniform_(self.weight)

        # EMA for feature norm statistics (AdaFace)
        self.register_buffer('norm_mean', torch.tensor(20.0))
        self.register_buffer('norm_std', torch.tensor(4.0))
        self.ema_decay = ema_decay

    def _expface_transform(self, theta: torch.Tensor) -> torch.Tensor:
        """
        ExpFace monotonic margin: T(θ) = cos(π · (θ/π)^m_e)
        Maps [0, π] → [-1, 1] monotonically with stronger penalty near center.
        """
        # Normalize θ to [0, 1], apply power, rescale to [0, π]
        theta_norm = (theta / math.pi).clamp(1e-7, 1.0 - 1e-7)
        theta_exp = math.pi * theta_norm.pow(self.m_exp)
        return torch.cos(theta_exp)

    def _update_norm_stats(self, norms: torch.Tensor):
        with torch.no_grad():
            self.norm_mean = self.ema_decay * self.norm_mean + (1 - self.ema_decay) * norms.mean()
            self.norm_std = self.ema_decay * self.norm_std + (1 - self.ema_decay) * norms.std()

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        # Feature norms for quality estimation
        norms = torch.norm(embeddings, dim=1)

        if self.training:
            self._update_norm_stats(norms)

        # AdaFace: quality-adaptive margin
        quality = (norms - self.norm_mean) / (self.norm_std + 1e-6)
        quality = (quality * self.h).clamp(-1.0, 1.0)
        m_adaptive = self.m * torch.sigmoid(quality)  # (B,) ∈ [m/4, 3m/4] approx

        # ElasticFace: stochastic perturbation during training
        if self.training:
            epsilon = torch.randn_like(m_adaptive) * self.elastic_std
        else:
            epsilon = torch.zeros_like(m_adaptive)

        # Cosine similarity
        W = F.normalize(self.weight, dim=1)
        x = F.normalize(embeddings, dim=1)
        cos_theta = torch.clamp(x @ W.t(), -1.0 + 1e-7, 1.0 - 1e-7)
        theta = torch.acos(cos_theta)

        # One-hot target mask
        one_hot = torch.zeros_like(cos_theta)
        one_hot.scatter_(1, labels.unsqueeze(1), 1.0)

        # Apply hybrid margin to target class:
        # θ' = θ + m_adaptive + ε (per sample, target class only)
        total_margin = (m_adaptive + epsilon).unsqueeze(1) * one_hot
        theta_target = theta + total_margin
        theta_target = theta_target.clamp(1e-7, math.pi - 1e-7)

        # ExpFace monotonic transform on target class
        cos_target = self._expface_transform(theta_target)

        # Non-target classes use standard cosine
        cos_nontarget = cos_theta

        # Combine
        logits = one_hot * cos_target + (1.0 - one_hot) * cos_nontarget
        logits *= self.s

        return F.cross_entropy(logits, labels)


class PartialFC(nn.Module):
    """
    Partial FC: Efficient training with millions of classes.
    Randomly samples a subset of negative classes per mini-batch.

    From: Deng et al., "Partial FC: Training 10 Million Identities on a Single Machine"
    """

    def __init__(self, margin_loss: nn.Module, num_classes: int,
                 sample_rate: float = 0.1):
        super().__init__()
        self.margin_loss = margin_loss
        self.num_classes = num_classes
        self.sample_rate = sample_rate
        self.num_sample = int(num_classes * sample_rate)

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        if self.num_classes <= 100000 or not self.training:
            return self.margin_loss(embeddings, labels)

        # Always include positive classes
        positive_classes = labels.unique()

        # Sample negative classes
        all_classes = torch.arange(self.num_classes, device=labels.device)
        mask = torch.ones(self.num_classes, dtype=torch.bool, device=labels.device)
        mask[positive_classes] = False
        negative_pool = all_classes[mask]

        num_neg = min(self.num_sample, len(negative_pool))
        perm = torch.randperm(len(negative_pool), device=labels.device)[:num_neg]
        sampled_neg = negative_pool[perm]

        # Combined class subset
        subset = torch.cat([positive_classes, sampled_neg]).sort()[0]

        # Remap labels to subset indices
        label_map = torch.zeros(self.num_classes, dtype=torch.long, device=labels.device)
        label_map[subset] = torch.arange(len(subset), device=labels.device)
        remapped_labels = label_map[labels]

        # Subset the weight matrix
        orig_weight = self.margin_loss.weight.data
        self.margin_loss.weight = nn.Parameter(orig_weight[subset])
        self.margin_loss.num_classes = len(subset)

        loss = self.margin_loss(embeddings, remapped_labels)

        # Restore
        self.margin_loss.weight = nn.Parameter(orig_weight)
        self.margin_loss.num_classes = self.num_classes

        return loss
