#!/bin/bash
# Deep-Check V5 Training Bootstrap — g5.xlarge (A10G 24GB)
# Downloads 6 real + 7 fake datasets, then launches training
set -euo pipefail
exec > /var/log/v5_training_setup.log 2>&1

echo "=== V5 Training Setup $(date) ==="

# ── System setup ──
apt-get update -qq
apt-get install -y -qq python3-pip python3-venv unzip awscli

# ── Python env ──
python3 -m venv /opt/v5env
source /opt/v5env/bin/activate
pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install timm scikit-learn pillow kaggle onnx onnxruntime gdown

# ── Kaggle config ──
mkdir -p /root/.config/kaggle
cat > /root/.config/kaggle/kaggle.json << 'KAGGLE_EOF'
{"username":"pablolopezrodriguez0","key":"7f852c46aaa9faaea565d0ccdf1c426c"}
KAGGLE_EOF
chmod 600 /root/.config/kaggle/kaggle.json

# ── Data directory ──
DATA_DIR=/data
mkdir -p $DATA_DIR/{real/{ffhq,lfw,widerface,celeba_hq,laion_face,dfdc_real},fake/{stylegan2,progan,dfdc_fake,stable_diff,stargan,cyclegan,artifact}}

echo "=== Downloading datasets ==="

# ── REAL datasets ──

