# BPAS ML pipelines

Training and evaluation code for the BPAS behavioural-authentication models.

```
ml/bpas/
├── common/
│   ├── metrics.py         # EER, ECE, TRADES-robust AUC, conformal utilities
│   └── adversarial.py     # PGD, TRADES loss, mimicry GAN augmentation
├── mouse_tcn/
│   ├── features.py        # 8-feature engineered window from raw (Δx, Δy, Δt)
│   ├── dataset.py         # streaming dataset with per-user splits
│   ├── model.py           # dilated TCN (6L, ~150K params)
│   └── train.py           # training loop with triplet + bot-head + adversarial
├── operational_vae/
│   ├── dataset.py         # (app_id, action_type, Δt) windows
│   ├── model.py           # β-VAE GRU bidireccional
│   └── train.py           # one-class novelty training
├── keystroke_hard/
│   └── (hardening of existing keystroke Transformer)
└── fusion/
    ├── isotonic.py        # per-modality monotonic calibrators
    ├── conformal.py       # split conformal layer with per-user α
    └── ensemble.py        # Bayesian logit-space fusion with learnt weights
```

## Philosophy

- **Reproducibility first.** Every training script prints its config, seeds
  every RNG, logs dataset hashes, and writes a result manifest that can be
  signed and stored in the ISO-27037 custody chain.
- **No `*.py` file imports from `../../src/`.** The Python code is
  self-contained and runs in an isolated venv on inference / training hosts.
- **Small, interpretable metrics.** We publish EER, FAR@FRR, ECE, DET-AUC,
  TRADES-robust AUC. No vanity accuracy numbers.
- **Conformal calibration is mandatory.** Every deployable head exposes a
  prediction set, not just a probability.

## Target hardware

- Training: 1× A10G (g5.xlarge) is enough for mouse TCN and β-VAE; the
  stylometry head uses the existing XLM-R-base + LoRA on the same instance.
- Inference: CPU-only on the worker (INT8 ONNX) at p95 < 5 ms/modality.

## Typical run

```bash
# 1) Mouse TCN
python -m ml.bpas.mouse_tcn.train \
  --data /data/balabit \
  --epochs 60 --batch 128 --lr 2e-3 --adversarial \
  --out /outputs/mouse_tcn

# 2) Operational VAE (one-class)
python -m ml.bpas.operational_vae.train \
  --data /data/operational_traces \
  --epochs 40 --beta 4.0 \
  --out /outputs/op_vae

# 3) Fusion + conformal calibration (per-user splits)
python -m ml.bpas.fusion.ensemble \
  --keystroke /outputs/keystroke_v3 \
  --mouse /outputs/mouse_tcn \
  --op-vae /outputs/op_vae \
  --users /data/users.json \
  --out /outputs/bpas_ensemble_v1

# 4) Full benchmark report (ISO 19795-1)
python -m ml.bpas.common.metrics report \
  --ensemble /outputs/bpas_ensemble_v1 \
  --test /data/test_sessions \
  --out /outputs/bpas_report.json
```
