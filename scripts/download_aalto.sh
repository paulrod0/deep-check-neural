#!/usr/bin/env bash
# Download the Aalto 136M-events keystroke corpus from Kaggle.
#
# Citation: Dhakal et al., "Observations on Typing from 136 Million Keystrokes"
# Kaggle:   https://www.kaggle.com/datasets/aaltoinen/aalto-keystroke-data
# Licence:  CC-BY 4.0
# Size:     ~3 GB extracted
#
# Run from the repo root (kaggle CLI must be installed and authenticated):
#
#   pip install kaggle
#   mkdir -p ~/.kaggle && cp ~/Downloads/kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json
#   bash scripts/download_aalto.sh /data/aalto

set -euo pipefail

DEST="${1:?usage: $0 <destination_dir>}"

if ! command -v kaggle >/dev/null 2>&1; then
    echo "[aalto] kaggle CLI not found. Install with: pip install kaggle"
    exit 1
fi
if [ ! -f "${HOME}/.kaggle/kaggle.json" ]; then
    echo "[aalto] missing ${HOME}/.kaggle/kaggle.json — see https://www.kaggle.com/docs/api"
    exit 1
fi

mkdir -p "${DEST}"
cd "${DEST}"

if [ -f aalto-keystroke-data.zip ] || compgen -G '*.csv' > /dev/null; then
    echo "[aalto] download already present at ${DEST}; skipping"
else
    echo "[aalto] downloading dataset (~3 GB)..."
    kaggle datasets download -d aaltoinen/aalto-keystroke-data -p "${DEST}"
    echo "[aalto] extracting..."
    unzip -n -q aalto-keystroke-data.zip
fi

echo "[aalto] CSV files:"
ls -lh *.csv 2>/dev/null | head -10
echo
echo "[aalto] hint: pass the CSV path to"
echo "         ml/bpas/keystroke_v2/train.py --data ${DEST}/<file>.csv"
