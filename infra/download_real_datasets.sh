#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════
# download_real_datasets.sh — Public deepfake datasets (NO academic email needed)
#
# Priority order (easiest → best quality):
#   1. kaggle-140k   — 140k Real+Fake faces via Kaggle (free account)  [BEST START]
#   2. kaggle-ciplab — Real & Fake Face Detection, 3 difficulty levels
#   3. dfdc          — DeepFake Detection Challenge preview (Kaggle)
#   4. uadfv         — 49+49 videos, direct GitHub download
#   5. celebdf       — Celeb-DF v2 form (no academic email, just email)
#   6. ffhq-simswap  — Generate your own: FFHQ real + SimSwap fake
#
# FaceForensics++ requires academic affiliation:
#   https://forms.gle/Q2fxvNpMJV4dEJPT7
#
# Usage:
#   bash infra/download_real_datasets.sh [dataset] [output_dir]
#   bash infra/download_real_datasets.sh kaggle-140k /data/datasets
#   bash infra/download_real_datasets.sh all /data/datasets
# ════════════════════════════════════════════════════════════════════════════════

set -euo pipefail

DATASET="${1:-kaggle-140k}"
OUTPUT_DIR="${2:-/tmp/deepcheck-datasets}"
mkdir -p "$OUTPUT_DIR"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; }

require_kaggle() {
  if ! command -v kaggle &>/dev/null; then
    err "Kaggle CLI not found. Install: pip install kaggle"
    warn "Then create ~/.kaggle/kaggle.json:"
    warn "  1. Go to kaggle.com → Account → API → Create New Token"
    warn "  2. Move the downloaded kaggle.json to ~/.kaggle/"
    warn "  3. chmod 600 ~/.kaggle/kaggle.json"
    exit 1
  fi
}

# ── 1. 140k Real and Fake Faces ───────────────────────────────────────────────
# FFHQ real (70k) + StyleGAN2 fake (70k) — 1.14GB images
# Best single dataset to start: no video extraction needed
download_kaggle_140k() {
  require_kaggle
  log "140k Real+Fake Faces — FFHQ + StyleGAN2 (1.14GB)..."

  OUT="$OUTPUT_DIR/kaggle_140k"
  mkdir -p "$OUT"

  kaggle datasets download \
    -d xhlulu/140k-real-and-fake-faces \
    -p "$OUT" --unzip

  # Organize into real/fake dirs for training
  mkdir -p "$OUT/real" "$OUT/fake"
  find "$OUT" -name "*.jpg" -path "*/real_vs_fake/real*" -exec mv {} "$OUT/real/" \; 2>/dev/null || true
  find "$OUT" -name "*.jpg" -path "*/real_vs_fake/fake*" -exec mv {} "$OUT/fake/" \; 2>/dev/null || true

  REAL=$(find "$OUT/real" -name "*.jpg" | wc -l)
  FAKE=$(find "$OUT/fake" -name "*.jpg" | wc -l)
  ok "140k dataset: ${REAL} real + ${FAKE} fake images → $OUT"
}

# ── 2. CIPLAB Real & Fake Face Detection ─────────────────────────────────────
# 1081 real + 960 fake with 3 difficulty levels (easy/mid/hard)
# Useful for ID document photos (controlled studio shots)
download_kaggle_ciplab() {
  require_kaggle
  log "CIPLAB Real & Fake Face Detection (3 difficulty levels)..."

  OUT="$OUTPUT_DIR/ciplab"
  mkdir -p "$OUT"

  kaggle datasets download \
    -d ciplab/real-and-fake-face-detection \
    -p "$OUT" --unzip

  REAL=$(find "$OUT" -name "*.jpg" -path "*real*" | wc -l)
  FAKE=$(find "$OUT" -name "*.jpg" -path "*fake*" | wc -l)
  ok "CIPLAB: ${REAL} real + ${FAKE} fake → $OUT"
}

# ── 3. DFDC Preview (DeepFake Detection Challenge) ───────────────────────────
# Meta AI dataset, ~500 real+fake video clips
# Requires accepting competition rules on Kaggle (free)
download_dfdc() {
  require_kaggle
  log "DFDC preview — Meta AI (must accept rules at kaggle.com/c/deepfake-detection-challenge)..."

  OUT="$OUTPUT_DIR/dfdc"
  mkdir -p "$OUT"

  kaggle c download \
    -c deepfake-detection-challenge \
    -p "$OUT" --unzip 2>/dev/null || {
    warn "DFDC: accept competition rules first:"
    warn "  https://www.kaggle.com/c/deepfake-detection-challenge/rules"
    warn "Then re-run: bash infra/download_real_datasets.sh dfdc"
    return
  }
  ok "DFDC preview downloaded → $OUT"
}

