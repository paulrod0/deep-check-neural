# Deep-Check V10 — Defense-Grade Video Deepfake Detection

Continuous iteration pipeline targeting NIST FATE PAD / ISO 30107-3 compliance.

## Target KPIs

| Metric | Target | Why |
|--------|--------|-----|
| Cross-source AUC | > 0.990 | Defense baseline |
| EER | < 1.5% | Less than 1-in-65 wrong decisions |
| TPR @ FPR=0.1% | > 95% | Low false-alarm rate for critical decisions |
| APCER (fake→real) | < 5% | NIST PAD |
| BPCER (real→fake) | < 5% | NIST PAD |
| Adversarial AUC drop | < 3% | Robustness under JPEG/blur/resize |
| Demographic fairness gap | < 2% | No demographic regression |
| ECE (calibration) | < 0.05 | Scores mean what they say |

## Pipeline

```
┌──────────────┐     ┌──────────┐     ┌───────────┐     ┌─────────┐
│ build_dataset│────▶│  train   │────▶│ benchmark │────▶│ iterate │
│  (scraping)  │     │ (4x A10G)│     │ (NIST PAD)│     │  (loop) │
└──────────────┘     └──────────┘     └───────────┘     └────┬────┘
                                                             │
                                                             ▼
                                              ┌──────────────────────────┐
                                              │ Hard-negative mining     │
                                              │ Fresh scraping           │
                                              │ Fine-tune V10.N+1        │
                                              │ Promote if beats criteria│
                                              └──────────────────────────┘
```

## Architecture

- **Backbone**: VideoMAE-Large (MCG-NJU/videomae-large), 304M params, pretrained Kinetics-400
- **Input**: 16 frames × 224×224 × 3, sampled at 2fps
- **Head**: LayerNorm → Linear(1024, 512) → GELU → Dropout(0.3) → Linear(512, 1)
- **Loss**: Focal BCE (γ=2) + label smoothing (ε=0.1)
- **Aug**: JPEG Q10-90, Gaussian blur, color jitter, MixUp α=0.2

## Data sources

**Fakes (modern generators):**
- Sora 2 (Twitter/X, YouTube)
- Veo 3 (YouTube AI channels)
- Runway Gen-3 (public gallery)
- Kling, Pika, Luma (community posts)
- HeyGen, Synthesia (talking heads — high defense threat)

**Reals:**
- YouTube random vlogs (diverse demographic query list)
- VoxCeleb2 subset
- FaceForensics++ original track
- Common Crawl face extractions

All clips:
- Face-detected (OpenCV Haar)
- Crop 1.6× face bbox
- Normalize to 224×224 at 2fps, 16 frames
- Dedup via video fingerprint (8-frame dHash concat)
- Anti-leak: sha256 hash check vs prior training sets
- Stratified split 80/10/10 (train/val/test) by source × label

## Continuous iteration

Each cycle (`iterate.py`):
1. Benchmark current best
2. Mine top 500 false-positives + 500 false-negatives (highest confidence)
3. Optionally scrape fresh modern samples (`--scrape-new`)
4. Build V10.(N+1) training set = V10.N + hard negatives + fresh
5. Fine-tune 5 epochs at lr=2e-5 from V10.N checkpoint
6. Benchmark V10.(N+1)
7. **Promote if all promotion criteria pass**, else rollback

Promotion criteria (all must pass):
- AUC improvement ≥ 0.003
- EER improvement ≥ 0.002
- APCER < 5% and BPCER < 5%
- No per-generator AUC regression > 1%
- No adversarial degradation > 3%

## Quick start on g5.12xlarge

```bash
# SSH to instance, then:
git clone <repo>
cd deep-check/scripts
./launch_ec2_v10.sh bootstrap              # ~5 min
./launch_ec2_v10.sh full v10.0             # ~40 hours (dataset + train + bench)

# After V10.0 is ready:
./launch_ec2_v10.sh iterate v10.0 v10.1    # ~8 hours
./launch_ec2_v10.sh iterate v10.1 v10.2    # ~8 hours
```

## Cost estimate

| Phase | Duration (g5.12xlarge spot) | Cost @ €5.67/h |
|-------|-----------------------------|----------------|
| Dataset build | 6-10 h | €35-57 |
| V10.0 training (40 epochs) | 28-32 h | €160-180 |
| Benchmark | 1 h | €6 |
| Iteration V10.N→N+1 | 6-10 h | €35-57 |
| **Total for V10.0 + 3 iterations** | **55-70 h** | **~€310-400** |

Full budget under €1K including S3 storage + scraping proxies.

## Files

- `build_dataset.py` — Dataset collection, face extraction, dedup, splits
- `train.py` — VideoMAE DDP pixel model training (4-GPU)
- `av_sync.py` — V10.3: audio-visual lip-sync detector (SyncNet-style)
- `rppg_temporal.py` — V10.4: rPPG physiological signal classifier (CHROM method)
- `train_multimodal.py` — V10.5: logit-space fusion of pixel + AV + rPPG + isotonic calibration
- `benchmark.py` — NIST PAD / ISO 30107-3 compliance eval
- `iterate.py` — Continuous iteration loop (hard-negative mining + fine-tune + promote)
- `requirements.txt` — Python deps
- `../scripts/launch_ec2_v10.sh` — EC2 automation wrapper (runs on the instance)
- `../scripts/ec2_spot_launch.sh` — One-command spot-instance launcher (runs from local)

## Outputs

- `s3://deep-check-models/deepfake/video_vX.Y/best.pt` — Checkpoint
- `s3://deep-check-models/deepfake/approved/deepfake_video/manifest.json` — Promoted version
- `s3://deep-check-models/reports/video_vX.Y/KPI_REPORT.md` — Formal KPI report
- `s3://deep-check-models/reports/video_vX.Y/benchmark.json` — Raw metrics
- `reports/iteration_history.jsonl` — Full audit trail of promotions/rollbacks

## Roadmap

- **V10.0** (ready): Baseline VideoMAE-L fine-tuned on modern deepfakes
- **V10.1** (ready via `iterate.py`): Hard-negative mining from V10.0 failures
- **V10.2** (ready via `iterate.py`): Adversarial hardening — train on attacked samples
- **V10.3** (ready `av_sync.py`): Audio-visual sync — SyncNet contrastive (Whisper-style audio + 3D-CNN lip)
- **V10.4** (ready `rppg_temporal.py`): rPPG temporal consistency via CHROM method + physiological feature classifier
- **V10.5** (ready `train_multimodal.py`): Logit-space fusion of pixel + AV + rPPG with learned weights + isotonic calibration
- **V10.6** (next): ONNX export of fusion model + browser demo
- **V10.7** (next): Multi-resolution ensemble (224 + 384 + 512)
- **V10.8** (next): NIST FATE PAD submission

## One-command spin-up (from your laptop)

```bash
# Full V10.0 training (dataset + train + benchmark) on spot instance
./scripts/ec2_spot_launch.sh full v10.0

# Multimodal training (AV sync + rPPG + fusion head) after V10.0 is trained
./scripts/ec2_spot_launch.sh multimodal

# Monitor running instances
./scripts/ec2_spot_launch.sh status

# Kill everything
./scripts/ec2_spot_launch.sh kill
```

Instance auto-terminates when the job completes. Logs stream to
`s3://deep-check-models/logs/bootstrap-<instance-id>.log`.
