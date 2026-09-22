# V10.0 Training Run — Live State

**Started:** 2026-04-15 09:30 CEST
**Instance:** i-07189a89d5f7f254a (g5.12xlarge, 4x A10G A10G, 18.201.230.25)
**Operator:** Pablo López Rodríguez

## Pre-flight (done)

- [x] AWS CLI auth verified (account 508526124434)
- [x] Security group `sg-0f10425e445f99dec` created
- [x] Deep Learning AMI 2026-03-22 identified
- [x] V10 code packaged and uploaded to `s3://deep-check-models/code/deep-check-v10.tar.gz`
- [x] SG `sg-0f10425e445f99dec` created with SSH from 81.40.187.1/32
- [x] Spot quota hit (16 vCPU) -> pivoted to existing running g5.12xlarge
- [x] EC2 Instance Connect configured, PEM-less SSH working
- [x] V10 code deployed to `~/deep-check-v10/ml/video_v10/`
- [x] Deps verified: torch 2.6.0+cu124, transformers 5.5.0, VideoMAEModel OK
- [x] Kaggle creds pulled from S3

## Data source pivot

Original plan: YouTube + X scraping for Sora/Veo/real vlogs.
Blocker: YouTube "Sign in to confirm you're not a bot" from AWS IP ranges.
Pivot: FaceForensics++ c23 from Kaggle (17.8GB, 1000 real + 4000 fake videos).

Build via `build_dataset_local.py`:
- Reads FF-c23 standard layout
- Extracts 3 face-centric 8s clips per source video (~12K total clips)
- Normalizes to 224x224, 2fps, 16 frames
- Stratified 80/10/10 split by (source, label)

## Currently running

- `curl` download of `ff-c23.zip` (PID 952543) streaming from Kaggle API
- Monitor polling every 45s via this local session

## Next steps (on download complete)

```bash
# On instance:
cd ~/v10-data
unzip -q ff-c23.zip -d ff-c23/
cd ~/deep-check-v10/ml/video_v10
python3 build_dataset_local.py \
  --ff-root ~/v10-data/ff-c23 \
  --extra-fakes ~/v10-data/modern/deepfake \
  --extra-reals ~/v10-data/modern/video \
  --out ~/v10-data/video_v10 \
  --clips-per-video 3

# Training (4-GPU DDP, ~30h):
tmux new-session -d -s train \
  "torchrun --nproc_per_node=4 train.py \
    --data ~/v10-data/video_v10 \
    --out ~/v10-data/checkpoints/v10.0/ \
    --version v10.0 \
    --epochs 30 \
    --batch 16 \
    --grad-accum 2 \
    --workers 4 \
    2>&1 | tee ~/v10-logs/train.log"
```

## Cost tracking

Instance already on-demand (Pablo had it running since 2026-04-06).
Incremental cost: only power, no new instance cost.

## Follow-up

- After V10.0: run benchmark.py on held-out test set
- Iterate V10.1 with hard negatives (script ready: iterate.py)
- Supplement with modern fakes (Sora/Veo) once blocking is resolved (cookies or proxy)
