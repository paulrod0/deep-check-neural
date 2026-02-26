#!/usr/bin/env bash
# =============================================================================
# Deep-Check · EC2 Spot GPU Training Launcher
# =============================================================================
# Lanza una instancia EC2 Spot g4dn.xlarge (T4 GPU, ~$0.16/hr) que:
#   1. Descarga el script de entrenamiento desde S3
#   2. Instala dependencias (PyTorch, ONNX, etc.)
#   3. Entrena BiLSTMv2 y exporta el modelo a ONNX
#   4. Sube los artefactos a S3
#   5. Se auto-termina al terminar (0 coste extra)
#
# Coste estimado:
#   - Entrenamiento: ~2h × $0.16/hr = ~$0.32
#   - S3 almacenamiento: ~$0.002/mes
#   - Total primer mes: < $0.35
#
# Uso:
#   export AWS_REGION=eu-west-1          # (o el que prefieras)
#   export S3_BUCKET=deep-check-models   # debe existir (creado por deploy.sh)
#   bash infra/ec2_spot_train.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Config (sobreescribir con variables de entorno si hace falta)
# ---------------------------------------------------------------------------
REGION="${AWS_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
INSTANCE_TYPE="g4dn.xlarge"
AMI_ID="${AMI_ID:-}"          # se detecta automáticamente si vacío
KEY_NAME="${KEY_NAME:-}"       # opcional: par de claves para SSH debug
SPOT_PRICE="0.30"             # precio máximo por hora (spot suele ser ~0.16)
IAM_ROLE="${IAM_ROLE:-deep-check-ec2-training}"  # rol con acceso a S3

# ---------------------------------------------------------------------------
# Colores
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# Comprobaciones previas
# ---------------------------------------------------------------------------
command -v aws >/dev/null 2>&1 || error "aws CLI no encontrado. Instala: https://aws.amazon.com/cli/"
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 \
    || error "Credenciales AWS no configuradas. Ejecuta: aws configure"

# ---------------------------------------------------------------------------
# Subir script de entrenamiento a S3 (para que la instancia lo descargue)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "Subiendo train_gpu.py a s3://${S3_BUCKET}/scripts/"
aws s3 cp "${SCRIPT_DIR}/train_gpu.py" \
    "s3://${S3_BUCKET}/scripts/train_gpu.py" \
    --region "$REGION"

# ---------------------------------------------------------------------------
# Detectar AMI Deep Learning (Amazon Linux 2 + CUDA 12 + PyTorch)
# ---------------------------------------------------------------------------
if [[ -z "$AMI_ID" ]]; then
    info "Buscando AMI Deep Learning (Amazon Linux 2 + CUDA 12)..."
    AMI_ID=$(aws ec2 describe-images \
        --region "$REGION" \
        --owners amazon \
        --filters \
            "Name=name,Values=Deep Learning AMI GPU PyTorch 2.* (Amazon Linux 2)*" \
            "Name=state,Values=available" \
        --query "sort_by(Images, &CreationDate)[-1].ImageId" \
        --output text)
    [[ -z "$AMI_ID" || "$AMI_ID" == "None" ]] && \
        error "No se encontró AMI de Deep Learning en ${REGION}. Especifica AMI_ID manualmente."
    info "AMI seleccionada: ${AMI_ID}"
fi

# ---------------------------------------------------------------------------
# Security Group (buscar o crear uno temporal)
# ---------------------------------------------------------------------------
SG_NAME="deep-check-training-sg"
SG_ID=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters "Name=group-name,Values=${SG_NAME}" \
    --query "SecurityGroups[0].GroupId" \
    --output text 2>/dev/null || echo "None")

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
    info "Creando security group ${SG_NAME}..."
    SG_ID=$(aws ec2 create-security-group \
        --region "$REGION" \
        --group-name "$SG_NAME" \
        --description "Deep-Check EC2 training (temporal)" \
        --query "GroupId" --output text)
    # Solo SSH si se provee key pair
    if [[ -n "$KEY_NAME" ]]; then
        aws ec2 authorize-security-group-ingress \
            --region "$REGION" --group-id "$SG_ID" \
            --protocol tcp --port 22 --cidr 0.0.0.0/0
    fi
fi
info "Security Group: ${SG_ID}"

# ---------------------------------------------------------------------------
# User data — script que corre en la instancia al arrancar
# ---------------------------------------------------------------------------
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -euo pipefail
exec > /var/log/deep-check-train.log 2>&1

