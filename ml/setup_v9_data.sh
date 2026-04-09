#!/bin/bash
# Setup V9 training data: extract and organize modern AI face datasets
# Run on EC2 V8 instance (52.215.31.248)
set -e

export PATH="$PATH:/home/ubuntu/.local/bin"
export KAGGLE_CONFIG_DIR=/home/ubuntu/.config/kaggle
DATA=/home/ubuntu/data

echo "════════════════════════════════════════════"
echo "  V9 Data Setup — Modern AI Generators"
echo "════════════════════════════════════════════"

# ── Step 1: Download datasets if not already present ──
echo ""
echo "=== Step 1: Downloading datasets from Kaggle ==="

# FF-GenAI: FFHQ real + GenAI generated faces
if [ ! -d "$DATA/ai-modern/ffgenai" ] || [ $(find "$DATA/ai-modern/ffgenai" -type f -name "*.jpg" -o -name "*.png" 2>/dev/null | wc -l) -lt 100 ]; then
    echo "[1] Downloading FF-GenAI (2.2GB)..."
    kaggle datasets download -d argonautex/flickr-face-hq-and-genai-dataset-ff-genai -p /tmp/ffgenai --force 2>&1 | tail -3
    echo "  Extracting..."
    mkdir -p $DATA/ai-modern/ffgenai
    cd /tmp/ffgenai && unzip -q -o *.zip -d $DATA/ai-modern/ffgenai/ 2>/dev/null || true
    echo "  Done: $(find $DATA/ai-modern/ffgenai -type f -name '*.jpg' -o -name '*.png' | wc -l) images"
else
    echo "[1] FF-GenAI already present"
fi

# RealFake 512px
if [ ! -d "$DATA/ai-modern/realfake512" ] || [ $(find "$DATA/ai-modern/realfake512" -type f -name "*.jpg" -o -name "*.png" 2>/dev/null | wc -l) -lt 100 ]; then
    echo "[2] Downloading RealFake 512px (813MB)..."
    kaggle datasets download -d shanmuk4622/real-and-fake-ai-generated-512px-dataset -p /tmp/realfake512 --force 2>&1 | tail -3
    echo "  Extracting..."
    mkdir -p $DATA/ai-modern/realfake512
    cd /tmp/realfake512 && unzip -q -o *.zip -d $DATA/ai-modern/realfake512/ 2>/dev/null || true
    echo "  Done: $(find $DATA/ai-modern/realfake512 -type f -name '*.jpg' -o -name '*.png' | wc -l) images"
else
    echo "[2] RealFake 512px already present"
fi

# OpenFake 20K (most recent - Feb 2026, likely has latest generators)
if [ ! -d "$DATA/ai-modern/openfake" ] || [ $(find "$DATA/ai-modern/openfake" -type f -name "*.jpg" -o -name "*.png" 2>/dev/null | wc -l) -lt 100 ]; then
    echo "[3] Downloading OpenFake 20K (3.8GB)..."
    kaggle datasets download -d sanketghadge1/openfake-data-20k-img -p /tmp/openfake --force 2>&1 | tail -3
    echo "  Extracting..."
    mkdir -p $DATA/ai-modern/openfake
    cd /tmp/openfake && unzip -q -o *.zip -d $DATA/ai-modern/openfake/ 2>/dev/null || true
    echo "  Done: $(find $DATA/ai-modern/openfake -type f -name '*.jpg' -o -name '*.png' | wc -l) images"
else
    echo "[3] OpenFake already present"
fi

# ── Step 2: Explore directory structure ──
echo ""
echo "=== Step 2: Analyzing dataset structure ==="
for d in $DATA/ai-modern/*/; do
    echo ""
    echo "── $(basename $d) ──"
    # Show directory tree (depth 2)
    find "$d" -maxdepth 2 -type d | head -20
    # Count images
    total=$(find "$d" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) | wc -l)
    echo "  Total images: $total"
done

# ── Step 3: Create val-modern-fakes split ──
echo ""
echo "=== Step 3: Creating val-modern-fakes split ==="
mkdir -p $DATA/val-modern-fakes

# Take 10% of modern fakes for validation
python3 << 'PYEOF'
import os, random, shutil
from pathlib import Path

DATA = Path("/home/ubuntu/data")
VAL_DIR = DATA / "val-modern-fakes"

# Find all modern fake images
modern_fakes = []
for d in (DATA / "ai-modern").iterdir():
    if not d.is_dir():
        continue
    for root, dirs, files in os.walk(d):
        root_lower = root.lower()
        # Only include fake/generated/ai directories
        if any(kw in root_lower for kw in ["fake", "generated", "genai", "synthetic", "ai"]):
            if not any(kw in root_lower for kw in ["real"]):
                for f in files:
                    if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                        modern_fakes.append(os.path.join(root, f))

print(f"Found {len(modern_fakes)} modern fake images total")

if len(modern_fakes) > 0:
    # Take 10% for val (max 5000)
    random.seed(42)
    random.shuffle(modern_fakes)
    n_val = min(len(modern_fakes) // 10, 5000)
    val_fakes = modern_fakes[:n_val]

    for src in val_fakes:
        dst = VAL_DIR / os.path.basename(src)
        if not dst.exists():
            shutil.copy2(src, dst)

    print(f"Copied {len(val_fakes)} images to val-modern-fakes")
else:
    print("WARNING: No modern fakes found! Datasets may not be extracted yet.")
PYEOF

# ── Step 4: Summary ──
echo ""
echo "════════════════════════════════════════════"
echo "  DATA SUMMARY"
echo "════════════════════════════════════════════"

echo ""
echo "Legacy real:"
for d in celeba cifake ffhq-real ffhq-256 human-faces; do
    count=$(find $DATA/$d -type f \( -name "*.jpg" -o -name "*.png" \) 2>/dev/null | wc -l)
    [ $count -gt 0 ] && echo "  $d: $count"
done

echo ""
echo "Legacy fake:"
for d in deepfake-faces val-fakes; do
    count=$(find $DATA/$d -type f \( -name "*.jpg" -o -name "*.png" \) 2>/dev/null | wc -l)
    [ $count -gt 0 ] && echo "  $d: $count"
done
echo "  140k-fake: $(find $DATA/140k-faces -path '*fake*' -type f 2>/dev/null | wc -l)"
echo "  cifake-FAKE: $(find $DATA/cifake -path '*FAKE*' -type f 2>/dev/null | wc -l)"

echo ""
echo "Modern (NEW):"
for d in $DATA/ai-modern/*/; do
    total=$(find "$d" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) 2>/dev/null | wc -l)
    [ $total -gt 0 ] && echo "  $(basename $d): $total"
done

echo ""
echo "Validation:"
echo "  lfw: $(find $DATA/lfw -type f 2>/dev/null | wc -l)"
echo "  utkface: $(find $DATA/utkface -type f 2>/dev/null | wc -l)"
echo "  val-fakes: $(find $DATA/val-fakes -type f 2>/dev/null | wc -l)"
echo "  val-modern-fakes: $(find $DATA/val-modern-fakes -type f 2>/dev/null | wc -l)"

echo ""
echo "Disk:"
du -sh $DATA/
df -h /dev/root

echo ""
echo "════════════════════════════════════════════"
echo "  READY TO TRAIN V9"
echo "════════════════════════════════════════════"
