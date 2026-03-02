#!/usr/bin/env bash
# ============================================================
# DeepCheck · Backup Automático + Cifrado GDPR
#
# Estrategia 3-2-1:
#   3 copias, 2 medios distintos, 1 offsite (Backblaze B2)
#
# Schedules:
#   - Snapshots ZFS cada 4h (retención 7 días)
#   - Backup Proxmox diario 02:00 (retención 14 días)
#   - Sync cifrado a Backblaze B2 diario 03:00
#
# Cumplimiento: GDPR Art.32, ENS op.exp.4
# Ejecutar en: Proxmox host como root
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

# ── Verificar herramientas ────────────────────────────────────────────────────
for cmd in pvesm vzdump zfs; do
    command -v "$cmd" &>/dev/null || { warn "$cmd no encontrado"; }
done

# ── 1. Configurar Proxmox Backup schedules ────────────────────────────────────
info "Configurando schedules de backup en Proxmox..."

# Backup diario de todas las VMs/LXCs a las 02:00
cat > /etc/cron.d/deepcheck-backup <<'EOF'
# DeepCheck — Backups automáticos cifrados
# GDPR Art.32: medidas técnicas de protección de datos

# Backup diario de VMs críticas (02:00)
0 2 * * * root /usr/bin/vzdump 200 300 400 \
    --storage local \
    --mode snapshot \
    --compress zstd \
    --maxfiles 14 \
    --mailto root \
    --notes-template "DeepCheck backup {{guestname}} {{date}}" \
    >> /var/log/deepcheck-backup.log 2>&1

# Backup semanal completo Windows VM (domingos 01:00)
0 1 * * 0 root /usr/bin/vzdump 100 \
    --storage local \
    --mode snapshot \
    --compress zstd \
    --maxfiles 4 \
    >> /var/log/deepcheck-backup.log 2>&1

# Snapshots ZFS cada 4 horas (retención 7 días = 42 snapshots)
0 */4 * * * root /usr/local/bin/deepcheck-zfs-snapshot.sh >> /var/log/deepcheck-zfs.log 2>&1

# Sync cifrado a Backblaze B2 (03:00)
0 3 * * * root /usr/local/bin/deepcheck-offsite-sync.sh >> /var/log/deepcheck-offsite.log 2>&1

# Purgar snapshots antiguos (04:00)
0 4 * * * root /usr/local/bin/deepcheck-purge-snapshots.sh >> /var/log/deepcheck-purge.log 2>&1

# Verificar integridad de backups (domingos 05:00)
0 5 * * 0 root /usr/local/bin/deepcheck-verify-backup.sh >> /var/log/deepcheck-verify.log 2>&1
EOF

# ── 2. Script de snapshots ZFS ────────────────────────────────────────────────
info "Creando script de snapshots ZFS..."
cat > /usr/local/bin/deepcheck-zfs-snapshot.sh <<'EOF'
#!/usr/bin/env bash
# Snapshots ZFS automáticos con retención de 7 días
set -euo pipefail

POOLS=("rpool/data")
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d-%H%M)
PREFIX="deepcheck-auto"

for POOL in "${POOLS[@]}"; do
    # Crear snapshot
    if zfs list "$POOL" &>/dev/null; then
        SNAP_NAME="${POOL}@${PREFIX}-${TIMESTAMP}"
        zfs snapshot "$SNAP_NAME"
        echo "[$(date)] Snapshot creado: $SNAP_NAME"

        # Purgar snapshots antiguos
        zfs list -t snapshot -H -o name "$POOL" | \
            grep "@${PREFIX}-" | \
            while read -r snap; do
                SNAP_DATE=$(echo "$snap" | grep -oP '\d{8}')
                CUTOFF=$(date -d "${RETENTION_DAYS} days ago" +%Y%m%d)
                if [[ "$SNAP_DATE" < "$CUTOFF" ]]; then
                    zfs destroy "$snap"
                    echo "[$(date)] Snapshot purgado: $snap"
                fi
            done
    fi
done
EOF
chmod +x /usr/local/bin/deepcheck-zfs-snapshot.sh

# ── 3. Script de sync offsite cifrado ─────────────────────────────────────────
info "Creando script de sync offsite (Backblaze B2 / rclone)..."

# Instalar rclone
if ! command -v rclone &>/dev/null; then
    curl -s https://rclone.org/install.sh | bash
fi

cat > /usr/local/bin/deepcheck-offsite-sync.sh <<'SYNC'
#!/usr/bin/env bash
# Sync cifrado de backups a Backblaze B2
# Requiere: rclone configurado con 'rclone config' (remote: b2-deepcheck)
# Cifrado: rclone crypt sobre B2 (AES-256-CTR)
set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
BACKUP_DIR="/var/lib/vz/dump"
RCLONE_REMOTE="b2-deepcheck-crypt:"  # remote cifrado configurado con rclone

