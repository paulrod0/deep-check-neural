#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════
# setup_pixel_training.sh — Configura y arranca EfficientNet-B4 deepfake en EC2
#
# REQUIERE ~/.kaggle/kaggle.json antes de ejecutar:
#   mkdir -p ~/.kaggle && cat > ~/.kaggle/kaggle.json << 'EOF'
#   {"username":"TU_USUARIO","key":"TU_API_KEY"}
#   EOF
#   chmod 600 ~/.kaggle/kaggle.json
#
# Luego: bash setup_pixel_training.sh
# ════════════════════════════════════════════════════════════════════════════════

set -euo pipefail
PYTHON=/opt/pytorch/bin/python
PIP=/opt/pytorch/bin/pip
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
REGION="${AWS_REGION:-eu-west-1}"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

# ── 1. Instalar dependencias ───────────────────────────────────────────────────
log "Instalando dependencias Python..."
$PIP install -q timm albumentations scikit-learn Pillow kaggle tqdm \
  opencv-python-headless onnx onnxruntime 2>&1 | tail -3
ok "Dependencias instaladas"

# ── 2. Verificar credenciales Kaggle ──────────────────────────────────────────
if [ ! -f ~/.kaggle/kaggle.json ]; then
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  ERROR: ~/.kaggle/kaggle.json no encontrado"
  echo ""
  echo "  Para configurar:"
  echo "  1. Ve a https://www.kaggle.com → Account → API → Create New API Token"
  echo "  2. Crea el archivo:"
  echo '     mkdir -p ~/.kaggle'
  echo '     cat > ~/.kaggle/kaggle.json << EOF'
  echo '     {"username":"TU_USUARIO","key":"TU_API_KEY"}'
  echo '     EOF'
  echo '     chmod 600 ~/.kaggle/kaggle.json'
  echo ""
  echo "  Luego vuelve a ejecutar: bash ~/deep-check/infra/setup_pixel_training.sh"
  echo "════════════════════════════════════════════════════════"
  exit 1
fi
ok "Kaggle credentials OK"
chmod 600 ~/.kaggle/kaggle.json

# ── 3. Descargar datasets ──────────────────────────────────────────────────────
log "Descargando datasets (140k + Celeb-DF v2 + CIPLAB)..."
mkdir -p /data/kaggle_140k /data/celebdf /data/ciplab /data/output/pixel

# 140k Real and Fake Faces (FFHQ + StyleGAN2) — 1.14GB, más importante
if [ ! -d "/data/kaggle_140k/real_vs_fake" ]; then
  log "  Descargando 140k-real-and-fake-faces..."
  $PYTHON -m kaggle datasets download \
    -d xhlulu/140k-real-and-fake-faces \
    -p /data/kaggle_140k --unzip 2>&1 | tail -3
  ok "  140k dataset listo"
else
  ok "  140k ya descargado"
fi

# Celeb-DF v2 preprocesado (frames ya extraídos) — mejor calidad real+fake
if [ ! -d "/data/celebdf/real" ] && [ ! -d "/data/celebdf/fake" ]; then
  log "  Descargando Celeb-DF v2 preprocessed..."
  $PYTHON -m kaggle datasets download \
    -d amanrawat001/celeb-df-preprocessed \
    -p /data/celebdf --unzip 2>&1 | tail -3 || \
  $PYTHON -m kaggle datasets download \
    -d debajyatidey/celeb-df-v2-real-videos-cropped-frames \
    -p /data/celebdf --unzip 2>&1 | tail -3 || \
  warn "  Celeb-DF no disponible — continuando sin él"
  ok "  Celeb-DF listo"
else
  ok "  Celeb-DF ya descargado"
fi

# CIPLAB (studio shots, 3 dificultades) — 85MB
if [ ! -d "/data/ciplab/real_and_fake_face" ]; then
  log "  Descargando CIPLAB..."
  $PYTHON -m kaggle datasets download \
    -d ciplab/real-and-fake-face-detection \
    -p /data/ciplab --unzip 2>&1 | tail -3 || \
  warn "  CIPLAB no disponible — OK, dataset opcional"
else
  ok "  CIPLAB ya descargado"
fi

# ── 4. Imprimir resumen de datos ───────────────────────────────────────────────
echo ""
log "Inventario de datos:"
find /data/kaggle_140k -name "*.jpg" 2>/dev/null | wc -l | xargs -I{} echo "  140k total:  {} imágenes"
find /data/celebdf    -name "*.jpg" -o -name "*.png" 2>/dev/null | wc -l | xargs -I{} echo "  Celeb-DF:    {} imágenes"
find /data/ciplab     -name "*.jpg" 2>/dev/null | wc -l | xargs -I{} echo "  CIPLAB:      {} imágenes"
echo ""

# ── 5. Subir script de entrenamiento ──────────────────────────────────────────
log "Script listo en ~/deep-check/infra/train_pixel_ec2.py"

# ── 6. Arrancar entrenamiento en tmux ─────────────────────────────────────────
log "Arrancando entrenamiento en tmux (sesión: pixel_train)..."
tmux new-session -d -s pixel_train 2>/dev/null || true
tmux send-keys -t pixel_train \
  "cd ~/deep-check && $PYTHON infra/train_pixel_ec2.py 2>&1 | tee /data/output/pixel/train.log" Enter

ok "Entrenamiento lanzado en tmux"
echo ""
echo "  Monitorear: tmux attach -t pixel_train"
echo "  Log:        tail -f /data/output/pixel/train.log"
echo "  GPU:        watch -n5 nvidia-smi"
echo ""
echo "  Cuando termine (~90 min):"
echo "  aws s3 cp /data/output/pixel/deepfake_pixel_v1.onnx s3://$S3_BUCKET/deepfake/"
