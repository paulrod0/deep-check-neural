#!/bin/bash
# ╔═══════════════════════════════════════════════════════════╗
# ║  DEEP-CHECK NEURAL OPS DASHBOARD v2                      ║
# ║  Real-time multi-instance training monitor                ║
# ╚═══════════════════════════════════════════════════════════╝
# Usage: bash dashboard.sh         (single shot)
#        bash dashboard.sh --loop  (auto-refresh 45s)

AWS=/opt/homebrew/bin/aws
KEY="$HOME/.ssh/id_ed25519.pub"
RG="eu-west-1"

# Instances
declare -A INST=( [v11]="i-07189a89d5f7f254a" [v9]="i-027f26e44cea55363" [doc]="i-0105e7979c9ad73a0" )
declare -A IPS=( [v11]="18.201.230.25" [v9]="3.251.71.121" [doc]="54.229.204.211" )

# Colors
R='\033[0;31m'; G='\033[0;32m'; C='\033[0;36m'; Y='\033[1;33m'
B='\033[0;34m'; M='\033[0;35m'; W='\033[1;37m'; N='\033[0m'
D='\033[2m'; BD='\033[1m'; UL='\033[4m'
BG_R='\033[41m'; BG_G='\033[42m'; BG_B='\033[44m'; BG_M='\033[45m'; BG_C='\033[46m'

ssh_q() { $AWS ec2-instance-connect send-ssh-public-key --instance-id "${INST[$1]}" --instance-os-user ubuntu --ssh-public-key "file://$KEY" --region $RG >/dev/null 2>&1; ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o LogLevel=ERROR ubuntu@"${IPS[$1]}" "$2" 2>/dev/null; }

bar() {
    local v=$1 mx=$2 w=${3:-20} c=${4:-$G}
    local f=$(awk "BEGIN{printf \"%d\",($v/$mx)*$w}")
    [ $f -gt $w ] && f=$w; [ $f -lt 0 ] && f=0
    local e=$((w-f))
    printf "${c}"; for((i=0;i<f;i++)); do printf "█"; done
    printf "${D}"; for((i=0;i<e;i++)); do printf "░"; done
    printf "${N}"
}

eer_color() {
    local v=$1
    if (( $(echo "$v < 5" | bc -l 2>/dev/null || echo 0) )); then echo -ne "${G}"
    elif (( $(echo "$v < 10" | bc -l 2>/dev/null || echo 0) )); then echo -ne "${Y}"
    else echo -ne "${R}"; fi
}

