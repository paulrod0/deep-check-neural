#!/usr/bin/env bash
# Deep-Check V10 EC2 automation for g5.12xlarge (4x A10G).
#
# Usage:
#   ./launch_ec2_v10.sh bootstrap     # Run on fresh EC2 instance (first time)
#   ./launch_ec2_v10.sh dataset       # Build V10.0 dataset (~8h)
#   ./launch_ec2_v10.sh train v10.0   # Train V10.0 (~30h)
#   ./launch_ec2_v10.sh benchmark v10.0
#   ./launch_ec2_v10.sh iterate v10.0 v10.1
#   ./launch_ec2_v10.sh full v10.0    # Full cycle end-to-end
#
# Env vars expected:
#   AWS_DEFAULT_REGION (default: eu-west-1)
#   S3_BUCKET (default: deep-check-models)
#   WORKDIR (default: /mnt/nvme/deep-check-v10)
set -euo pipefail

AWS_REGION="${AWS_DEFAULT_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
WORKDIR="${WORKDIR:-/mnt/nvme/deep-check-v10}"
HF_CACHE="${HF_HOME:-$WORKDIR/.cache/huggingface}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { log "ERROR: $*"; exit 1; }

cmd_bootstrap() {
  log "=== Bootstrapping EC2 g5.12xlarge ==="
  # Prep NVMe scratch (g5 instances have 3.8TB local NVMe at /dev/nvme1n1)
  if [[ ! -d /mnt/nvme ]]; then
    sudo mkfs.ext4 -F /dev/nvme1n1 || true
    sudo mkdir -p /mnt/nvme
    sudo mount /dev/nvme1n1 /mnt/nvme || true
    sudo chown ubuntu:ubuntu /mnt/nvme
  fi
  mkdir -p "$WORKDIR" "$HF_CACHE"

  # System packages
  sudo apt-get update -y
  sudo apt-get install -y \
    python3-pip python3-venv ffmpeg \
    build-essential git tmux htop nvtop \
    awscli

  # Python env
  if [[ ! -d "$WORKDIR/.venv" ]]; then
    python3 -m venv "$WORKDIR/.venv"
  fi
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  pip install --upgrade pip wheel

  pip install \
    "torch==2.5.1" "torchvision==0.20.1" "torchaudio==2.5.1" \
    --index-url https://download.pytorch.org/whl/cu121

  pip install \
    transformers==4.46.3 \
    scikit-learn==1.5.2 \
    opencv-python-headless==4.10.0.84 \
    numpy==2.1.3 \
    tqdm \
    yt-dlp \
    boto3

  # Verify GPUs
  python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, GPUs: {torch.cuda.device_count()}')"
  nvidia-smi --query-gpu=name,memory.total --format=csv
  log "Bootstrap complete."
}

cmd_sync_code() {
  log "=== Syncing code to workdir ==="
  mkdir -p "$WORKDIR/ml"
  rsync -av --exclude=__pycache__ ./ml/video_v10/ "$WORKDIR/ml/video_v10/"
}

cmd_dataset() {
  log "=== Building V10.0 dataset ==="
  cmd_sync_code
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  cd "$WORKDIR/ml/video_v10"
  python build_dataset.py \
    --out "$WORKDIR/datasets/video_v10" \
    --version v10.0 \
    2>&1 | tee "$WORKDIR/logs/dataset_$(date -u +%Y%m%d_%H%M%S).log"

  log "Uploading dataset index to S3"
  aws s3 sync "$WORKDIR/datasets/video_v10/" \
    "s3://$S3_BUCKET/datasets/video_v10/" \
    --exclude "*" \
    --include "*.jsonl" \
    --include "*.md"
}

cmd_train() {
  local version="${1:-v10.0}"
  log "=== Training $version on 4x A10G ==="
  cmd_sync_code
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  cd "$WORKDIR/ml/video_v10"

  mkdir -p "$WORKDIR/checkpoints/$version" "$WORKDIR/logs"

  torchrun --nproc_per_node=4 train.py \
    --data "$WORKDIR/datasets/video_v10" \
    --out "s3://$S3_BUCKET/deepfake/video_$version/" \
    --version "$version" \
    --epochs 40 \
    --batch 32 \
    --grad-accum 2 \
    --workers 6 \
    2>&1 | tee "$WORKDIR/logs/train_${version}_$(date -u +%Y%m%d_%H%M%S).log"
}

cmd_benchmark() {
  local version="${1:-v10.0}"
  log "=== Benchmarking $version ==="
  cmd_sync_code
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  cd "$WORKDIR/ml/video_v10"

  mkdir -p "$WORKDIR/reports/$version"

  # Download best.pt if not present
  if [[ ! -f "$WORKDIR/checkpoints/$version/best.pt" ]]; then
    aws s3 cp "s3://$S3_BUCKET/deepfake/video_$version/best.pt" \
      "$WORKDIR/checkpoints/$version/best.pt"
  fi

  python benchmark.py \
    --ckpt "$WORKDIR/checkpoints/$version/best.pt" \
    --data "$WORKDIR/datasets/video_v10/test" \
    --out "$WORKDIR/reports/$version" \
    --version "$version" \
    2>&1 | tee "$WORKDIR/logs/bench_${version}_$(date -u +%Y%m%d_%H%M%S).log"

  # Upload report
  aws s3 sync "$WORKDIR/reports/$version/" \
    "s3://$S3_BUCKET/reports/video_$version/"
}

