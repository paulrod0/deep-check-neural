#!/usr/bin/env bash
# ec2_spot_train_docforensics.sh — Launch DocForensics CNN training on EC2 Spot g4dn.xlarge
#
# Same infrastructure pattern as BiLSTM training (existing deep-check infra).
# Prerequisites:
#   - AWS CLI configured with appropriate IAM role
#   - S3 bucket: s3://deep-check-models/
#   - EC2 IAM role with s3:PutObject on deep-check-models
#
# Usage:
#   ./infra/ec2_spot_train_docforensics.sh [--epochs 50] [--samples 200]

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

REGION="${AWS_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
S3_PREFIX="docforensics"
AMI_ID="${AMI_ID:-$(aws ec2 describe-images \
  --owners amazon \
  --filters 'Name=name,Values=Deep Learning AMI GPU PyTorch 2.* (Amazon Linux 2)*' \
            'Name=state,Values=available' \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text \
  --region "$REGION")}"
INSTANCE_TYPE="g4dn.xlarge"
KEY_NAME="${EC2_KEY_NAME:-}"
SECURITY_GROUP="${EC2_SECURITY_GROUP:-}"
SUBNET_ID="${EC2_SUBNET_ID:-}"
IAM_ROLE="${EC2_IAM_ROLE:-}"

EPOCHS="${EPOCHS:-50}"
SAMPLES_PER_CLASS="${SAMPLES_PER_CLASS:-200}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── User data script ──────────────────────────────────────────────────────────

USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -e

# Activate PyTorch environment
source /opt/conda/etc/profile.d/conda.sh
conda activate pytorch

# Install dependencies
pip install -q torchvision pillow

# Upload training script from S3 (uploaded just before this script runs)
aws s3 cp "s3://PLACEHOLDER_BUCKET/docforensics/train_docforensics.py" /tmp/train_docforensics.py

# Run training
python /tmp/train_docforensics.py \
  --output-dir /tmp/docforensics_output \
  --s3-bucket PLACEHOLDER_BUCKET \
  --s3-prefix PLACEHOLDER_PREFIX \
  --epochs PLACEHOLDER_EPOCHS \
  --samples-per-class PLACEHOLDER_SAMPLES

# Signal completion
touch /tmp/training_complete
USERDATA
)

# Replace placeholders
USER_DATA="${USER_DATA//PLACEHOLDER_BUCKET/$S3_BUCKET}"
USER_DATA="${USER_DATA//PLACEHOLDER_PREFIX/$S3_PREFIX}"
USER_DATA="${USER_DATA//PLACEHOLDER_EPOCHS/$EPOCHS}"
USER_DATA="${USER_DATA//PLACEHOLDER_SAMPLES/$SAMPLES_PER_CLASS}"

# ── Upload training script to S3 ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Uploading training script to s3://${S3_BUCKET}/${S3_PREFIX}/train_docforensics.py"
aws s3 cp "${SCRIPT_DIR}/train_docforensics.py" \
  "s3://${S3_BUCKET}/${S3_PREFIX}/train_docforensics.py" \
  --region "$REGION"

# ── Launch Spot instance ──────────────────────────────────────────────────────

log "Launching Spot instance: ${INSTANCE_TYPE} in ${REGION}"

LAUNCH_ARGS=(
  --image-id             "$AMI_ID"
  --instance-type        "$INSTANCE_TYPE"
  --user-data            "$(echo "$USER_DATA" | base64)"
  --instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time","InstanceInterruptionBehavior":"terminate"}}'
  --region               "$REGION"
  --tag-specifications   "ResourceType=instance,Tags=[{Key=Name,Value=deep-check-docforensics-train},{Key=Project,Value=deep-check}]"
)

[ -n "$KEY_NAME" ]       && LAUNCH_ARGS+=(--key-name "$KEY_NAME")
[ -n "$SECURITY_GROUP" ] && LAUNCH_ARGS+=(--security-group-ids "$SECURITY_GROUP")
[ -n "$SUBNET_ID" ]      && LAUNCH_ARGS+=(--subnet-id "$SUBNET_ID")
[ -n "$IAM_ROLE" ]       && LAUNCH_ARGS+=(--iam-instance-profile "Name=$IAM_ROLE")

INSTANCE_JSON=$(aws ec2 run-instances "${LAUNCH_ARGS[@]}" --output json)
INSTANCE_ID=$(echo "$INSTANCE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['Instances'][0]['InstanceId'])")

log "Launched instance: ${INSTANCE_ID}"
log "Training started. Monitor progress:"
log "  aws ec2 describe-instance-status --instance-ids ${INSTANCE_ID} --region ${REGION}"
log ""
log "Model will be uploaded to: s3://${S3_BUCKET}/${S3_PREFIX}/model.onnx"
log "Expected training time: ~1.5 hours (~\$0.24 on Spot g4dn.xlarge)"
log ""
log "To terminate early:"
log "  aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --region ${REGION}"

echo "$INSTANCE_ID" > /tmp/docforensics_training_instance_id.txt
log "Instance ID saved to /tmp/docforensics_training_instance_id.txt"