render() {
    clear
    local ts=$(date '+%H:%M:%S')
    local dt=$(date '+%Y-%m-%d')

    # Header
    echo -e "${D}────────────────────────────────────────────────────────────────────${N}"
    echo -e "${BD}${C}  ██████╗ ███████╗███████╗██████╗        ██████╗██╗  ██╗${N}"
    echo -e "${BD}${C}  ██╔══██╗██╔════╝██╔════╝██╔══██╗      ██╔════╝██║ ██╔╝${N}"
    echo -e "${BD}${C}  ██║  ██║█████╗  █████╗  ██████╔╝█████╗██║     █████╔╝${N}"
    echo -e "${BD}${C}  ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════╝██║     ██╔═██╗${N}"
    echo -e "${BD}${C}  ██████╔╝███████╗███████╗██║            ╚██████╗██║  ██╗${N}"
    echo -e "${BD}${C}  ╚═════╝ ╚══════╝╚══════╝╚═╝             ╚═════╝╚═╝  ╚═╝${N}"
    echo -e "${D}  NEURAL OPS DASHBOARD              ${dt} ${W}${ts}${N}"
    echo -e "${D}────────────────────────────────────────────────────────────────────${N}"
    echo ""

    # === V10 C-RADIOv4 ===
    echo -e "${BD}${BG_C}${W} V11 SigLIP SO400M + Focal Loss (428M) ${N}  ${D}g5.12xlarge · 4×A10G · ${IPS[v11]}${N}"
    local v10m=$(ssh_q v11 "tail -1 /home/ubuntu/training/v11_siglip/metrics.jsonl 2>/dev/null")
    local v10l=$(ssh_q v11 "tail -1 /home/ubuntu/training/v11_siglip/train.log 2>/dev/null")
    local v10g=$(ssh_q v11 "nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader 2>/dev/null | head -1")

    if [ -n "$v10m" ] && echo "$v10m" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
        local ep=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d['epoch'])" 2>/dev/null)
        local auc=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_auc']:.4f}\")" 2>/dev/null)
        local eer=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_eer']*100:.1f}\")" 2>/dev/null)
        local ph=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d['phase'])" 2>/dev/null)
        local gap=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d.get('gap',0):.3f}\")" 2>/dev/null)
        local tm=$(echo "$v10m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['time_s']/60:.0f}\")" 2>/dev/null)
        echo -e "  ${D}epoch${N} ${W}${ep}${N}  ${D}phase${N} ${C}${ph}${N}  ${D}time${N} ${tm}min/ep"
        echo -ne "  ${D}val_auc${N}  "; bar ${auc/./} 10000 25 "$G"; echo -e " ${G}${auc}${N}"
        echo -ne "  ${D}val_eer${N}  "; eer_color $eer; echo -e "${eer}%${N}  ${D}gap${N} ${gap}"
    else
        echo -e "  ${Y}⟳${N} ${D}$(echo $v10l | tail -c 70)${N}"
    fi
    echo -e "  ${D}gpu${N} ${v10g:-${R}offline${N}}"
    echo ""

    # === V9 Retrain ===
    echo -e "${BD}${BG_G}${W} V9.4 DINOv3+MJ Retrain ${N}  ${D}g5.xlarge · 1×A10G · ${IPS[v9]}${N}"
    local v9m=$(ssh_q v9 "tail -1 /home/ubuntu/training/v9_simple/metrics.jsonl 2>/dev/null")
    local v9l=$(ssh_q v9 "tail -1 /home/ubuntu/training/v9_simple/train.log 2>/dev/null")
    local v9g=$(ssh_q v9 "nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader 2>/dev/null")

    if [ -n "$v9m" ] && echo "$v9m" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
        local ep=$(echo "$v9m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d['epoch'])" 2>/dev/null)
        local auc=$(echo "$v9m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_auc']:.4f}\")" 2>/dev/null)
        local eer=$(echo "$v9m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_eer']*100:.1f}\")" 2>/dev/null)
        local ph=$(echo "$v9m"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d['phase'])" 2>/dev/null)
        echo -e "  ${D}epoch${N} ${W}${ep}${N}  ${D}phase${N} ${G}${ph}${N}"
        echo -ne "  ${D}val_auc${N}  "; bar ${auc/./} 10000 25 "$G"; echo -e " ${G}${auc}${N}"
        echo -ne "  ${D}val_eer${N}  "; eer_color $eer; echo -e "${eer}%${N}"
    else
        echo -e "  ${Y}⟳${N} ${D}$(echo $v9l | tail -c 70)${N}"
    fi
    echo -e "  ${D}gpu${N} ${v9g:-${R}offline${N}}"
    echo ""

    # === Doc ICAO ===
    echo -e "${BD}${BG_M}${W} Doc ICAO Classifier ${N}  ${D}g5.xlarge · 1×A10G · ${IPS[doc]}${N}"
    local docm=$(ssh_q doc "tail -1 /home/ubuntu/training/doc_icao/metrics.jsonl 2>/dev/null")
    local docl=$(ssh_q doc "tail -1 /home/ubuntu/training/doc_icao/train.log 2>/dev/null")
    local docg=$(ssh_q doc "nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader 2>/dev/null")

    if [ -n "$docm" ] && echo "$docm" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
        local ep=$(echo "$docm"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(d['epoch'])" 2>/dev/null)
        local auc=$(echo "$docm"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_auc']:.4f}\")" 2>/dev/null)
        local eer=$(echo "$docm"|python3 -c "import json,sys;d=json.loads(sys.stdin.read());print(f\"{d['val_eer']*100:.1f}\")" 2>/dev/null)
        echo -e "  ${D}epoch${N} ${W}${ep}${N}"
        echo -ne "  ${D}val_auc${N}  "; bar ${auc/./} 10000 25 "$M"; echo -e " ${M}${auc}${N}"
        echo -ne "  ${D}val_eer${N}  "; eer_color $eer; echo -e "${eer}%${N}"
    else
        echo -e "  ${Y}⟳${N} ${D}$(echo $docl | tail -c 70)${N}"
    fi
    echo -e "  ${D}gpu${N} ${docg:-${R}offline${N}}"
    echo ""

    # === Completed models ===
    echo -e "${D}────────────────────────────────────────────────────────────────────${N}"
    echo -e "${BD} PRODUCTION MODELS${N}"
    echo -e "  ${G}■${N} Doc Forensics V2b     ${D}auc${N} ${G}0.998${N}  ${D}eer${N} ${G}1.87%${N}   ${BG_G}${W} DEPLOYED ${N}"
    echo -e "  ${G}■${N} Doc ICAO IDNet        ${D}auc${N} ${G}0.999${N}  ${D}eer${N} ${G}2.1%${N}    ${BG_G}${W} DEPLOYED ${N}"
    echo -e "  ${G}■${N} Keystroke Biometrics  ${D}auc${N} ${G}0.949${N}  ${D}acc${N} ${G}90.8%${N}   ${BG_G}${W} DEPLOYED ${N}"
    echo -e "  ${G}■${N} Gemma 4 E4B           ${D}OCR+MRZ+Coherence${N}  ${BG_G}${W} INTEGRATED ${N}"
    echo -e "  ${Y}■${N} Deepfake V9 DINOv3    ${D}auc${N} ${Y}0.943${N}  ${D}eer${N} ${Y}13.2%${N}   ${BG_B}${W} BASELINE ${N}"
    echo -e "  ${G}■${N} Ensemble V9+V3+TTA    ${D}10 passes${N}          ${BG_G}${W} READY ${N}"
    echo ""
    echo -e "${D}────────────────────────────────────────────────────────────────────${N}"
    echo -e "${BD} INFRA${N}  ${D}quota${N} 64 vCPU  ${D}used${N} 56 vCPU  ${D}cost${N} ~\$8.09/h"
    echo -e "  ${C}▸${N} g5.12xlarge  48cpu  4×A10G  96GB   ${D}\$5.67/h${N}"
    echo -e "  ${G}▸${N} g5.xlarge     4cpu  1×A10G  24GB   ${D}\$1.21/h${N}"
    echo -e "  ${M}▸${N} g5.xlarge     4cpu  1×A10G  24GB   ${D}\$1.21/h${N}"
    echo -e "${D}────────────────────────────────────────────────────────────────────${N}"
}

if [ "$1" = "--loop" ]; then
    while true; do
        render
        echo -e "\n${D}  ⟳ refreshing in 45s · ctrl+c to exit${N}"
        sleep 45
    done
else
    render
fi
