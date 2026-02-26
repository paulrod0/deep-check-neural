#!/usr/bin/env bash
# =============================================================================
# Deep-Check · AWS One-Command Deployment
# =============================================================================
# Despliega la infraestructura de inferencia LSTM en AWS:
#   1. Crea bucket S3 para modelos
#   2. Sube modelo ONNX y scaler desde models/lstm/ → S3
#   3. Empaqueta Lambda (handler + deps + model)
#   4. Crea/actualiza la función Lambda con Function URL (sin API Gateway)
#   5. Genera un token Bearer secreto y lo muestra para configurar Vercel
#
# Coste estimado:
#   - Lambda: gratis (< 1M req/mes en free tier; después ~$0.0000002/req)
#   - S3: ~$0.003/mes por 500KB de modelo
#   - Total: prácticamente $0 para volúmenes típicos de entrevistas
#
# Uso:
#   export AWS_REGION=eu-west-1
#   bash infra/deploy.sh
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REGION="${AWS_REGION:-eu-west-1}"
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
FUNCTION_NAME="deep-check-lstm-inference"
LAMBDA_ROLE="${LAMBDA_ROLE:-deep-check-lambda-role}"
PYTHON_RUNTIME="python3.11"
MEMORY_MB=512
TIMEOUT_S=15

