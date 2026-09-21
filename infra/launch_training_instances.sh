#!/bin/bash
# =============================================================================
# launch_training_instances.sh — Launch parallel EC2 training instances
# =============================================================================
# Launches 2 g5.xlarge instances in eu-west-1 for parallel model training:
#   1. General AI Image Detector (CIFAKE + multiple Kaggle datasets)
#   2. Document Forensics Detector (synthetic manipulations)
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - Key pair: deep-check-v4-key (already exists in eu-west-1)
#   - IAM profile: deep-check-ec2-training (already exists)
#   - S3 bucket: deep-check-models (already exists)
#
# WARNING: DO NOT touch the V4 training instance at 34.240.143.117
#
# NOTE: Uses Spot instances by default (On-Demand G/VT vCPU limit is 0,
#       Spot limit is 16 vCPU = 4x g5.xlarge). Use --on-demand to override.
#
# Usage:
#   bash infra/launch_training_instances.sh
#   bash infra/launch_training_instances.sh --dry-run    # Preview commands only
#   bash infra/launch_training_instances.sh --ai-only    # Launch only AI detector
#   bash infra/launch_training_instances.sh --doc-only   # Launch only doc forensics
#   bash infra/launch_training_instances.sh --on-demand  # Use on-demand (needs quota)
# =============================================================================
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REGION="${AWS_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.xlarge}"
KEY_NAME="${KEY_NAME:-deep-check-v4-key}"
IAM_PROFILE="${IAM_PROFILE:-deep-check-ec2-training}"
VOLUME_SIZE=200
DRY_RUN=false
LAUNCH_AI=true
LAUNCH_DOC=true
USE_SPOT=true

# Kaggle credentials (update these or set as env vars)
KAGGLE_USERNAME="${KAGGLE_USERNAME:-kgat_7f852c46aaa9faaea565d0ccdf1c426c}"
KAGGLE_KEY="${KAGGLE_KEY:-}"

# ── Parse arguments ──────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --dry-run)    DRY_RUN=true ;;
        --ai-only)    LAUNCH_DOC=false ;;
        --doc-only)   LAUNCH_AI=false ;;
        --on-demand)  USE_SPOT=false ;;
        --help)
            echo "Usage: $0 [--dry-run] [--ai-only] [--doc-only]"
            exit 0
            ;;
    esac
done

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}=== $* ===${NC}"; }

# ── Preflight checks ────────────────────────────────────────────────────────
step "Preflight Checks"

command -v aws >/dev/null 2>&1 || error "AWS CLI not found. Install: https://aws.amazon.com/cli/"

info "Checking AWS credentials..."
AWS_IDENTITY=$(aws sts get-caller-identity --region "$REGION" --output json 2>&1) || \
    error "AWS credentials not configured. Run: aws configure"
AWS_ACCOUNT=$(echo "$AWS_IDENTITY" | python3 -c "import json,sys; print(json.load(sys.stdin)['Account'])" 2>/dev/null || echo "unknown")
info "AWS Account: ${AWS_ACCOUNT}"

if [ -z "$KAGGLE_KEY" ]; then
    warn "KAGGLE_KEY not set. Training scripts will fail to download datasets."
    warn "Set it: export KAGGLE_KEY=your_key_here"
    warn "Or the instances can use pre-existing Kaggle config (~/.kaggle/kaggle.json)"
fi

# ── Find Deep Learning AMI ──────────────────────────────────────────────────
step "Finding Deep Learning AMI"

info "Searching for latest DL AMI with PyTorch + CUDA in ${REGION}..."

# Try Ubuntu DL AMI first (more compatible with our scripts)
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners amazon \
    --filters \
        "Name=name,Values=Deep Learning AMI GPU PyTorch 2.* (Ubuntu 22.04)*" \
        "Name=state,Values=available" \
        "Name=architecture,Values=x86_64" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" \
    --output text 2>/dev/null || echo "None")

if [[ "$AMI_ID" == "None" || -z "$AMI_ID" ]]; then
    # Fallback: Amazon Linux DL AMI
    AMI_ID=$(aws ec2 describe-images \
        --region "$REGION" \
        --owners amazon \
        --filters \
            "Name=name,Values=Deep Learning AMI GPU PyTorch 2.* (Amazon Linux 2)*" \
            "Name=state,Values=available" \
        --query "sort_by(Images, &CreationDate)[-1].ImageId" \
        --output text 2>/dev/null || echo "None")
fi

if [[ "$AMI_ID" == "None" || -z "$AMI_ID" ]]; then
    # Fallback: any DL AMI
    AMI_ID=$(aws ec2 describe-images \
        --region "$REGION" \
        --owners amazon \
        --filters \
            "Name=name,Values=Deep Learning*PyTorch*" \
            "Name=state,Values=available" \
        --query "sort_by(Images, &CreationDate)[-1].ImageId" \
        --output text 2>/dev/null || echo "None")