# Verificar que rclone está configurado
if ! rclone listremotes | grep -q "b2-deepcheck-crypt"; then
    echo "$LOG_PREFIX ERROR: rclone remote 'b2-deepcheck-crypt' no configurado"
    echo "$LOG_PREFIX Ejecuta: rclone config"
    echo "$LOG_PREFIX Crea un remote 'crypt' sobre un remote B2"
    exit 1
fi

# Sync (solo sube archivos nuevos/modificados)
echo "$LOG_PREFIX Iniciando sync a Backblaze B2..."
rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" \
    --transfers 4 \
    --checkers 8 \
    --log-level INFO \
    --stats 60s \
    --exclude "*.tmp" \
    --min-age 1h

echo "$LOG_PREFIX Sync completado"

# GDPR: log de transferencias (Art. 30 — registro de actividades)
BYTES=$(rclone size "$RCLONE_REMOTE" --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('bytes',0))" || echo "0")
echo "$LOG_PREFIX Tamaño total remoto: ${BYTES} bytes"
SYNC
chmod +x /usr/local/bin/deepcheck-offsite-sync.sh

# ── 4. Script de purga de snapshots viejos ────────────────────────────────────
cat > /usr/local/bin/deepcheck-purge-snapshots.sh <<'PURGE'
#!/usr/bin/env bash
# Purgar backups de vzdump con más de 14 días
find /var/lib/vz/dump -name "vzdump-*" -mtime +14 -delete \
    && echo "[$(date)] Purga completada"
PURGE
chmod +x /usr/local/bin/deepcheck-purge-snapshots.sh

# ── 5. Script de verificación de integridad ───────────────────────────────────
cat > /usr/local/bin/deepcheck-verify-backup.sh <<'VERIFY'
#!/usr/bin/env bash
# Verificar integridad de backups (GDPR: disponibilidad de datos)
set -euo pipefail
LOG="[$(date '+%Y-%m-%d %H:%M:%S')]"

BACKUP_DIR="/var/lib/vz/dump"
ERRORS=0

echo "$LOG Verificando integridad de backups..."

for f in "$BACKUP_DIR"/*.zst; do
    [[ -f "$f" ]] || continue
    if zstd -t "$f" &>/dev/null; then
        echo "$LOG [OK] $f"
    else
        echo "$LOG [ERROR] Corrupto: $f"
        ((ERRORS++))
        # Alertar por email
        echo "Backup corrupto detectado: $f" | mail -s "DeepCheck ALERT: Backup Corrupto" root
    fi
done

# Verificar ZFS pool
echo "$LOG Verificando ZFS pool..."
zpool status -x rpool || ((ERRORS++))

echo "$LOG Verificación completada. Errores: $ERRORS"
exit $ERRORS
VERIFY
chmod +x /usr/local/bin/deepcheck-verify-backup.sh

# ── 6. Registro de actividades GDPR (Art. 30) ─────────────────────────────────
info "Configurando log de actividades GDPR..."
cat > /etc/logrotate.d/deepcheck-gdpr <<'EOF'
/var/log/deepcheck-*.log {
    daily
    rotate 365
    compress
    delaycompress
    missingok
    notifempty
    create 640 root adm
}
EOF

# ── 7. Configurar rclone con B2 (guía interactiva) ────────────────────────────
echo ""
info "Guía para configurar Backblaze B2 (offsite cifrado):"
echo ""
echo "  1. Crea cuenta en backblaze.com"
echo "  2. Crea un bucket privado: 'deepcheck-backups'"
echo "  3. Crea Application Keys con acceso al bucket"
echo "  4. Ejecuta en el servidor:"
echo "       rclone config"
echo "       → New remote → nombre: b2-deepcheck"
echo "       → Type: Backblaze B2"
echo "       → Introduce keyID y applicationKey"
echo ""
echo "  5. Crea remote cifrado:"
echo "       rclone config"
echo "       → New remote → nombre: b2-deepcheck-crypt"
echo "       → Type: Crypt"
echo "       → Remote: b2-deepcheck:deepcheck-backups"
echo "       → Encryption: standard"
echo "       → Guarda la passphrase en /etc/deepcheck/b2-crypt-pass"
echo ""
echo "  6. Test:"
echo "       rclone ls b2-deepcheck-crypt:"
echo ""
warn "GDPR Art.32: Los backups están cifrados AES-256 en tránsito (TLS) y en reposo (rclone crypt)"
warn "GDPR Art.30: Los logs de transferencia se guardan 365 días en /var/log/deepcheck-offsite.log"
echo ""

info "Sistema de backups configurado:"
echo "  📁 Local:    /var/lib/vz/dump (14 días)"
echo "  💾 ZFS:      Snapshots cada 4h (7 días)"
echo "  ☁️  Offsite:  Backblaze B2 cifrado (diario)"
echo "  🔐 Cifrado:  AES-256-CTR (rclone crypt)"
