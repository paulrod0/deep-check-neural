#!/bin/bash
# =============================================================================
# userdata_doc_forensics.sh — EC2 user-data for Document Forensics training
# =============================================================================
# This script runs automatically when the EC2 instance boots.
# It sets up the environment, generates synthetic data, and trains the model.
# =============================================================================
set -euo pipefail
exec > /var/log/deep-check-doc-forensics-train.log 2>&1

echo "=============================================="
echo "  Deep-Check Document Forensics Training"
echo "  Started: $(date)"
echo "  Instance: $(curl -s http://169.254.169.254/latest/meta-data/instance-type)"
echo "=============================================="

# ── Config ───────────────────────────────────────────────────────────────
S3_BUCKET="deep-check-models"
REGION="eu-west-1"
KAGGLE_USERNAME="__KAGGLE_USERNAME__"
KAGGLE_KEY="__KAGGLE_KEY__"

# ── 1. Setup Python environment ──────────────────────────────────────────
echo "[1/6] Setting up Python environment..."

if [ -f /opt/conda/etc/profile.d/conda.sh ]; then
    source /opt/conda/etc/profile.d/conda.sh
    conda activate pytorch || conda activate base
elif [ -f /opt/pytorch/bin/python ]; then
    export PATH="/opt/pytorch/bin:$PATH"
fi

python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"

pip install -q --no-cache-dir \
    timm \
    albumentations \
    scikit-learn \
    kaggle \
    onnx \
    onnxruntime \
    boto3 \
    tqdm \
    Pillow \
    opencv-python-headless

echo "  Python packages installed"

# ── 2. Setup Kaggle credentials ──────────────────────────────────────────
echo "[2/6] Configuring Kaggle..."
mkdir -p ~/.kaggle
cat > ~/.kaggle/kaggle.json << KAGGLE_EOF
{"username":"${KAGGLE_USERNAME}","key":"${KAGGLE_KEY}"}
KAGGLE_EOF
chmod 600 ~/.kaggle/kaggle.json
echo "  Kaggle credentials configured"

# ── 3. Download training script from S3 ──────────────────────────────────
echo "[3/6] Downloading training script..."
mkdir -p /data/output/document_forensics
aws s3 cp "s3://${S3_BUCKET}/scripts/train_document_forensics.py" \
    /data/train_document_forensics.py \
    --region "$REGION" || {
    echo "  S3 download failed, training script not found"
    echo "  FATAL: Cannot proceed without training script"
    exit 1
}
echo "  Training script downloaded"

# ── 4. Setup data directory ──────────────────────────────────────────────
echo "[4/6] Setting up data directories..."
mkdir -p /data/document_forensics/raw
mkdir -p /data/output/document_forensics

# ── 5. Start training in tmux ────────────────────────────────────────────
echo "[5/6] Starting training in tmux session: doc_forensics_train"
tmux new-session -d -s doc_forensics_train 2>/dev/null || true
tmux send-keys -t doc_forensics_train \
    "python3 /data/train_document_forensics.py \
        --epochs 100 \
        --batch-size 32 \
        --lr 3e-4 \
        --synthetic-samples 50000 \
        --output document_forensics_v1.onnx \
    2>&1 | tee /data/output/document_forensics/train.log" Enter

echo "  Training launched in tmux"

# ── 6. Setup completion handler ──────────────────────────────────────────
echo "[6/6] Setting up completion handler..."

cat > /data/monitor_and_upload.sh << 'MONITOR_EOF'
#!/bin/bash
set -euo pipefail
S3_BUCKET="deep-check-models"
REGION="eu-west-1"
OUT_DIR="/data/output/document_forensics"

echo "Monitoring training completion..."
while true; do
    if [ -f "${OUT_DIR}/meta.json" ]; then
        echo "Training complete! Uploading final results..."
        aws s3 sync "${OUT_DIR}/" "s3://${S3_BUCKET}/document_forensics/" \
            --region "$REGION" \
            --exclude "*.tmp" \
            --exclude "__pycache__/*"
        echo "Upload complete: $(date)"
        break
    fi
    if [ -f "${OUT_DIR}/history.jsonl" ]; then
        aws s3 cp "${OUT_DIR}/history.jsonl" \
            "s3://${S3_BUCKET}/document_forensics/history.jsonl" \
            --region "$REGION" 2>/dev/null || true
    fi
    sleep 600
done

echo "=== Document Forensics Training Complete: $(date) ==="
# Optionally auto-terminate (uncomment to enable)
# INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
# aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
MONITOR_EOF
chmod +x /data/monitor_and_upload.sh

tmux new-session -d -s monitor 2>/dev/null || true
tmux send-keys -t monitor "bash /data/monitor_and_upload.sh 2>&1 | tee /data/monitor.log" Enter

echo ""
echo "=============================================="
echo "  Training setup complete!"
echo "  Monitor: tmux attach -t doc_forensics_train"
echo "  GPU:     watch -n5 nvidia-smi"
echo "  Log:     tail -f /data/output/document_forensics/train.log"
echo "=============================================="