# ── 4. UADFV — direct download, no login ──────────────────────────────────────
# Small dataset: 49 real + 49 fake videos. Classic baseline.
download_uadfv() {
  log "UADFV — 49+49 videos (DSP-FWA repo)..."

  OUT="$OUTPUT_DIR/uadfv"
  mkdir -p "$OUT"

  # Clone the DSP-FWA repo which includes UADFV download instructions
  if [ ! -d "$OUT/DSP-FWA/.git" ]; then
    git clone --depth 1 https://github.com/danmohaha/DSP-FWA "$OUT/DSP-FWA"
  fi

  warn "UADFV data link is in: $OUT/DSP-FWA/README.md"
  warn "Usually a Google Drive folder — open in browser and download"
  warn "Or use gdown: pip install gdown && gdown 'GDRIVE_LINK' -O $OUT/"
  ok "DSP-FWA repo cloned → $OUT/DSP-FWA"
}

# ── 5. Celeb-DF v2 form (no academic email, just a regular email) ─────────────
# 590 real YouTube + 5,639 high-quality fakes. Best free dataset after FF++.
# They approve non-academic requests if you mention security research purpose.
download_celebdf() {
  warn "Celeb-DF v2 requires a form — but NO academic email needed:"
  warn ""
  warn "  Form: https://github.com/yuezunli/celeb-deepfakeforensics#dataset-request"
  warn "  Use your regular email, explain: 'commercial identity fraud detection'"
  warn "  They respond within 24-48h with a Google Drive link"
  warn ""
  warn "Once you receive the link:"
  warn "  pip install gdown"
  warn "  gdown --folder 'YOUR_GDRIVE_LINK' -O $OUTPUT_DIR/celebdf"
  warn ""

  # Download the test list (public, no auth)
  mkdir -p "$OUTPUT_DIR/celebdf"
  wget -q -O "$OUTPUT_DIR/celebdf/List_of_testing_videos.txt" \
    "https://raw.githubusercontent.com/yuezunli/celeb-deepfakeforensics/master/List_of_testing_videos.txt" \
    2>/dev/null && ok "Celeb-DF test list saved" || true
}

# ── 6. FFHQ + SimSwap (generate your own — highest quality control) ───────────
# Real: NVIDIA FFHQ (70k Flickr faces, public domain)
# Fake: SimSwap (open-source face swap, state-of-the-art)
# Advantage: you control fake quality, identity pairs, and metadata
download_ffhq_simswap() {
  log "FFHQ + SimSwap setup..."

  OUT="$OUTPUT_DIR/ffhq_simswap"
  mkdir -p "$OUT/real" "$OUT/fake_generator"

  # FFHQ downloader
  if [ ! -f "$OUT/ffhq_downloader.py" ]; then
    wget -q -O "$OUT/ffhq_downloader.py" \
      "https://raw.githubusercontent.com/NVlabs/ffhq-dataset/master/download_ffhq.py" \
      2>/dev/null && ok "FFHQ downloader ready" || warn "Could not fetch FFHQ downloader"
  fi

  # SimSwap
  if [ ! -d "$OUT/fake_generator/SimSwap/.git" ]; then
    git clone --depth 1 https://github.com/neuralchen/SimSwap \
      "$OUT/fake_generator/SimSwap" 2>/dev/null && \
      ok "SimSwap cloned" || warn "Could not clone SimSwap"
  fi

  cat > "$OUT/README_generate.sh" <<'GENEOF'
#!/usr/bin/env bash
# Step 1: Download FFHQ real faces (70k images, ~2.56GB at 256px)
cd ffhq
python ffhq_downloader.py --images --resolution 256 --output real/

# Step 2: Generate face swaps with SimSwap
cd fake_generator/SimSwap
pip install -r requirements.txt
# Download SimSwap pretrained model
gdown --id '1HvZ4MAtzlY74Dk4ASGIS9L6Rg5oZdqvu' -O checkpoints/people.zip
unzip checkpoints/people.zip -d checkpoints/

# Step 3: Batch generate swaps (source=random FFHQ pairs)
python batch_face_swapping.py \
  --input_dir ../../real \
  --output_dir ../../fake \
  --num_pairs 70000
GENEOF
  chmod +x "$OUT/README_generate.sh"
  ok "FFHQ + SimSwap setup → $OUT"
  warn "Run $OUT/README_generate.sh to generate the dataset"
}