echo "=== Deep-Check GPU Training ==="
echo "Fecha: $(date)"
echo "Instancia: $(curl -s http://169.254.169.254/latest/meta-data/instance-type)"

# Variables inyectadas por sed a continuación
S3_BUCKET="__S3_BUCKET__"
REGION="__REGION__"

# Activar conda PyTorch
source /opt/conda/etc/profile.d/conda.sh
conda activate pytorch

# Instalar dependencias extra
pip install -q onnx onnxruntime scikit-learn

# Descargar script de entrenamiento
aws s3 cp "s3://${S3_BUCKET}/scripts/train_gpu.py" /home/ec2-user/train_gpu.py \
    --region "$REGION"

# Ejecutar entrenamiento
cd /home/ec2-user
python train_gpu.py

# Subir artefactos a S3
echo "Subiendo modelos a S3..."
aws s3 sync /home/ec2-user/models/ "s3://${S3_BUCKET}/models/" \
    --region "$REGION" \
    --exclude "*.tmp"

echo "=== Entrenamiento completado: $(date) ==="

# Auto-terminar instancia para 0 coste extra
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
USERDATA
)

# Inyectar variables en el user data
USER_DATA="${USER_DATA/__S3_BUCKET__/$S3_BUCKET}"
USER_DATA="${USER_DATA/__REGION__/$REGION}"
USER_DATA_B64=$(echo "$USER_DATA" | base64 | tr -d '\n')

# ---------------------------------------------------------------------------
# Lanzar instancia Spot
# ---------------------------------------------------------------------------
info "Lanzando instancia Spot ${INSTANCE_TYPE}..."

LAUNCH_SPEC=$(cat <<JSON
{
    "ImageId": "${AMI_ID}",
    "InstanceType": "${INSTANCE_TYPE}",
    "UserData": "${USER_DATA_B64}",
    "SecurityGroupIds": ["${SG_ID}"],
    "IamInstanceProfile": {
        "Name": "${IAM_ROLE}"
    },
    "BlockDeviceMappings": [{
        "DeviceName": "/dev/xvda",
        "Ebs": {
            "VolumeSize": 50,
            "VolumeType": "gp3",
            "DeleteOnTermination": true
        }
    }]
    $([ -n "$KEY_NAME" ] && echo ", \"KeyName\": \"${KEY_NAME}\"" || echo "")
}
JSON
)

REQUEST_ID=$(aws ec2 request-spot-instances \
    --region "$REGION" \
    --spot-price "$SPOT_PRICE" \
    --instance-count 1 \
    --type "one-time" \
    --launch-specification "$LAUNCH_SPEC" \
    --query "SpotInstanceRequests[0].SpotInstanceRequestId" \
    --output text)

info "Spot request: ${REQUEST_ID}"

# Esperar a que se asigne la instancia
echo -n "Esperando instancia"
for i in $(seq 1 60); do
    INSTANCE_ID=$(aws ec2 describe-spot-instance-requests \
        --region "$REGION" \
        --spot-instance-request-ids "$REQUEST_ID" \
        --query "SpotInstanceRequests[0].InstanceId" \
        --output text 2>/dev/null || echo "")
    if [[ -n "$INSTANCE_ID" && "$INSTANCE_ID" != "None" ]]; then
        echo ""
        info "Instancia asignada: ${INSTANCE_ID}"
        break
    fi
    echo -n "."
    sleep 5
done

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
    error "Timeout esperando la instancia Spot. Comprueba la consola AWS."
fi

# ---------------------------------------------------------------------------
# Esperar a que el entrenamiento termine (log en S3)
# ---------------------------------------------------------------------------
echo ""
warn "El entrenamiento puede tardar 1-2 horas."
warn "Cuando termine, los modelos estarán en:"
echo "  s3://${S3_BUCKET}/models/"
echo ""
info "Para ver el progreso:"
echo "  aws s3 cp s3://${S3_BUCKET}/models/ ./models/ --recursive --region ${REGION}"
echo ""
info "Cuando los modelos estén en S3, ejecuta:"
echo "  bash infra/deploy.sh"
echo ""

# Guardar el ID para referencia
echo "$INSTANCE_ID" > /tmp/deep-check-training-instance.txt
info "ID guardado en /tmp/deep-check-training-instance.txt"
