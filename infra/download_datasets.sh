#!/usr/bin/env bash
# Deep-Check — Dataset Download Helper
# =====================================
# Downloads free/open datasets for Veritas Engine v2 training.
#
# REQUIRED (free, no registration):
#   VoxCeleb2 test set     — real faces, ~5GB
#   DFDC Preview           — deepfakes, ~5GB (Kaggle)
#
# REQUIRES ACADEMIC EMAIL:
#   FaceForensics++        — deepfakes, ~35GB (email request)
#   CelebDF-v2             — deepfakes, ~4GB  (email request)
#
# Usage:
#   chmod +x download_datasets.sh
#   ./download_datasets.sh [--voxceleb] [--dfdc] [--ff] [--celebdf]
#
# Veritas Engine v2 — Deep-Check

set -euo pipefail
DATA_DIR="${DATA_DIR:-./data}"
mkdir -p "$DATA_DIR"

# ─── VoxCeleb2 test set (real faces, free) ────────────────────────────────────
download_voxceleb() {
    echo ""
    echo "=== VoxCeleb2 test set (real faces) ==="
    echo "URL: https://www.robots.ox.ac.uk/~vgg/data/voxceleb/vox2.html"
    echo "Free download — no registration needed for test set."
    echo ""

    VOXDIR="$DATA_DIR/voxceleb"
    mkdir -p "$VOXDIR"

    # VoxCeleb2 test set audio-visual (zip, ~5GB)
    if [ ! -f "$VOXDIR/vox2_test_aac.zip" ]; then
        echo "[voxceleb] Downloading vox2_test_aac.zip..."
        wget -c "https://thor.robots.ox.ac.uk/~vgg/data/voxceleb/data/vox2_test_aac.zip" \
             -O "$VOXDIR/vox2_test_aac.zip" || {
            echo "[voxceleb] Direct download may require VGG account."
            echo "           Manual: https://www.robots.ox.ac.uk/~vgg/data/voxceleb/"
            return 1
        }
    fi

    echo "[voxceleb] Extracting..."
    cd "$VOXDIR" && unzip -q vox2_test_aac.zip || true
    echo "[voxceleb] Done. Videos in: $VOXDIR/test/aac/"
    echo "           Next: python extract_features_mp.py --real-dir $VOXDIR/test/aac"
}

# ─── DFDC Preview (deepfakes, Kaggle) ─────────────────────────────────────────
download_dfdc() {
    echo ""
    echo "=== DFDC Preview Dataset (deepfakes) ==="
    echo "Requires: Kaggle account + kaggle CLI"
    echo ""

    DFDCDIR="$DATA_DIR/dfdc"
    mkdir -p "$DFDCDIR"

    if ! command -v kaggle &> /dev/null; then
        echo "[dfdc] Kaggle CLI not found. Install: pip install kaggle"
        echo "       Then set up ~/.kaggle/kaggle.json with your API token."
        return 1
    fi

    echo "[dfdc] Downloading DFDC Preview via Kaggle..."
    kaggle datasets download -d c2-d2/deepfake-and-real-images -p "$DFDCDIR" --unzip
    echo "[dfdc] Done. Files in: $DFDCDIR"
}

# ─── FaceForensics++ (requires academic email request) ────────────────────────
download_ff() {
    echo ""
    echo "=== FaceForensics++ c23 (deepfakes) ==="
    echo ""
    echo "REQUIRES: Academic email approval"
    echo "Request access: https://github.com/ondyari/FaceForensics"
    echo ""
    echo "Steps:"
    echo "  1. Fill form at: https://docs.google.com/forms/d/e/1FAIpQLSdRRR3L5zAv6tQ_CKxmK4W96tAab_pfBu2EKAgQbeDVhmXagg/viewform"
    echo "  2. Receive download link by email (1-3 days)"
    echo "  3. Clone the download script:"
    echo "     git clone https://github.com/ondyari/FaceForensics.git"
    echo "  4. Download c23 manipulated + original:"
    echo "     python FaceForensics/dataset/download_FaceForensics.py \\"
    echo "       $DATA_DIR/ff -d all -c c23 -t videos"
    echo ""
    echo "Expected: ~35GB. Place originals in data/ff/original_sequences/"
    echo "          Place fakes in data/ff/manipulated_sequences/"
}

# ─── CelebDF-v2 (requires email request) ──────────────────────────────────────
download_celebdf() {
    echo ""
    echo "=== CelebDF-v2 (deepfakes) ==="
    echo ""
    echo "REQUIRES: Email request"
    echo "Request access: https://github.com/yuezunli/celeb-deepfakeforensics"
    echo ""
    echo "Steps:"
    echo "  1. Email: liyuezun@outlook.com with subject 'CelebDF-v2 access request'"
    echo "  2. Include: name, institution, research purpose"
    echo "  3. Receive Google Drive link by email"
    echo "  4. Download and extract to: $DATA_DIR/celebdf/"
    echo ""
    echo "Expected: ~4GB"
}

# ─── Parse args ───────────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    echo "Usage: $0 [--voxceleb] [--dfdc] [--ff] [--celebdf] [--all]"
    echo ""
    echo "Options:"
    echo "  --voxceleb   VoxCeleb2 test set (real faces, free, ~5GB)"
    echo "  --dfdc       DFDC Preview (deepfakes, requires Kaggle, ~5GB)"
    echo "  --ff         FaceForensics++ c23 (requires academic email, ~35GB)"
    echo "  --celebdf    CelebDF-v2 (requires email request, ~4GB)"
    echo "  --all        Show instructions for all datasets"
    echo ""
    echo "After downloading, run:"
    echo "  python extract_features_mp.py --real-dir ./data/voxceleb/... --fake-dir ./data/ff/..."
    exit 0
fi

for arg in "$@"; do
    case "$arg" in
        --voxceleb) download_voxceleb ;;
        --dfdc)     download_dfdc ;;
        --ff)       download_ff ;;
        --celebdf)  download_celebdf ;;
        --all)
            download_voxceleb
            download_dfdc
            download_ff
            download_celebdf
            ;;
        *)
            echo "Unknown option: $arg"
            exit 1
            ;;
    esac
done

echo ""
echo "=== Next steps ==="
echo "1. Extract MediaPipe features:"
echo "   python extract_features_mp.py \\"
echo "     --real-dir ./data/voxceleb/test \\"
echo "     --fake-dir ./data/ff/manipulated_sequences \\"
echo "     --output-dir ./data/features"
echo ""
echo "2. Train 3-stream CNN:"
echo "   python train_deepfake_v2.py --data-dir ./data/features"
echo ""
echo "3. Copy ONNX to public:"
echo "   cp deepfake_v2.onnx ../public/models/deepfake/"
echo "   cp deepfake_v2_metadata.json ../public/models/deepfake/"
