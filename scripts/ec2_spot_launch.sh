#!/usr/bin/env bash
# Deep-Check V10 — One-command EC2 spot instance launcher (run from local).
#
# Spins up a g5.12xlarge spot instance with automatic bootstrap + training.
# Uploads results to S3 and auto-terminates on completion.
#
# Usage:
#   ./ec2_spot_launch.sh dataset                    # Build V10.0 dataset only (~8h)
#   ./ec2_spot_launch.sh train v10.0                # Train V10.0 (~30h)
#   ./ec2_spot_launch.sh full v10.0                 # Full cycle (~40h)
#   ./ec2_spot_launch.sh iterate v10.0 v10.1        # Iteration cycle (~8h)
#   ./ec2_spot_launch.sh multimodal                 # AV + rPPG + fusion (~12h)
#
# Requires local AWS CLI configured with permissions for:
#   ec2:RunInstances, ec2:RequestSpotInstances, ec2:TerminateInstances,
#   s3:PutObject, s3:GetObject, iam:PassRole
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-eu-west-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.12xlarge}"
# Deep Learning OSS Nvidia Driver AMI GPU PyTorch — Ubuntu 22.04 (eu-west-1)
# Update via: aws ec2 describe-images --owners amazon --filters "Name=name,Values=*Deep Learning OSS*PyTorch*Ubuntu 22.04*"
AMI_ID="${AMI_ID:-ami-0e001c9271cf7f3b9}"
KEY_NAME="${KEY_NAME:-deep-check-v4-key}"
SEC_GROUP="${SEC_GROUP:-deep-check-train-sg}"
IAM_PROFILE="${IAM_PROFILE:-deep-check-ec2-training}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
REPO_URL="${REPO_URL:-https://github.com/paulrod0/deep-check.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SPOT_MAX_PRICE="${SPOT_MAX_PRICE:-6.00}"   # €/h, on-demand is €5.67

COMMAND="${1:-help}"
shift || true

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

build_user_data() {
  local inner_cmd="$1"
  cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec > >(tee /var/log/user-data.log | aws s3 cp - s3://$S3_BUCKET/logs/bootstrap-\$(curl -s http://169.254.169.254/latest/meta-data/instance-id).log) 2>&1

cd /home/ubuntu
sudo -u ubuntu git clone --branch $REPO_BRANCH $REPO_URL deep-check || true
cd deep-check

# Make scripts executable
chmod +x scripts/launch_ec2_v10.sh

sudo -u ubuntu AWS_DEFAULT_REGION=$REGION S3_BUCKET=$S3_BUCKET AUTO_SHUTDOWN=1 \\
  ./scripts/launch_ec2_v10.sh bootstrap

sudo -u ubuntu AWS_DEFAULT_REGION=$REGION S3_BUCKET=$S3_BUCKET AUTO_SHUTDOWN=1 \\
  ./scripts/launch_ec2_v10.sh $inner_cmd
EOF
}

launch_spot() {
  local inner_cmd="$1"
  local tag_name="deep-check-v10-$(echo "$inner_cmd" | tr ' ' '_')"

  local user_data_b64
  user_data_b64=$(build_user_data "$inner_cmd" | base64 | tr -d '\n')

  log "=== Requesting spot g5.12xlarge (max \$${SPOT_MAX_PRICE}/h) ==="
  log "Command: $inner_cmd"
  log "Instance will auto-terminate when complete."

  local launch_spec
  launch_spec=$(cat <<JSON
{
  "ImageId": "$AMI_ID",
  "InstanceType": "$INSTANCE_TYPE",
  "KeyName": "$KEY_NAME",
  "SecurityGroups": ["$SEC_GROUP"],
  "IamInstanceProfile": {"Name": "$IAM_PROFILE"},
  "UserData": "$user_data_b64",
  "BlockDeviceMappings": [
    {
      "DeviceName": "/dev/sda1",
      "Ebs": {
        "VolumeSize": 200,
        "VolumeType": "gp3",
        "DeleteOnTermination": true
      }
    }
  ]
}
JSON
  )

  local tmp_spec
  tmp_spec=$(mktemp)
  echo "$launch_spec" > "$tmp_spec"

  local request_id
  request_id=$(aws ec2 request-spot-instances \
    --region "$REGION" \
    --spot-price "$SPOT_MAX_PRICE" \
    --type "one-time" \
    --instance-count 1 \
    --launch-specification "file://$tmp_spec" \
    --query 'SpotInstanceRequests[0].SpotInstanceRequestId' \
    --output text)
  rm -f "$tmp_spec"

  log "Spot request: $request_id"
  log "Waiting for fulfillment..."

  aws ec2 wait spot-instance-request-fulfilled \
    --region "$REGION" \
    --spot-instance-request-ids "$request_id"

  local instance_id
  instance_id=$(aws ec2 describe-spot-instance-requests \
    --region "$REGION" \
    --spot-instance-request-ids "$request_id" \
    --query 'SpotInstanceRequests[0].InstanceId' \
    --output text)

  aws ec2 create-tags \
    --region "$REGION" \
    --resources "$instance_id" \
    --tags "Key=Name,Value=$tag_name" "Key=Project,Value=deep-check-v10"

  local public_ip
  public_ip=$(aws ec2 describe-instances \
    --region "$REGION" \
    --instance-ids "$instance_id" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

  log "FULFILLED instance=$instance_id public_ip=$public_ip"
  log ""
  log "=== Instance is bootstrapping. Monitor progress: ==="
  log "  SSH:   ssh -i /tmp/${KEY_NAME}.pem ubuntu@$public_ip"
  log "  Logs:  aws s3 ls s3://$S3_BUCKET/logs/bootstrap-$instance_id.log"
  log "  Tail:  aws s3 cp s3://$S3_BUCKET/logs/bootstrap-$instance_id.log - | tail -f"
  log "  Kill:  aws ec2 terminate-instances --region $REGION --instance-ids $instance_id"
  log ""
  log "Instance will auto-shutdown when '$inner_cmd' completes."
  log "Results will be uploaded to s3://$S3_BUCKET/"
}

monitor_running() {
  log "=== Currently running deep-check-v10 instances ==="
  aws ec2 describe-instances \
    --region "$REGION" \
    --filters \
      "Name=tag:Project,Values=deep-check-v10" \
      "Name=instance-state-name,Values=running,pending" \
    --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0],LaunchTime,PublicIpAddress,SpotInstanceRequestId]' \
    --output table
}