fi

if [[ "$AMI_ID" == "None" || -z "$AMI_ID" ]]; then
    error "No Deep Learning AMI found in ${REGION}. Set AMI_ID manually: export AMI_ID=ami-xxxxx"
fi

AMI_NAME=$(aws ec2 describe-images --region "$REGION" --image-ids "$AMI_ID" \
    --query "Images[0].Name" --output text 2>/dev/null || echo "unknown")
info "AMI: ${AMI_ID} (${AMI_NAME})"

# ── Security Group ───────────────────────────────────────────────────────────
step "Security Group"

SG_NAME="deep-check-training-sg"
SG_ID=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters "Name=group-name,Values=${SG_NAME}" \
    --query "SecurityGroups[0].GroupId" \
    --output text 2>/dev/null || echo "None")

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
    info "Creating security group: ${SG_NAME}"
    if [ "$DRY_RUN" = false ]; then
        SG_ID=$(aws ec2 create-security-group \
            --region "$REGION" \
            --group-name "$SG_NAME" \
            --description "Deep-Check model training instances" \
            --query "GroupId" --output text)
        # Allow SSH for monitoring
        aws ec2 authorize-security-group-ingress \
            --region "$REGION" --group-id "$SG_ID" \
            --protocol tcp --port 22 --cidr 0.0.0.0/0 2>/dev/null || true
    else
        SG_ID="sg-DRYRUN"
    fi
fi
info "Security Group: ${SG_ID}"

# ── Upload training scripts to S3 ───────────────────────────────────────────
step "Uploading Training Scripts to S3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$DRY_RUN" = false ]; then
    info "Uploading train_ai_image_detector.py..."
    aws s3 cp "${PROJECT_DIR}/ml/train_ai_image_detector.py" \
        "s3://${S3_BUCKET}/scripts/train_ai_image_detector.py" \
        --region "$REGION"

    info "Uploading train_document_forensics.py..."
    aws s3 cp "${PROJECT_DIR}/ml/train_document_forensics.py" \
        "s3://${S3_BUCKET}/scripts/train_document_forensics.py" \
        --region "$REGION"
    info "Scripts uploaded"
else
    info "[DRY RUN] Would upload training scripts to s3://${S3_BUCKET}/scripts/"
fi

# ── Helper function to prepare user data ─────────────────────────────────────
prepare_userdata() {
    local SCRIPT_FILE="$1"
    local USER_DATA
    USER_DATA=$(cat "$SCRIPT_FILE")
    USER_DATA="${USER_DATA//__KAGGLE_USERNAME__/$KAGGLE_USERNAME}"
    USER_DATA="${USER_DATA//__KAGGLE_KEY__/$KAGGLE_KEY}"
    echo "$USER_DATA" | base64
}

