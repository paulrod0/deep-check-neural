#!/usr/bin/env bash
# deploy_pixel_model.sh — Descarga deepfake_pixel_v1.onnx de S3 y lo despliega
# Ejecutar desde la raíz del proyecto cuando el entrenamiento EC2 termine.
#
# Uso:
#   bash infra/deploy_pixel_model.sh
#   bash infra/deploy_pixel_model.sh --wait   # espera hasta que esté en S3
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail
S3_BUCKET="${S3_BUCKET:-deep-check-models}"
DEST="public/models/deepfake"
MODEL="deepfake_pixel_v1.onnx"
META="deepfake_pixel_v1_metadata.json"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

mkdir -p "$DEST"

# ── Selección de modelo ───────────────────────────────────────────────────────
# Modelos disponibles en S3 (entrenados en EC2 g4dn.xlarge con Tesla T4):
#   celebdf_best.onnx        — AUC 0.9913 (FF++ → CelebDF v2) ← RECOMENDADO
#   faceforensics++_best.onnx — AUC 0.9602 (base)
#   dfdc_best.onnx            — AUC 0.9434 (FF++ → DFDC)
S3_MODEL="${S3_MODEL:-celebdf_best.onnx}"
S3_PREFIX="trained"

# ── Opción --wait: poll S3 hasta que el modelo aparezca ───────────────────────
if [[ "${1:-}" == "--wait" ]]; then
  log "Esperando que $S3_MODEL aparezca en s3://$S3_BUCKET/$S3_PREFIX/ ..."
  while ! aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/$S3_MODEL" &>/dev/null; do
    echo -n "."
    sleep 30
  done
  echo ""
  ok "Modelo detectado en S3"
fi

# ── Descargar modelo y metadata ───────────────────────────────────────────────
log "Descargando $S3_MODEL de s3://$S3_BUCKET/$S3_PREFIX/ ..."
aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$S3_MODEL"   "$DEST/$MODEL"   && ok "$S3_MODEL → $MODEL"
log "Descargando métricas..."
aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/metrics.jsonl" \
          "$DEST/training_metrics.jsonl" 2>/dev/null && ok "metrics.jsonl" || \
  warn "metrics.jsonl no encontrado (opcional)"

# ── Mostrar métricas ──────────────────────────────────────────────────────────
if [ -f "$DEST/$META" ]; then
  echo ""
  echo "  Métricas del modelo:"
  python3 -c "
import json
m = json.load(open('$DEST/$META'))
metrics = m.get('metrics', {})
calib   = m.get('calibration', {})
datasets = m.get('datasets', [])
print(f'    AUC:           {metrics.get(\"test_auc\", \"N/A\")}')
print(f'    Accuracy:      {metrics.get(\"test_accuracy\", \"N/A\")}')
print(f'    EER:           {metrics.get(\"test_eer\", \"N/A\")}')
print(f'    Platt coef:    {calib.get(\"coef\", \"N/A\")}')
print(f'    Platt inter:   {calib.get(\"intercept\", \"N/A\")}')
print(f'    Datasets:      {datasets}')
print(f'    ONNX size:     {m.get(\"onnx_size_mb\", \"N/A\")} MB')
" 2>/dev/null || true
  echo ""
fi

size_mb=$(du -m "$DEST/$MODEL" | cut -f1)
ok "deepfake_pixel_v1.onnx desplegado (${size_mb}MB)"
echo ""
echo "  La API /api/deepfake cargará automáticamente el nuevo modelo."
echo "  Para probar localmente:"
echo "    npm run dev"
echo "    curl -X POST http://localhost:3000/api/deepfake \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"faceImageBase64\": \"...\"}'"
