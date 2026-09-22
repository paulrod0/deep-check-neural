#!/usr/bin/env bash
# Download the Balabit Mouse Dynamics Challenge dataset.
#
# License: CC-BY (https://github.com/balabit/Mouse-Dynamics-Challenge)
# Size: ~80 MB extracted, 10 users
#
# Run from the repo root:
#
#   bash scripts/download_balabit.sh /data/balabit
#
# Loads with:
#
#   from ml.bpas.mouse_tcn.dataset import load_balabit
#   ds = load_balabit(Path('/data/balabit'))

set -euo pipefail

DEST="${1:?usage: $0 <destination_dir>}"
mkdir -p "${DEST}"
cd "${DEST}"

if [ -d Mouse-Dynamics-Challenge ]; then
    echo "[balabit] dataset already cloned at ${DEST}/Mouse-Dynamics-Challenge"
    exit 0
fi

if command -v git >/dev/null 2>&1; then
    echo "[balabit] cloning via git..."
    git clone --depth 1 https://github.com/balabit/Mouse-Dynamics-Challenge.git
else
    echo "[balabit] git not available; falling back to tarball"
    curl -fsSL -o balabit.tar.gz \
        https://github.com/balabit/Mouse-Dynamics-Challenge/archive/refs/heads/master.tar.gz
    tar -xzf balabit.tar.gz
    mv Mouse-Dynamics-Challenge-master Mouse-Dynamics-Challenge
    rm -f balabit.tar.gz
fi

echo "[balabit] data layout:"
ls -1 Mouse-Dynamics-Challenge/training_files | head -10
echo "..."
echo "[balabit] total users: $(ls Mouse-Dynamics-Challenge/training_files | wc -l)"
echo
echo "[balabit] hint: pass ${DEST}/Mouse-Dynamics-Challenge/training_files to"
echo "         ml/bpas/mouse_tcn/train.py --data ..."
