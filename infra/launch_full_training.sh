#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════════
# launch_full_training.sh — Entrena AMBOS modelos en EC2 g4dn.xlarge
#
# Modelos entrenados:
#   1. deepfake_pixel_v1.onnx  (EfficientNet-B4 + 140k Kaggle dataset)
#      → servidor, reemplaza deepfake_detector.onnx (29.5% → ~96% AUC)
#
#   2. deepfake_temporal_v2.onnx  (Conv1D+BiGRU con blendshapes reales)
#      → browser, reemplaza deepfake_v2.onnx (29.5% → ~85% accuracy)
#
# Requisitos previos:
#   export EC2_KEY_NAME=deep-check-training
#   export EC2_SECURITY_GROUP=sg-xxxx
#   export EC2_SUBNET_ID=subnet-xxxx
#   export S3_BUCKET=deep-check-models
#   aws sts get-caller-identity  # verificar credenciales
#
# Uso:
#   bash infra/launch_full_training.sh
#   bash infra/launch_full_training.sh --pixel-only
#   bash infra/launch_full_training.sh --temporal-only
# ════════════════════════════════════════════════════════════════════════════════

set -euo pipefail

MODE="${1:---both}"   # --both | --pixel-only | --temporal-only

REGION="${AWS_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
INSTANCE_TYPE="g4dn.xlarge"   # 1x T4 16GB, ~$0.50/h spot

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

# ── Buscar AMI Deep Learning PyTorch ─────────────────────────────────────────
log "Buscando AMI Deep Learning GPU PyTorch..."
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters \
    'Name=name,Values=Deep Learning AMI GPU PyTorch 2.* (Amazon Linux 2)*' \
    'Name=state,Values=available' \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text \
  --region "$REGION")
log "AMI: $AMI_ID"

# ── Script de inicialización EC2 ─────────────────────────────────────────────
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -ex
export HOME=/root
cd /root

# Activar entorno PyTorch
source /opt/conda/etc/profile.d/conda.sh
conda activate pytorch

# Instalar dependencias extra
pip install -q timm albumentations onnx onnxruntime scikit-learn kaggle mediapipe opencv-python-headless tqdm

# Clonar repo
git clone --depth 1 https://github.com/paulrod0/deep-check.git /root/deep-check
cd /root/deep-check

# ─── CONFIG ───────────────────────────────────────────────────────────────────
S3_BUCKET="PLACEHOLDER_S3_BUCKET"
TRAIN_MODE="PLACEHOLDER_MODE"

# ─── MODELO 1: Pixel EfficientNet-B4 ─────────────────────────────────────────
if [[ "$TRAIN_MODE" == "--both" ]] || [[ "$TRAIN_MODE" == "--pixel-only" ]]; then
  echo "=== ENTRENANDO MODELO PIXEL (EfficientNet-B4) ==="

  # Configurar Kaggle
  mkdir -p /root/.kaggle
  cat > /root/.kaggle/kaggle.json <<'KGEOF'
PLACEHOLDER_KAGGLE_JSON
KGEOF
  chmod 600 /root/.kaggle/kaggle.json

  # Descargar datasets (ya en Kaggle)
  mkdir -p /data/kaggle_140k
  kaggle datasets download -d xhlulu/140k-real-and-fake-faces \
    -p /data/kaggle_140k --unzip &

  # CIPLAB si disponible
  kaggle datasets download -d ciplab/real-and-fake-face-detection \
    -p /data/ciplab --unzip &
  wait

  # Ajustar paths para EC2 (no Kaggle)
  sed -i "s|/kaggle/input/140k-real-and-fake-faces/real_vs_fake/real_vs_fake|/data/kaggle_140k/real_vs_fake/real_vs_fake|g" \
    infra/kaggle_deepfake_notebook.py
  sed -i "s|/kaggle/input/real-and-fake-face-detection/real_and_fake_face|/data/ciplab/real_and_fake_face|g" \
    infra/kaggle_deepfake_notebook.py
  sed -i "s|/kaggle/working|/data/output/pixel|g" \
    infra/kaggle_deepfake_notebook.py

  mkdir -p /data/output/pixel
  python infra/kaggle_deepfake_notebook.py 2>&1 | tee /data/output/pixel/train.log

  # Upload to S3
  aws s3 cp /data/output/pixel/deepfake_pixel_v1.onnx \
    s3://$S3_BUCKET/deepfake/deepfake_pixel_v1.onnx
  aws s3 cp /data/output/pixel/deepfake_pixel_v1_metadata.json \
    s3://$S3_BUCKET/deepfake/deepfake_pixel_v1_metadata.json
  aws s3 cp /data/output/pixel/training_history.json \
    s3://$S3_BUCKET/deepfake/pixel_training_history.json

  echo "✅ Pixel model uploaded to S3"
fi