cmd_iterate() {
  local current="${1:-v10.0}"
  local next="${2:-v10.1}"
  log "=== Iteration: $current -> $next ==="
  cmd_sync_code
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  cd "$WORKDIR/ml/video_v10"

  python iterate.py \
    --current "$current" \
    --next "$next" \
    --data "$WORKDIR/datasets/video_v10" \
    --ckpt-dir "$WORKDIR/checkpoints" \
    --reports-dir "$WORKDIR/reports" \
    --epochs 5 \
    --scrape-new \
    --s3-prefix "s3://$S3_BUCKET/deepfake/" \
    2>&1 | tee "$WORKDIR/logs/iter_${current}_to_${next}_$(date -u +%Y%m%d_%H%M%S).log"
}

cmd_full() {
  local version="${1:-v10.0}"
  log "=== FULL CYCLE: dataset -> train -> benchmark for $version ==="
  cmd_dataset
  cmd_train "$version"
  cmd_benchmark "$version"

  log "=== FULL CYCLE COMPLETE for $version ==="
  log "Check reports at: s3://$S3_BUCKET/reports/video_$version/"

  # Optional: auto-shutdown to save cost
  if [[ "${AUTO_SHUTDOWN:-}" == "1" ]]; then
    log "Auto-shutdown in 5 minutes..."
    sudo shutdown -h +5
  fi
}

cmd_multimodal() {
  log "=== MULTIMODAL: AV sync + rPPG + fusion training ==="
  cmd_sync_code
  # shellcheck disable=SC1091
  source "$WORKDIR/.venv/bin/activate"
  cd "$WORKDIR/ml/video_v10"

  mkdir -p "$WORKDIR/checkpoints/multimodal" "$WORKDIR/logs"

  log "Step 1/5: Extract audio tracks"
  python av_sync.py extract --data "$WORKDIR/datasets/video_v10" \
    2>&1 | tee "$WORKDIR/logs/av_extract_$(date -u +%Y%m%d_%H%M%S).log"

  log "Step 2/5: Train AV sync model"
  python av_sync.py train \
    --data "$WORKDIR/datasets/video_v10" \
    --out "$WORKDIR/checkpoints/multimodal/av_sync.pt" \
    --epochs 20 \
    2>&1 | tee "$WORKDIR/logs/av_train_$(date -u +%Y%m%d_%H%M%S).log"

  log "Step 3/5: Extract rPPG features"
  python rppg_temporal.py extract --data "$WORKDIR/datasets/video_v10" \
    2>&1 | tee "$WORKDIR/logs/rppg_extract_$(date -u +%Y%m%d_%H%M%S).log"

  log "Step 4/5: Train rPPG classifier"
  python rppg_temporal.py train \
    --data "$WORKDIR/datasets/video_v10" \
    --out "$WORKDIR/checkpoints/multimodal/rppg.pt" \
    --epochs 50 \
    2>&1 | tee "$WORKDIR/logs/rppg_train_$(date -u +%Y%m%d_%H%M%S).log"

  log "Score all clips with AV + rPPG"
  python av_sync.py score --data "$WORKDIR/datasets/video_v10" \
    --ckpt "$WORKDIR/checkpoints/multimodal/av_sync.pt"
  python rppg_temporal.py score --data "$WORKDIR/datasets/video_v10" \
    --ckpt "$WORKDIR/checkpoints/multimodal/rppg.pt"

  log "Step 5/5: Train fusion head"
  python train_multimodal.py \
    --data "$WORKDIR/datasets/video_v10" \
    --out "$WORKDIR/checkpoints/multimodal/fusion.pt" \
    --calib-out "$WORKDIR/checkpoints/multimodal/fusion_calibration.json" \
    2>&1 | tee "$WORKDIR/logs/fusion_$(date -u +%Y%m%d_%H%M%S).log"

  # Upload to S3
  aws s3 sync "$WORKDIR/checkpoints/multimodal/" \
    "s3://$S3_BUCKET/deepfake/multimodal_v10.5/"

  log "=== MULTIMODAL COMPLETE ==="
  if [[ "${AUTO_SHUTDOWN:-}" == "1" ]]; then
    log "Auto-shutdown in 5 minutes..."
    sudo shutdown -h +5
  fi
}

mode="${1:-help}"
case "$mode" in
  bootstrap)  cmd_bootstrap ;;
  sync)       cmd_sync_code ;;
  dataset)    cmd_dataset ;;
  train)      cmd_train "${2:-v10.0}" ;;
  benchmark)  cmd_benchmark "${2:-v10.0}" ;;
  iterate)    cmd_iterate "${2:-v10.0}" "${3:-v10.1}" ;;
  full)       cmd_full "${2:-v10.0}" ;;
  multimodal) cmd_multimodal ;;
  help|*)
    cat <<EOF
Usage: $0 <command> [args]

Commands:
  bootstrap              Install deps on fresh EC2 (run once per instance)
  dataset                Build V10.0 dataset from internet scraping
  train <version>        Train <version> on 4x A10G (~30h for 40 epochs)
  benchmark <version>    Run defense-grade benchmark
  iterate <cur> <next>   Continuous iteration: mine hard negatives -> fine-tune
  full <version>         Full cycle: dataset + train + benchmark
  sync                   Re-sync code only

Env:
  AWS_DEFAULT_REGION=${AWS_REGION}
  S3_BUCKET=${S3_BUCKET}
  WORKDIR=${WORKDIR}
  AUTO_SHUTDOWN=0|1      Set to 1 to halt instance after 'full'

Typical workflow:
  # 1. SSH to g5.12xlarge, then:
  $0 bootstrap
  # 2. Build dataset + train V10.0:
  $0 full v10.0
  # 3. Iterate:
  $0 iterate v10.0 v10.1
  $0 iterate v10.1 v10.2
EOF
    ;;
esac
