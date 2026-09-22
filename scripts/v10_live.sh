#!/usr/bin/env bash
# Live view of V10 training on EC2.
#
# Usage (from your laptop):
#   bash scripts/v10_live.sh              # Live tail all logs
#   bash scripts/v10_live.sh attach       # SSH + tmux attach to training session
#   bash scripts/v10_live.sh status       # Point-in-time snapshot
#   bash scripts/v10_live.sh gpu          # Live nvidia-smi
set -euo pipefail

INSTANCE_ID="i-07189a89d5f7f254a"
REGION="eu-west-1"
USER="ubuntu"

refresh_key() {
  if [[ ! -f /tmp/eic_temp ]]; then
    ssh-keygen -t rsa -f /tmp/eic_temp -N '' -q -m PEM
  fi
  aws ec2-instance-connect send-ssh-public-key \
    --region "$REGION" --instance-id "$INSTANCE_ID" \
    --instance-os-user "$USER" \
    --ssh-public-key file:///tmp/eic_temp.pub > /dev/null
}

get_ip() {
  aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
}

run_ssh() {
  refresh_key
  local ip
  ip=$(get_ip)
  ssh -i /tmp/eic_temp \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 \
    "$USER@$ip" "$@"
}

ssh_interactive() {
  refresh_key
  local ip
  ip=$(get_ip)
  ssh -i /tmp/eic_temp -t \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 \
    "$USER@$ip" "$@"
}

cmd_status() {
  run_ssh bash <<'REMOTE'
echo "=== tmux sessions ==="
tmux list-sessions 2>&1 | head -10
echo ""
echo "=== GPU ==="
nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv
echo ""
echo "=== Disk ==="
df -h / | tail -2
echo ""
echo "=== Processes (training/python) ==="
ps aux | grep -E "torchrun|train\.py|build_dataset" | grep -v grep | head -5
echo ""
echo "=== Dataset state ==="
ls -la ~/v10-data/video_v10/{train,val,test}/index.jsonl 2>/dev/null | head -4
echo "Clips: $(find ~/v10-data/video_v10/_clips -name "*.mp4" 2>/dev/null | wc -l)"
echo ""
echo "=== Checkpoints ==="
ls -la ~/v10-data/checkpoints/v10.0/ 2>/dev/null | head -5
echo ""
echo "=== Latest log ==="
for f in train.log orchestrate-v2.log orchestrate.log; do
  if [[ -f ~/v10-logs/$f ]]; then
    echo "--- $f (last 5 lines) ---"
    tail -5 ~/v10-logs/$f
    break
  fi
done
REMOTE
}

cmd_attach() {
  # Attach to the "train" session if it exists, else "orch"
  ssh_interactive 'tmux attach -t train 2>/dev/null || tmux attach -t orch 2>/dev/null || { echo "No running session. Run orchestrate.sh first."; exit 1; }'
}

cmd_live() {
  echo "===================================================="
  echo " Deep-Check V10 Live Monitor — Ctrl+C to exit"
  echo "===================================================="
  refresh_key
  local ip
  ip=$(get_ip)

  # Refresh key in background every 30s
  (
    while true; do
      sleep 30
      aws ec2-instance-connect send-ssh-public-key \
        --region "$REGION" --instance-id "$INSTANCE_ID" \
        --instance-os-user "$USER" \
        --ssh-public-key file:///tmp/eic_temp.pub > /dev/null 2>&1
    done
  ) &
  KEEPER_PID=$!
  trap "kill $KEEPER_PID 2>/dev/null; exit" INT TERM EXIT

  # Live tail: orchestrate log → train log (whichever is active)
  ssh -i /tmp/eic_temp \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 \
    "$USER@$ip" 'bash -s' <<'REMOTE'
# Wait for any log to appear
while true; do
  if [[ -f ~/v10-logs/train.log ]]; then
    clear; echo "=== Training log (live) ==="
    tail -f ~/v10-logs/train.log
    break
  elif [[ -f ~/v10-logs/orchestrate-v2.log ]]; then
    clear; echo "=== Orchestrate log (live) ==="
    tail -f ~/v10-logs/orchestrate-v2.log
    break
  elif [[ -f ~/v10-logs/orchestrate.log ]]; then
    clear; echo "=== Orchestrate log (live) ==="
    tail -f ~/v10-logs/orchestrate.log
    break
  else
    echo "Waiting for logs..."
    sleep 5
  fi
done
REMOTE
}

cmd_gpu() {
  echo "===================================================="
  echo " GPU live (1s refresh) — Ctrl+C to exit"
  echo "===================================================="
  refresh_key
  local ip
  ip=$(get_ip)
  (
    while true; do
      sleep 30
      aws ec2-instance-connect send-ssh-public-key \
        --region "$REGION" --instance-id "$INSTANCE_ID" \
        --instance-os-user "$USER" \
        --ssh-public-key file:///tmp/eic_temp.pub > /dev/null 2>&1
    done
  ) &
  KEEPER_PID=$!
  trap "kill $KEEPER_PID 2>/dev/null; exit" INT TERM EXIT

  ssh -i /tmp/eic_temp \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 \
    "$USER@$ip" 'watch -n 1 "nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv"'
}

mode="${1:-live}"
case "$mode" in
  status)   cmd_status ;;
  attach)   cmd_attach ;;
  live)     cmd_live ;;
  gpu)      cmd_gpu ;;
  *)
    cat <<EOF
Usage: $0 <command>

Commands:
  live      Live-tail logs (auto-picks train.log > orchestrate.log)
  attach    SSH into tmux session (interactive)
  status    One-shot snapshot: GPU + disk + procs + logs
  gpu       Live nvidia-smi 1s refresh

Examples:
  bash scripts/v10_live.sh live
  bash scripts/v10_live.sh status
  bash scripts/v10_live.sh attach   # press Ctrl+B then D to detach
EOF
    ;;
esac