# ── Helper function to launch an instance ─────────────────────────────────────
launch_instance() {
    local NAME="$1"
    local USERDATA_FILE="$2"
    local TAG_NAME="$3"

    step "Launching: ${TAG_NAME}"

    local USERDATA_B64
    USERDATA_B64=$(prepare_userdata "$USERDATA_FILE")

    local CMD="aws ec2 run-instances \
        --region ${REGION} \
        --image-id ${AMI_ID} \
        --instance-type ${INSTANCE_TYPE} \
        --key-name ${KEY_NAME} \
        --iam-instance-profile Name=${IAM_PROFILE} \
        --security-group-ids ${SG_ID} \
        --block-device-mappings '[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_SIZE},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]' \
        --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=${TAG_NAME}},{Key=Project,Value=deep-check},{Key=Training,Value=parallel}]' \
        --user-data ${USERDATA_B64} \
        --output json"

    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would run:"
        echo "  Instance type: ${INSTANCE_TYPE}"
        echo "  AMI: ${AMI_ID}"
        echo "  Key: ${KEY_NAME}"
        echo "  IAM Profile: ${IAM_PROFILE}"
        echo "  Volume: ${VOLUME_SIZE}GB gp3"
        echo "  Tag: ${TAG_NAME}"
        echo "  User data: ${USERDATA_FILE}"
        return 0
    fi

    local MARKET_TYPE="Spot"
    local SPOT_ARGS=""
    if [ "$USE_SPOT" = true ]; then
        SPOT_ARGS='--instance-market-options {"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time","InstanceInterruptionBehavior":"terminate"}}'
    else
        MARKET_TYPE="On-Demand"
    fi
    info "Launching ${INSTANCE_TYPE} instance (${MARKET_TYPE})..."
    local RESULT
    local LAUNCH_CMD=(aws ec2 run-instances
        --region "$REGION"
        --image-id "$AMI_ID"
        --instance-type "$INSTANCE_TYPE"
        --key-name "$KEY_NAME"
        --iam-instance-profile "Name=${IAM_PROFILE}"
        --security-group-ids "$SG_ID"
        --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_SIZE},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]"
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${TAG_NAME}},{Key=Project,Value=deep-check},{Key=Training,Value=parallel}]"
        --user-data "$USERDATA_B64"
        --output json)
    if [ "$USE_SPOT" = true ]; then
        LAUNCH_CMD+=(--instance-market-options '{"MarketType":"spot","SpotOptions":{"SpotInstanceType":"one-time","InstanceInterruptionBehavior":"terminate"}}')
    fi
    RESULT=$("${LAUNCH_CMD[@]}" 2>&1) || {
        warn "Failed to launch ${TAG_NAME}"
        echo "$RESULT"
        return 1
    }

    local INSTANCE_ID
    INSTANCE_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['Instances'][0]['InstanceId'])" 2>/dev/null)
    info "Instance: ${INSTANCE_ID}"

    # Wait for public IP
    echo -n "  Waiting for public IP"
    local IP=""
    for i in $(seq 1 30); do
        IP=$(aws ec2 describe-instances \
            --region "$REGION" \
            --instance-ids "$INSTANCE_ID" \
            --query "Reservations[0].Instances[0].PublicIpAddress" \
            --output text 2>/dev/null || echo "None")
        if [[ -n "$IP" && "$IP" != "None" ]]; then
            echo ""
            break
        fi
        echo -n "."
        sleep 5
    done

    if [[ -z "$IP" || "$IP" == "None" ]]; then
        warn "No public IP assigned. Instance may be in a private subnet."
        IP="(check AWS console)"
    fi

    info "${TAG_NAME} launched successfully!"
    echo "  Instance ID: ${INSTANCE_ID}"
    echo "  Public IP:   ${IP}"
    echo "  SSH:         ssh -i /tmp/deep-check-v4-key.pem ubuntu@${IP}"
    echo "  Monitor:     ssh -i /tmp/deep-check-v4-key.pem ubuntu@${IP} 'tmux attach -t ai_detector_train'"

    # Save instance info
    echo "${INSTANCE_ID}|${IP}|${TAG_NAME}" >> /tmp/deep-check-training-instances.txt
    echo "$INSTANCE_ID"
}

# ── Launch instances ─────────────────────────────────────────────────────────

echo "" > /tmp/deep-check-training-instances.txt 2>/dev/null || true

if [ "$LAUNCH_AI" = true ]; then
    AI_INSTANCE=$(launch_instance \
        "ai_detector" \
        "${SCRIPT_DIR}/userdata_ai_detector.sh" \
        "deep-check-ai-detector-training") || true
fi

if [ "$LAUNCH_DOC" = true ]; then
    DOC_INSTANCE=$(launch_instance \
        "doc_forensics" \
        "${SCRIPT_DIR}/userdata_doc_forensics.sh" \
        "deep-check-doc-forensics-training") || true
fi

# ── Summary ──────────────────────────────────────────────────────────────────
step "Summary"

echo ""
info "Parallel training instances:"
echo ""
echo "  EXISTING (DO NOT TOUCH):"
echo "    V4 Deepfake Training    34.240.143.117   (running)"
echo ""
echo "  NEW:"
if [ "$LAUNCH_AI" = true ]; then
    echo "    AI Image Detector       ${AI_INSTANCE:-failed}"
fi
if [ "$LAUNCH_DOC" = true ]; then
    echo "    Document Forensics      ${DOC_INSTANCE:-failed}"
fi
echo ""
echo "  Instance type:  ${INSTANCE_TYPE} (A10G GPU, 24GB VRAM)"
echo "  Region:         ${REGION}"
echo "  Est. cost:      ~\$1.01/hr per instance"
echo "  Est. training:  ~6-12 hours each"
echo "  Est. total:     ~\$6-12 per model"
echo ""
info "Results will be uploaded to:"
echo "  s3://${S3_BUCKET}/ai_image_detector/"
echo "  s3://${S3_BUCKET}/document_forensics/"
echo ""
info "Monitor training progress:"
echo "  # AI Image Detector"
echo "  aws s3 cp s3://${S3_BUCKET}/ai_image_detector/history.jsonl - | tail -5"
echo ""
echo "  # Document Forensics"
echo "  aws s3 cp s3://${S3_BUCKET}/document_forensics/history.jsonl - | tail -5"
echo ""
info "Instance IDs saved to /tmp/deep-check-training-instances.txt"
echo ""
warn "Remember to terminate instances when training is complete:"
echo "  aws ec2 terminate-instances --instance-ids <id1> <id2> --region ${REGION}"