kill_all() {
  log "=== Terminating all deep-check-v10 instances ==="
  local ids
  ids=$(aws ec2 describe-instances \
    --region "$REGION" \
    --filters \
      "Name=tag:Project,Values=deep-check-v10" \
      "Name=instance-state-name,Values=running,pending" \
    --query 'Reservations[*].Instances[*].InstanceId' \
    --output text)
  if [[ -z "$ids" ]]; then
    log "No instances running."
    return 0
  fi
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --region "$REGION" --instance-ids $ids
  log "Terminated: $ids"
}

case "$COMMAND" in
  dataset)
    launch_spot "dataset"
    ;;
  train)
    version="${1:-v10.0}"
    launch_spot "train $version"
    ;;
  benchmark)
    version="${1:-v10.0}"
    launch_spot "benchmark $version"
    ;;
  iterate)
    cur="${1:-v10.0}"
    nxt="${2:-v10.1}"
    launch_spot "iterate $cur $nxt"
    ;;
  full)
    version="${1:-v10.0}"
    launch_spot "full $version"
    ;;
  multimodal)
    # Runs av extract + train, rppg extract + train, fusion train
    launch_spot "multimodal"
    ;;
  status)
    monitor_running
    ;;
  kill)
    kill_all
    ;;
  help|*)
    cat <<EOF
Deep-Check V10 — EC2 Spot Launcher

Usage:
  $0 <command> [args]

Commands:
  dataset                   Build V10.0 dataset (~8h, ~\$50)
  train <version>           Train <version> on 4x A10G (~30h, ~\$180)
  benchmark <version>       Run defense-grade benchmark
  iterate <cur> <next>      Continuous iteration cycle (~8h, ~\$50)
  full <version>            Full cycle: dataset + train + benchmark (~40h, ~\$230)
  multimodal                AV sync + rPPG + fusion training (~12h, ~\$70)
  status                    Show running instances
  kill                      Terminate all deep-check-v10 instances

Env vars (defaults shown):
  AWS_DEFAULT_REGION=$REGION
  INSTANCE_TYPE=$INSTANCE_TYPE
  AMI_ID=$AMI_ID
  KEY_NAME=$KEY_NAME
  SEC_GROUP=$SEC_GROUP
  IAM_PROFILE=$IAM_PROFILE
  S3_BUCKET=$S3_BUCKET
  REPO_URL=$REPO_URL
  REPO_BRANCH=$REPO_BRANCH
  SPOT_MAX_PRICE=$SPOT_MAX_PRICE   # €/h

Typical usage:
  # 1. Initial train
  $0 full v10.0

  # 2. Score with multimodal (AV + rPPG)
  $0 multimodal

  # 3. Iterate
  $0 iterate v10.0 v10.1
  $0 iterate v10.1 v10.2

  # 4. Monitor
  $0 status
EOF
    ;;
esac