# ── Write updated dataset_config.json ─────────────────────────────────────────
write_config() {
  cat > "$OUTPUT_DIR/dataset_config.json" <<EOF
{
  "_comment": "Deep-Check CNN training — edit 'enabled' flags after downloading",
  "_priority": "Enable kaggle_140k first — highest quality/size ratio, zero friction",
  "datasets": {
    "kaggle_140k": {
      "enabled": true,
      "real_dir": "$OUTPUT_DIR/kaggle_140k/real",
      "fake_dir": "$OUTPUT_DIR/kaggle_140k/fake",
      "format": "image",
      "weight": 3.0,
      "note": "FFHQ + StyleGAN2 — best start, images directly usable"
    },
    "ciplab": {
      "enabled": true,
      "real_dir": "$OUTPUT_DIR/ciplab/real",
      "fake_dir": "$OUTPUT_DIR/ciplab/fake",
      "format": "image",
      "weight": 1.0,
      "note": "Studio-quality, 3 difficulty levels"
    },
    "dfdc": {
      "enabled": false,
      "video_dir": "$OUTPUT_DIR/dfdc",
      "format": "video",
      "frames_per_video": 20,
      "weight": 2.0,
      "note": "Accept Kaggle competition rules first"
    },
    "uadfv": {
      "enabled": false,
      "real_dir": "$OUTPUT_DIR/uadfv/real",
      "fake_dir": "$OUTPUT_DIR/uadfv/fake",
      "format": "video",
      "frames_per_video": 30,
      "weight": 0.5,
      "note": "Small (98 videos) but classic baseline"
    },
    "celebdf_v2": {
      "enabled": false,
      "real_dir": "$OUTPUT_DIR/celebdf/Celeb-real",
      "fake_dir": "$OUTPUT_DIR/celebdf/Celeb-synthesis",
      "format": "video",
      "frames_per_video": 30,
      "weight": 2.5,
      "note": "Best quality after FF++ — request via GitHub form (no academic email)"
    },
    "ffhq_simswap": {
      "enabled": false,
      "real_dir": "$OUTPUT_DIR/ffhq_simswap/real",
      "fake_dir": "$OUTPUT_DIR/ffhq_simswap/fake",
      "format": "image",
      "weight": 2.0,
      "note": "Self-generated — run ffhq_simswap/README_generate.sh first"
    },
    "synthetic_augmented": {
      "enabled": true,
      "note": "Generated on-the-fly by train_docforensics_v5.py",
      "samples_per_epoch": 20000,
      "weight": 1.0
    }
  },
  "training": {
    "epochs": 150,
    "batch_size": 32,
    "expected_accuracy": {
      "synthetic_only": "87%",
      "kaggle_140k_added": "91-93%",
      "celebdf_added": "94-96%",
      "full_stack": "96-98%"
    }
  }
}
EOF
  ok "Config written: $OUTPUT_DIR/dataset_config.json"
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deep-Check — Deepfake Dataset Downloader"
echo "  No academic email required for any of these"
echo "  Output: $OUTPUT_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

case "$DATASET" in
  kaggle-140k)    download_kaggle_140k ;;
  kaggle-ciplab)  download_kaggle_ciplab ;;
  dfdc)           download_dfdc ;;
  uadfv)          download_uadfv ;;
  celebdf)        download_celebdf ;;
  ffhq-simswap)   download_ffhq_simswap ;;
  all)
    download_kaggle_140k
    download_kaggle_ciplab
    download_uadfv
    download_celebdf
    download_ffhq_simswap
    ;;
  *)
    echo "Unknown: $DATASET"
    echo "Options: kaggle-140k | kaggle-ciplab | dfdc | uadfv | celebdf | ffhq-simswap | all"
    exit 1 ;;
esac

write_config

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo ""
echo "  1. Quick start (images, no video extraction needed):"
echo "     bash infra/download_real_datasets.sh kaggle-140k $OUTPUT_DIR"
echo ""
echo "  2. Enable datasets in dataset_config.json"
echo ""
echo "  3. For video datasets, extract faces first:"
echo "     python infra/extract_frames.py --config $OUTPUT_DIR/dataset_config.json"
echo ""
echo "  4. Train:"
echo "     python infra/train_docforensics_v5.py \\"
echo "       --dataset-config $OUTPUT_DIR/dataset_config.json \\"
echo "       --epochs 150 --batch 32"
echo ""
echo "  Expected accuracy progression:"
echo "    Synthetic only:    ~87%"
echo "    + kaggle_140k:     ~91-93%"
echo "    + celebdf_v2:      ~94-96%"
echo "    + full stack:      ~96-98%"
echo ""
