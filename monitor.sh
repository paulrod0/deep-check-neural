#!/bin/bash
# === Deep-Check Training Monitor ===
# Usage: bash monitor.sh [v9|doc|metrics|gpu|both]

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'; BOLD='\033[1m'

V9_INST="i-027f26e44cea55363"
V9_IP="3.253.40.29"
DOC_INST="i-0105e7979c9ad73a0"
DOC_IP="54.229.204.211"
REGION="eu-west-1"
KEY="$HOME/.ssh/id_ed25519.pub"

connect() {
    aws ec2-instance-connect send-ssh-public-key --instance-id "$1" --instance-os-user ubuntu --ssh-public-key "file://$KEY" --region $REGION 2>/dev/null >/dev/null
}

watch_v9() {
    echo -e "${CYAN}${BOLD}=== V9.1 (DINOv3+Freq+SRM+RGB) — $V9_IP ===${NC}"
    connect $V9_INST && ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o ServerAliveInterval=10 ubuntu@$V9_IP "tail -f /home/ubuntu/training/v9_freq/train.log 2>/dev/null || tail -f /home/ubuntu/training/v9_modern/train.log 2>/dev/null" 2>/dev/null
}

watch_doc() {
    echo -e "${GREEN}${BOLD}=== Doc Forensics V2 — $DOC_IP ===${NC}"
    connect $DOC_INST && ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o ServerAliveInterval=10 ubuntu@$DOC_IP "tail -f /home/ubuntu/training/doc_v2/train.log 2>/dev/null || tail -f /home/ubuntu/training/doc_forensics/train.log 2>/dev/null" 2>/dev/null
}

metrics_v9() {
    connect $V9_INST && ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no ubuntu@$V9_IP 'python3 -c "
import json
files = [\"/home/ubuntu/training/v9_freq/metrics.jsonl\", \"/home/ubuntu/training/v9_modern/metrics.jsonl\"]
for f in files:
    try:
        with open(f) as fh:
            lines = fh.readlines()
            if lines:
                name = f.split(\"/\")[-2]
                print(f\"\n--- {name} ---\")
                for l in lines[-5:]:
                    d = json.loads(l)
                    print(f\"  E{d[chr(101)+chr(112)+chr(111)+chr(99)+chr(104)]:02d} [{d[chr(112)+chr(104)+chr(97)+chr(115)+chr(101)]}] val_auc={d[chr(118)+chr(97)+chr(108)+chr(95)+chr(97)+chr(117)+chr(99)]:.4f} val_eer={d[chr(118)+chr(97)+chr(108)+chr(95)+chr(101)+chr(101)+chr(114)]:.4f} train_loss={d[chr(116)+chr(114)+chr(97)+chr(105)+chr(110)+chr(95)+chr(108)+chr(111)+chr(115)+chr(115)]:.4f}\")
    except: pass
"' 2>/dev/null
}

metrics_doc() {
    connect $DOC_INST && ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no ubuntu@$DOC_IP 'python3 -c "
import json
files = [\"/home/ubuntu/training/doc_v2/metrics.jsonl\", \"/home/ubuntu/training/doc_forensics/metrics.jsonl\"]
for f in files:
    try:
        with open(f) as fh:
            lines = fh.readlines()
            if lines:
                name = f.split(\"/\")[-2]
                print(f\"\n--- {name} ---\")
                for l in lines[-5:]:
                    d = json.loads(l)
                    e = d.get(\"epoch\",0)
                    auc = d.get(\"val_auc\",0)
                    eer = d.get(\"val_eer\",0)
                    tl = d.get(\"train_loss\",0)
                    print(f\"  E{e:02d} val_auc={auc:.4f} val_eer={eer:.4f} train_loss={tl:.4f}\")
    except: pass
"' 2>/dev/null
}

gpu_status() {
    echo -e "\n${YELLOW}${BOLD}=== GPU STATUS ===${NC}"
    connect $V9_INST && echo -e "${CYAN}V9 ($V9_IP):${NC}" && ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ubuntu@$V9_IP "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader 2>/dev/null" 2>/dev/null
    connect $DOC_INST && echo -e "${GREEN}Doc ($DOC_IP):${NC}" && ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ubuntu@$DOC_IP "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader 2>/dev/null" 2>/dev/null
}

case "${1:-both}" in
    v9)      watch_v9 ;;
    doc)     watch_doc ;;
    metrics) metrics_v9; metrics_doc ;;
    gpu)     gpu_status ;;
    both)
        echo -e "${BOLD}Deep-Check Training Monitor${NC}\n"
        metrics_v9; metrics_doc; gpu_status
        echo -e "\n${BOLD}Commands:${NC}"
        echo "  bash monitor.sh v9      # V9.1 live batches (tail -f)"
        echo "  bash monitor.sh doc     # Doc Forensics live batches"
        echo "  bash monitor.sh metrics # Latest epoch metrics"
        echo "  bash monitor.sh gpu     # GPU utilization"
        ;;
esac
