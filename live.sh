#!/bin/bash
# DEEP-CHECK LIVE MATRIX — 3-column real-time cascade
# Usage: bash live.sh
# Ctrl+C to exit

AWS=/opt/homebrew/bin/aws
KEY="$HOME/.ssh/id_ed25519.pub"
RG="eu-west-1"

V10_I="i-07189a89d5f7f254a"; V10="18.201.185.119"
V9_I="i-027f26e44cea55363"; V9="3.251.71.121"
DOC_I="i-0105e7979c9ad73a0"; DOC="54.229.204.211"

C='\033[0;36m'; G='\033[0;32m'; M='\033[0;35m'; R='\033[0;31m'
Y='\033[1;33m'; W='\033[1;37m'; D='\033[2m'; N='\033[0m'; BD='\033[1m'

COLS=$(tput cols 2>/dev/null || echo 180)
COL_W=$(( (COLS - 6) / 3 ))

tmp1=$(mktemp); tmp2=$(mktemp); tmp3=$(mktemp)
trap "rm -f $tmp1 $tmp2 $tmp3; kill 0 2>/dev/null" EXIT

push_key() { $AWS ec2-instance-connect send-ssh-public-key --instance-id "$1" --instance-os-user ubuntu --ssh-public-key "file://$KEY" --region $RG >/dev/null 2>&1; }

stream_v10() {
    while true; do
        push_key $V10_I
        ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o ServerAliveInterval=5 -o LogLevel=ERROR ubuntu@$V10 "tail -f /home/ubuntu/training/v10_cradio/train.log 2>/dev/null" >> $tmp1 2>/dev/null
        sleep 5
    done
}

stream_v9() {
    while true; do
        push_key $V9_I
        ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o ServerAliveInterval=5 -o LogLevel=ERROR ubuntu@$V9 "tail -f /home/ubuntu/training/v9_simple/train.log 2>/dev/null" >> $tmp2 2>/dev/null
        sleep 5
    done
}

stream_doc() {
    while true; do
        push_key $DOC_I
        ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o ServerAliveInterval=5 -o LogLevel=ERROR ubuntu@$DOC "tail -f /home/ubuntu/training/doc_icao/train.log 2>/dev/null" >> $tmp3 2>/dev/null
        sleep 5
    done
}

# Start streams in background
stream_v10 &
stream_v9 &
stream_doc &

sleep 3
clear

# Header
echo -e "${D}══════════════════════════════════════════════════════════════════════════════════════════════════════════════${N}"
echo -e "${BD}${C}  V10 C-RADIOv4-H 653M 4×A10G       ${G}V9.4 DINOv3+MJ 303M 1×A10G       ${M}DOC ICAO IDNet 304M 1×A10G${N}"
echo -e "${D}══════════════════════════════════════════════════════════════════════════════════════════════════════════════${N}"

# Track line counts
l1=0; l2=0; l3=0