# Colores
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${GREEN}[+]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
success() { echo -e "${CYAN}[✓]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step()    { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="/tmp/deep-check-lambda-build"

# ---------------------------------------------------------------------------
# 0. Comprobaciones previas
# ---------------------------------------------------------------------------
step "Comprobaciones"
command -v aws  >/dev/null 2>&1 || error "aws CLI no encontrado."
command -v pip3 >/dev/null 2>&1 || error "pip3 no encontrado."
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 \
    || error "Credenciales AWS no configuradas. Ejecuta: aws configure"

MODEL_ONNX="${PROJECT_DIR}/models/lstm/lstm_model.onnx"
MODEL_SCALER="${PROJECT_DIR}/models/lstm/lstm_scaler.json"
[[ -f "$MODEL_ONNX" ]] || error "Modelo no encontrado: ${MODEL_ONNX}\nEjecuta primero: bash infra/ec2_spot_train.sh  (o python scripts/train_lstm.py para modelo local)"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
info "Cuenta AWS: ${ACCOUNT_ID} | Región: ${REGION}"

# ---------------------------------------------------------------------------
# 1. Bucket S3
# ---------------------------------------------------------------------------
step "S3 Bucket"
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
    info "Bucket ya existe: s3://${S3_BUCKET}"
else
    info "Creando bucket s3://${S3_BUCKET}..."
    if [[ "$REGION" == "us-east-1" ]]; then
        aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION"
    else
        aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION"
    fi
    # Bloquear acceso público
    aws s3api put-public-access-block --bucket "$S3_BUCKET" \
        --public-access-block-configuration \
            BlockPublicAcls=true,IgnorePublicAcls=true,\
BlockPublicPolicy=true,RestrictPublicBuckets=true
    success "Bucket creado: s3://${S3_BUCKET}"
fi

# Subir modelos
info "Subiendo modelos a S3..."
aws s3 cp "$MODEL_ONNX"   "s3://${S3_BUCKET}/models/lstm/lstm_model.onnx" --region "$REGION"
[[ -f "$MODEL_SCALER" ]] && \
    aws s3 cp "$MODEL_SCALER" "s3://${S3_BUCKET}/models/lstm/lstm_scaler.json" --region "$REGION"
success "Modelos subidos"

# ---------------------------------------------------------------------------
# 2. IAM Role para Lambda
# ---------------------------------------------------------------------------
step "IAM Role"
ROLE_ARN=""
if ROLE_ARN=$(aws iam get-role --role-name "$LAMBDA_ROLE" \
        --query "Role.Arn" --output text 2>/dev/null); then
    info "Rol ya existe: ${ROLE_ARN}"
else
    info "Creando rol IAM ${LAMBDA_ROLE}..."
    TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    ROLE_ARN=$(aws iam create-role --role-name "$LAMBDA_ROLE" \
        --assume-role-policy-document "$TRUST_POLICY" \
        --query "Role.Arn" --output text)
    aws iam attach-role-policy --role-name "$LAMBDA_ROLE" \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    # Acceso a S3 para descargar modelo si es necesario
    aws iam put-role-policy --role-name "$LAMBDA_ROLE" \
        --policy-name "S3ModelRead" \
        --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::${S3_BUCKET}\",\"arn:aws:s3:::${S3_BUCKET}/*\"]}]}"
    info "Esperando propagación IAM (10s)..."
    sleep 10
    success "Rol creado: ${ROLE_ARN}"
fi

# ---------------------------------------------------------------------------
# 3. Empaquetar Lambda
# ---------------------------------------------------------------------------
step "Build del paquete Lambda"
rm -rf "$BUILD_DIR" && mkdir -p "${BUILD_DIR}/package"

# Instalar dependencias (binarios compatibles con Lambda/Amazon Linux 2)
info "Instalando dependencias Python..."
pip3 install -q \
    --platform manylinux2014_x86_64 \
    --implementation cp \
    --python-version 3.11 \
    --only-binary=:all: \
    --target "${BUILD_DIR}/package" \
    onnxruntime==1.18.1 numpy==1.26.4

# Copiar handler y modelo
cp "${SCRIPT_DIR}/lambda/handler.py" "${BUILD_DIR}/package/handler.py"
mkdir -p "${BUILD_DIR}/package/model"
cp "$MODEL_ONNX" "${BUILD_DIR}/package/model/lstm_model.onnx"
[[ -f "$MODEL_SCALER" ]] && cp "$MODEL_SCALER" "${BUILD_DIR}/package/model/lstm_scaler.json"

# Crear ZIP
info "Creando ZIP..."
(cd "${BUILD_DIR}/package" && zip -qr "${BUILD_DIR}/function.zip" .)
ZIP_SIZE=$(du -sh "${BUILD_DIR}/function.zip" | cut -f1)
info "ZIP creado: ${ZIP_SIZE}"

# Límite Lambda = 250MB unzipped. Advertir si es grande.
UNZIP_SIZE=$(du -sh "${BUILD_DIR}/package" | cut -f1)
info "Tamaño descomprimido: ${UNZIP_SIZE}"

# ---------------------------------------------------------------------------
# 4. Generar token secreto
# ---------------------------------------------------------------------------
step "Token de autenticación"
LAMBDA_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
info "Token generado (guárdalo ahora — no se mostrará de nuevo)"

# ---------------------------------------------------------------------------
# 5. Crear o actualizar función Lambda
# ---------------------------------------------------------------------------
step "Lambda Function"
FUNCTION_EXISTS=$(aws lambda get-function --function-name "$FUNCTION_NAME" \
    --region "$REGION" --query "Configuration.FunctionArn" \
    --output text 2>/dev/null || echo "")

if [[ -n "$FUNCTION_EXISTS" && "$FUNCTION_EXISTS" != "None" ]]; then
    info "Actualizando función existente..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://${BUILD_DIR}/function.zip" \
        --region "$REGION" >/dev/null
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --timeout "$TIMEOUT_S" \
        --memory-size "$MEMORY_MB" \
        --environment "Variables={DEEP_CHECK_LAMBDA_SECRET=${LAMBDA_SECRET}}" >/dev/null
    FUNCTION_ARN="$FUNCTION_EXISTS"
else
    info "Creando función Lambda..."
    FUNCTION_ARN=$(aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$PYTHON_RUNTIME" \
        --role "$ROLE_ARN" \
        --handler "handler.handler" \
        --zip-file "fileb://${BUILD_DIR}/function.zip" \
        --timeout "$TIMEOUT_S" \
        --memory-size "$MEMORY_MB" \
        --region "$REGION" \
        --environment "Variables={DEEP_CHECK_LAMBDA_SECRET=${LAMBDA_SECRET}}" \
        --query "FunctionArn" --output text)
fi

# Esperar a que esté activa
info "Esperando a que Lambda esté activa..."
aws lambda wait function-active \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"
success "Lambda activa: ${FUNCTION_ARN}"

# ---------------------------------------------------------------------------
# 6. Function URL (sin API Gateway — gratis)
# ---------------------------------------------------------------------------
step "Function URL"
URL_CONFIG=$(aws lambda get-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" 2>/dev/null || echo "")

if [[ -n "$URL_CONFIG" ]]; then
    FUNCTION_URL=$(echo "$URL_CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['FunctionUrl'])")
    info "Function URL ya existe: ${FUNCTION_URL}"
else
    info "Creando Function URL..."
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --region "$REGION" \
        --query "FunctionUrl" --output text)
    # Permitir invocaciones públicas (el token Bearer es la auth)
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id "FunctionURLAllowPublicAccess" \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE \
        --region "$REGION" >/dev/null
    success "Function URL creada"
fi

# ---------------------------------------------------------------------------
# 7. Limpieza
# ---------------------------------------------------------------------------
rm -rf "$BUILD_DIR"

# ---------------------------------------------------------------------------
# 8. Resumen final
# ---------------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}  Deep-Check Lambda desplegada correctamente  ${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  Function URL:  ${GREEN}${FUNCTION_URL}${NC}"
echo -e "  Secret token:  ${YELLOW}${LAMBDA_SECRET}${NC}"
echo ""
echo "  Añade estas variables a Vercel (.env.local para dev):"
echo ""
echo -e "  ${CYAN}LSTM_LAMBDA_URL=${FUNCTION_URL}${NC}"
echo -e "  ${CYAN}LSTM_LAMBDA_SECRET=${LAMBDA_SECRET}${NC}"
echo ""
echo "  Prueba rápida:"
echo "  curl -s -X POST '${FUNCTION_URL}' \\"
echo "       -H 'Authorization: Bearer ${LAMBDA_SECRET}' \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"rawSequence\":[{\"flightTime\":120,\"holdTime\":80},{\"flightTime\":115,\"holdTime\":75},{\"flightTime\":125,\"holdTime\":85},{\"flightTime\":118,\"holdTime\":78},{\"flightTime\":122,\"holdTime\":82}]}'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