# 1. FFHQ (70K) — from Kaggle
echo "[1/13] FFHQ..."
kaggle datasets download -d arnaud58/flickrfaceshq-dataset-ffhq -p /tmp/ffhq --quiet || true
if [ -f /tmp/ffhq/*.zip ]; then
    unzip -q -o /tmp/ffhq/*.zip -d $DATA_DIR/real/ffhq/
    rm -f /tmp/ffhq/*.zip
fi

# 2. LFW (13K) — Labeled Faces in the Wild
echo "[2/13] LFW..."
kaggle datasets download -d jessicali9530/lfw-dataset -p /tmp/lfw --quiet || true
if [ -f /tmp/lfw/*.zip ]; then
    unzip -q -o /tmp/lfw/*.zip -d $DATA_DIR/real/lfw/
    rm -f /tmp/lfw/*.zip
fi

# 3. WiderFace — real-world diverse faces
echo "[3/13] WiderFace..."
kaggle datasets download -d sgysethi/widerface -p /tmp/widerface --quiet || true
if [ -f /tmp/widerface/*.zip ]; then
    unzip -q -o /tmp/widerface/*.zip -d $DATA_DIR/real/widerface/
    rm -f /tmp/widerface/*.zip
fi

# 4. CelebA-HQ (30K)
echo "[4/13] CelebA-HQ..."
kaggle datasets download -d lamsimon/celebahq -p /tmp/celeba --quiet || true
if [ -f /tmp/celeba/*.zip ]; then
    unzip -q -o /tmp/celeba/*.zip -d $DATA_DIR/real/celeba_hq/
    rm -f /tmp/celeba/*.zip
fi

# 5. LAION-Face subset (download first 50K)
echo "[5/13] LAION-Face subset..."
kaggle datasets download -d greatgamedota/laion-face -p /tmp/laion --quiet || true
if [ -f /tmp/laion/*.zip ]; then
    unzip -q -o /tmp/laion/*.zip -d $DATA_DIR/real/laion_face/
    rm -f /tmp/laion/*.zip
fi

# 6. DFDC real frames
echo "[6/13] DFDC real frames..."
kaggle datasets download -d phunghieu/deepfake-detection-faces -p /tmp/dfdc --quiet || true
if [ -f /tmp/dfdc/*.zip ]; then
    unzip -q -o /tmp/dfdc/*.zip -d /tmp/dfdc_extracted/
    # Move real images
    find /tmp/dfdc_extracted/ -path "*/real*" -name "*.jpg" -exec cp {} $DATA_DIR/real/dfdc_real/ \; 2>/dev/null || true
    find /tmp/dfdc_extracted/ -path "*/real*" -name "*.png" -exec cp {} $DATA_DIR/real/dfdc_real/ \; 2>/dev/null || true
    # Move fake images
    find /tmp/dfdc_extracted/ -path "*/fake*" -name "*.jpg" -exec cp {} $DATA_DIR/fake/dfdc_fake/ \; 2>/dev/null || true
    find /tmp/dfdc_extracted/ -path "*/fake*" -name "*.png" -exec cp {} $DATA_DIR/fake/dfdc_fake/ \; 2>/dev/null || true
    rm -rf /tmp/dfdc_extracted/ /tmp/dfdc/*.zip
fi

# ── FAKE datasets ──

# 7. StyleGAN2 faces (140K)
echo "[7/13] StyleGAN2..."
kaggle datasets download -d xhlulu/140k-real-and-fake-faces -p /tmp/stylegan --quiet || true
if [ -f /tmp/stylegan/*.zip ]; then
    unzip -q -o /tmp/stylegan/*.zip -d /tmp/stylegan_ext/
    find /tmp/stylegan_ext/ -path "*fake*" -name "*.jpg" -exec cp {} $DATA_DIR/fake/stylegan2/ \; 2>/dev/null || true
    # Also grab real images from this dataset
    find /tmp/stylegan_ext/ -path "*real*" -name "*.jpg" -exec cp {} $DATA_DIR/real/ffhq/ \; 2>/dev/null || true
    rm -rf /tmp/stylegan_ext/ /tmp/stylegan/*.zip
fi

# 8. Stable Diffusion generated
echo "[8/13] Stable Diffusion..."
kaggle datasets download -d birdy654/cifake-real-and-ai-generated-synthetic-images -p /tmp/cifake --quiet || true
if [ -f /tmp/cifake/*.zip ]; then
    unzip -q -o /tmp/cifake/*.zip -d /tmp/cifake_ext/
    find /tmp/cifake_ext/ -path "*FAKE*" -name "*.png" -exec cp {} $DATA_DIR/fake/stable_diff/ \; 2>/dev/null || true
    find /tmp/cifake_ext/ -path "*fake*" -name "*.png" -exec cp {} $DATA_DIR/fake/stable_diff/ \; 2>/dev/null || true
    rm -rf /tmp/cifake_ext/ /tmp/cifake/*.zip
fi

# 9. ProGAN
echo "[9/13] ProGAN..."
kaggle datasets download -d tourist2/progan-generated-images -p /tmp/progan --quiet || true
if [ -f /tmp/progan/*.zip ]; then
    unzip -q -o /tmp/progan/*.zip -d $DATA_DIR/fake/progan/
    rm -f /tmp/progan/*.zip
fi

# 10. StarGAN
echo "[10/13] StarGAN..."
kaggle datasets download -d tourist2/stargan-generated-images -p /tmp/stargan --quiet || true
if [ -f /tmp/stargan/*.zip ]; then
    unzip -q -o /tmp/stargan/*.zip -d $DATA_DIR/fake/stargan/
    rm -f /tmp/stargan/*.zip
fi

# 11. CycleGAN
echo "[11/13] CycleGAN..."
kaggle datasets download -d tourist2/cyclegan-generated-images -p /tmp/cyclegan --quiet || true
if [ -f /tmp/cyclegan/*.zip ]; then
    unzip -q -o /tmp/cyclegan/*.zip -d $DATA_DIR/fake/cyclegan/
    rm -f /tmp/cyclegan/*.zip
fi

# 12. ArtiFact (13 generators)
echo "[12/13] ArtiFact..."
kaggle datasets download -d ravidussilva/real-ai-art -p /tmp/artifact --quiet || true
if [ -f /tmp/artifact/*.zip ]; then
    unzip -q -o /tmp/artifact/*.zip -d /tmp/artifact_ext/
    find /tmp/artifact_ext/ -path "*ai*" -name "*.jpg" -exec cp {} $DATA_DIR/fake/artifact/ \; 2>/dev/null || true
    find /tmp/artifact_ext/ -path "*fake*" -name "*.jpg" -exec cp {} $DATA_DIR/fake/artifact/ \; 2>/dev/null || true
    rm -rf /tmp/artifact_ext/ /tmp/artifact/*.zip
fi

# 13. AI Faces (diverse generators)
echo "[13/13] AI Faces..."
kaggle datasets download -d davidnovicky/aifaces -p /tmp/aifaces --quiet || true
if [ -f /tmp/aifaces/*.zip ]; then
    unzip -q -o /tmp/aifaces/*.zip -d $DATA_DIR/fake/artifact/
    rm -f /tmp/aifaces/*.zip
fi

# ── Count images ──
echo "=== Dataset counts ==="
for d in $DATA_DIR/real/*/; do echo "$(basename $d): $(find $d -type f | wc -l)"; done
for d in $DATA_DIR/fake/*/; do echo "$(basename $d): $(find $d -type f | wc -l)"; done

# ── Copy training script from S3 ──
echo "=== Getting training script ==="
aws s3 cp s3://deep-check-models/ml/train_deepfake_v5.py /opt/train_deepfake_v5.py || true
# Fallback: use local copy if S3 fails
if [ ! -f /opt/train_deepfake_v5.py ]; then
    echo "S3 copy failed, training script must be uploaded manually"
fi

# ── Launch training ──
echo "=== Launching V5 training $(date) ==="
cd /opt
source /opt/v5env/bin/activate

nohup python3 /opt/train_deepfake_v5.py \
    --data-dir $DATA_DIR \
    --output-dir /output/v5 \
    --epochs 150 \
    --batch-size 24 \
    --lr 5e-5 \
    --backbone convnext_base.fb_in22k_ft_in1k \
    --workers 8 \
    --max-per-source 50000 \
    > /var/log/v5_training.log 2>&1 &

echo "Training PID: $!"
echo "Monitor: tail -f /var/log/v5_training.log"
echo "=== Setup complete $(date) ==="