while true; do
    # Read new lines from each stream
    n1=$(wc -l < $tmp1 2>/dev/null || echo 0)
    n2=$(wc -l < $tmp2 2>/dev/null || echo 0)
    n3=$(wc -l < $tmp3 2>/dev/null || echo 0)

    new=0

    # Process new lines from V10
    if [ "$n1" -gt "$l1" ]; then
        lines=$(tail -n +$((l1+1)) $tmp1 | head -n $((n1-l1)))
        while IFS= read -r line; do
            # Colorize
            ts=$(echo "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' | tail -c 8)
            short=$(echo "$line" | sed 's/^[0-9-]* [0-9:]* //' | cut -c1-$((COL_W-10)))

            if echo "$line" | grep -q "val_auc="; then
                # Epoch result line
                auc=$(echo "$line" | grep -oE 'val_auc=[0-9.]+' | sed 's/val_auc=//')
                eer=$(echo "$line" | grep -oE 'val_eer=[0-9.]+' | sed 's/val_eer=//')
                printf "${C}${BD}%s${N} ${W}AUC:${G}%s ${W}EER:${Y}%s${N}\n" "$ts" "$auc" "$eer"
            elif echo "$line" | grep -q "batch"; then
                batch=$(echo "$line" | grep -oE 'batch [0-9/]+' | sed 's/batch //')
                loss=$(echo "$line" | grep -oE 'loss=[0-9.]+' | sed 's/loss=//')
                printf "${C}%s${N} ${D}b:${N}%-12s ${D}l:${N}%s\n" "$ts" "$batch" "$loss"
            elif echo "$line" | grep -q "New best"; then
                printf "${C}%s${N} ${G}${BD}★ NEW BEST${N} %s\n" "$ts" "$(echo $short | tail -c 30)"
            else
                printf "${C}%s${N} ${D}%s${N}\n" "${ts:-    }" "$(echo $short | head -c $((COL_W-10)))"
            fi
        done <<< "$lines"
        l1=$n1; new=1
    fi

    # Process new lines from V9
    if [ "$n2" -gt "$l2" ]; then
        lines=$(tail -n +$((l2+1)) $tmp2 | head -n $((n2-l2)))
        while IFS= read -r line; do
            ts=$(echo "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' | tail -c 8)
            if echo "$line" | grep -q "val_auc="; then
                auc=$(echo "$line" | grep -oE 'val_auc=[0-9.]+' | sed 's/val_auc=//')
                eer=$(echo "$line" | grep -oE 'val_eer=[0-9.]+' | sed 's/val_eer=//')
                printf "%${COL_W}s ${G}${BD}%s${N} ${W}AUC:${G}%s ${W}EER:${Y}%s${N}\n" "" "$ts" "$auc" "$eer"
            elif echo "$line" | grep -q "batch"; then
                batch=$(echo "$line" | grep -oE 'batch [0-9/]+' | sed 's/batch //')
                loss=$(echo "$line" | grep -oE 'loss=[0-9.]+' | sed 's/loss=//')
                printf "%${COL_W}s ${G}%s${N} ${D}b:${N}%-12s ${D}l:${N}%s\n" "" "$ts" "$batch" "$loss"
            elif echo "$line" | grep -q "New best"; then
                printf "%${COL_W}s ${G}%s${N} ${G}${BD}★ BEST${N}\n" "" "$ts"
            else
                ts2="${ts:-    }"
                printf "%${COL_W}s ${G}%s${N} ${D}%s${N}\n" "" "$ts2" "$(echo $line | sed 's/^[0-9-]* [0-9:]* //' | head -c $((COL_W-10)))"
            fi
        done <<< "$lines"
        l2=$n2; new=1
    fi

    # Process new lines from Doc
    if [ "$n3" -gt "$l3" ]; then
        lines=$(tail -n +$((l3+1)) $tmp3 | head -n $((n3-l3)))
        while IFS= read -r line; do
            ts=$(echo "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' | tail -c 8)
            off=$((COL_W*2))
            if echo "$line" | grep -q "val_auc="; then
                auc=$(echo "$line" | grep -oE 'val_auc=[0-9.]+' | sed 's/val_auc=//')
                eer=$(echo "$line" | grep -oE 'val_eer=[0-9.]+' | sed 's/val_eer=//')
                printf "%${off}s ${M}${BD}%s${N} ${W}AUC:${M}%s ${W}EER:${Y}%s${N}\n" "" "$ts" "$auc" "$eer"
            elif echo "$line" | grep -q "batch"; then
                batch=$(echo "$line" | grep -oE 'batch [0-9/]+' | sed 's/batch //')
                loss=$(echo "$line" | grep -oE 'loss=[0-9.]+' | sed 's/loss=//')
                printf "%${off}s ${M}%s${N} ${D}b:${N}%-12s ${D}l:${N}%s\n" "" "$ts" "$batch" "$loss"
            elif echo "$line" | grep -q "New best"; then
                printf "%${off}s ${M}%s${N} ${M}${BD}★ BEST${N}\n" "" "$ts"
            else
                ts2="${ts:-    }"
                printf "%${off}s ${M}%s${N} ${D}%s${N}\n" "" "$ts2" "$(echo $line | sed 's/^[0-9-]* [0-9:]* //' | head -c $((COL_W-10)))"
            fi
        done <<< "$lines"
        l3=$n3; new=1
    fi

    [ $new -eq 0 ] && sleep 1
done