# ─── MODELO 2: Temporal (blendshapes reales) ─────────────────────────────────
if [[ "$TRAIN_MODE" == "--both" ]] || [[ "$TRAIN_MODE" == "--temporal-only" ]]; then
  echo "=== EXTRAYENDO BLENDSHAPES DE DFDC ==="

  # Descargar DFDC preview (requiere haber aceptado reglas en Kaggle)
  mkdir -p /data/dfdc
  kaggle c download -c deepfake-detection-challenge -p /data/dfdc --unzip 2>/dev/null || \
    echo "DFDC no disponible — usando VoxCeleb2 test set como reales"

  # VoxCeleb2 test (reales, sin registro)
  mkdir -p /data/voxceleb
  wget -q -nc \
    "https://www.robots.ox.ac.uk/~vgg/data/voxceleb/data/vox2_test_aac.zip" \
    -O /data/voxceleb/vox2_test_aac.zip 2>/dev/null || \
    echo "VoxCeleb requiere registro — saltando"

  # Extraer blendshapes de cualquier vídeo disponible
  mkdir -p /data/blendshapes

  if ls /data/dfdc/*.mp4 1>/dev/null 2>&1; then
    echo "Extrayendo de DFDC..."
    python infra/extract_blendshapes.py \
      --input-dir /data/dfdc/real --label real \
      --output /data/blendshapes &
    python infra/extract_blendshapes.py \
      --input-dir /data/dfdc/fake --label deepfake \
      --output /data/blendshapes &
    wait
  fi

  NSEQS=$(find /data/blendshapes -name "*.npy" | wc -l)
  echo "Secuencias extraídas: $NSEQS"

  if [ "$NSEQS" -gt 100 ]; then
    # Entrenar modelo temporal con datos reales
    mkdir -p /data/output/temporal
    python infra/train_deepfake_cnn.py \
      --data-dir /data/blendshapes \
      --synthetic-mix 0.3 \
      --epochs 100 \
      --batch-size 512 \
      --device cuda \
      --output /data/output/temporal \
      2>&1 | tee /data/output/temporal/train.log

    # Upload
    aws s3 cp /data/output/temporal/deepfake_detector.onnx \
      s3://$S3_BUCKET/deepfake/deepfake_temporal_v2.onnx
    echo "✅ Temporal model uploaded"
  else
    echo "⚠️ Insuficientes secuencias reales — entrenando con sintéticos+mix"
    python infra/train_deepfake_cnn.py \
      --synthetic-mix 0.0 \
      --epochs 100 \
      --device cuda \
      --output /data/output/temporal
  fi
fi

echo ""
echo "════════════════════════════════════════"
echo "  TRAINING COMPLETE"
echo "  Modelos en s3://$S3_BUCKET/deepfake/"
echo "════════════════════════════════════════"
USERDATA
)

# Sustituir placeholders
USER_DATA="${USER_DATA/PLACEHOLDER_S3_BUCKET/$S3_BUCKET}"
USER_DATA="${USER_DATA/PLACEHOLDER_MODE/$MODE}"

# Leer Kaggle JSON si existe
KAGGLE_JSON=""
if [ -f ~/.kaggle/kaggle.json ]; then
  KAGGLE_JSON=$(cat ~/.kaggle/kaggle.json)
  USER_DATA="${USER_DATA/PLACEHOLDER_KAGGLE_JSON/$KAGGLE_JSON}"
  ok "Kaggle credentials incluidas"
else
  warn "~/.kaggle/kaggle.json no encontrado"
  warn "El modelo pixel solo se entrenará si Kaggle está configurado en EC2"
  USER_DATA="${USER_DATA/PLACEHOLDER_KAGGLE_JSON/{\"username\":\"\",\"key\":\"\"}}"
fi

USER_DATA_B64=$(echo "$USER_DATA" | base64 -w 0)

# ── Lanzar instancia spot ─────────────────────────────────────────────────────
log "Lanzando EC2 spot $INSTANCE_TYPE..."

LAUNCH_SPEC=$(cat <<JSON
{
  "ImageId": "$AMI_ID",
  "InstanceType": "$INSTANCE_TYPE",
  "KeyName": "${EC2_KEY_NAME:-deep-check-training}",
  "SecurityGroupIds": ["${EC2_SECURITY_GROUP:-}"],
  "SubnetId": "${EC2_SUBNET_ID:-}",
  "IamInstanceProfile": {"Name": "${EC2_IAM_ROLE:-deep-check-training}"},
  "UserData": "$USER_DATA_B64",
  "BlockDeviceMappings": [{
    "DeviceName": "/dev/sda1",
    "Ebs": {"VolumeSize": 100, "VolumeType": "gp3"}
  }],
  "TagSpecifications": [{
    "ResourceType": "instance",
    "Tags": [{"Key": "Name", "Value": "deep-check-full-training"}]
  }]
}
JSON
)

SPOT_REQUEST=$(aws ec2 request-spot-instances \
  --spot-price "0.60" \
  --instance-count 1 \
  --type "one-time" \
  --launch-specification "$LAUNCH_SPEC" \
  --region "$REGION" \
  --query 'SpotInstanceRequests[0].SpotInstanceRequestId' \
  --output text)

log "Spot request: $SPOT_REQUEST"
log "Esperando instancia..."

# Esperar hasta que se asigne
for i in $(seq 1 30); do
  INSTANCE_ID=$(aws ec2 describe-spot-instance-requests \
    --spot-instance-request-ids "$SPOT_REQUEST" \
    --query 'SpotInstanceRequests[0].InstanceId' \
    --output text --region "$REGION" 2>/dev/null || echo "")
  if [ "$INSTANCE_ID" != "" ] && [ "$INSTANCE_ID" != "None" ]; then
    break
  fi
  sleep 10
done

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  warn "Spot no asignado aún. Verifica en AWS Console."
  warn "Spot Request ID: $SPOT_REQUEST"
  exit 0
fi

# IP pública
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text --region "$REGION")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "EC2 lanzado: $INSTANCE_ID ($PUBLIC_IP)"
echo ""
echo "  Monitorear:"
echo "  ssh -i infra/deep-check-training.pem ec2-user@$PUBLIC_IP"
echo "  sudo tail -f /var/log/cloud-init-output.log"
echo ""
echo "  Modelos al terminar en:"
echo "  s3://$S3_BUCKET/deepfake/deepfake_pixel_v1.onnx"
echo "  s3://$S3_BUCKET/deepfake/deepfake_temporal_v2.onnx"
echo ""
echo "  Tiempo estimado: 90-120 min (pixel) + 30 min (temporal)"
echo "  Coste estimado:  ~\$1.00-1.50 total"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
