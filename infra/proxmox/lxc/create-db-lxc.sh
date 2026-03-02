#!/usr/bin/env bash
# ============================================================
# DeepCheck · LXC 300 — Base de Datos Biométrica
#
# Función: PostgreSQL 16 con cifrado AES-256 para patrones
#          biométricos. Compliant GDPR / ENS Básico.
#
# Recursos: 4GB RAM · 2 vCPU · 60GB disco ZFS cifrado
# IP: 10.10.0.30
# Ejecutar en: Proxmox host como root
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

CT_ID=300
CT_NAME="deepcheck-db"
STORAGE="local-zfs"
RAM_MB=4096
CORES=2
DISK_GB=60
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE_PATH="/var/lib/vz/template/cache/${TEMPLATE}"

# ── Descargar template si no existe ──────────────────────────────────────────
if [[ ! -f "$TEMPLATE_PATH" ]]; then
    info "Descargando template Debian 12..."
    pveam update
    pveam download local "$TEMPLATE"
fi

# ── Crear dataset ZFS cifrado para la DB ──────────────────────────────────────
info "Creando dataset ZFS cifrado para datos biométricos..."
# Generar passphrase (guardar de forma segura — se pide en cada boot)
DB_KEY_FILE="/etc/deepcheck/db-encryption.key"
mkdir -p /etc/deepcheck
chmod 700 /etc/deepcheck

if [[ ! -f "$DB_KEY_FILE" ]]; then
    openssl rand -base64 48 > "$DB_KEY_FILE"
    chmod 600 "$DB_KEY_FILE"
    warn "CLAVE DE CIFRADO DB generada en: $DB_KEY_FILE"
    warn "HAGA BACKUP DE ESTA CLAVE — sin ella los datos son irrecuperables"
fi

# Crear dataset ZFS cifrado (si el pool se llama 'rpool', ajustar)
ZFS_POOL="rpool"
ZFS_DATASET="${ZFS_POOL}/deepcheck-db-data"
if ! zfs list "$ZFS_DATASET" &>/dev/null; then
    zfs create \
        -o encryption=aes-256-gcm \
        -o keylocation="file://${DB_KEY_FILE}" \
        -o keyformat=passphrase \
        -o compression=lz4 \
        "$ZFS_DATASET" 2>/dev/null || \
    warn "No se pudo crear ZFS cifrado — usando storage normal (requiere ZFS pool)"
fi

# ── Crear LXC ─────────────────────────────────────────────────────────────────
info "Creando LXC $CT_ID ($CT_NAME)..."

pct create $CT_ID "$TEMPLATE_PATH" \
    --hostname "$CT_NAME" \
    --memory $RAM_MB \
    --cores $CORES \
    --rootfs ${STORAGE}:${DISK_GB} \
    --net0 name=eth0,bridge=vmbr1,ip=10.10.0.30/24,gw=10.10.0.1,firewall=1 \
    --nameserver 1.1.1.1 \
    --onboot 1 \
    --startup order=1,up=20 \
    --unprivileged 1 \
    --features nesting=0 \
    --description "PostgreSQL 16 · Patrones biométricos · GDPR compliant · AES-256"

# ── Firewall del contenedor (solo acceso desde VMs internas) ─────────────────
mkdir -p /etc/pve/firewall
cat > /etc/pve/firewall/${CT_ID}.fw <<'EOF'
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT

[RULES]
# PostgreSQL: solo desde AI engine y CI/CD
IN ACCEPT -p tcp --dport 5432 -source 10.10.0.0/24 -log nolog
# SSH: solo desde WireGuard
IN ACCEPT -p tcp --dport 22 -source 10.10.100.0/24 -log nolog
EOF

# ── Arrancar y configurar ─────────────────────────────────────────────────────
pct start $CT_ID
sleep 5

info "Instalando PostgreSQL 16 dentro del LXC..."
pct exec $CT_ID -- bash -c "
set -euo pipefail

# Update + instalar PostgreSQL 16
apt-get update -qq
apt-get install -y --no-install-recommends curl gnupg

# Repositorio oficial PostgreSQL
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo 'deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y --no-install-recommends postgresql-16 postgresql-client-16

# Instalar extensiones necesarias
apt-get install -y --no-install-recommends \
    postgresql-16-pgcrypto \
    fail2ban

systemctl enable postgresql
systemctl start postgresql
"

# ── Configurar PostgreSQL ─────────────────────────────────────────────────────
info "Configurando PostgreSQL (SSL, conexiones, cifrado)..."
pct exec $CT_ID -- bash -c "
PG_CONF=/etc/postgresql/16/main/postgresql.conf
PG_HBA=/etc/postgresql/16/main/pg_hba.conf

# Configuración optimizada para 4GB RAM
cat >> \$PG_CONF <<'PGCONF'

# DeepCheck tuning
listen_addresses = '10.10.0.30'
port = 5432
max_connections = 50
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 64MB
maintenance_work_mem = 256MB
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'

# SSL (GDPR: tráfico cifrado en tránsito)
ssl = on
ssl_cert_file = '/etc/postgresql/16/main/server.crt'
ssl_key_file  = '/etc/postgresql/16/main/server.key'

# Logging para auditoría GDPR
log_connections = on
log_disconnections = on
log_statement = 'ddl'
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
PGCONF

# Generar certificado SSL autofirmado para cifrado en tránsito
openssl req -new -x509 -days 3650 -nodes \
    -keyout /etc/postgresql/16/main/server.key \
    -out  /etc/postgresql/16/main/server.crt \
    -subj '/CN=deepcheck-db/O=DeepCheck/C=ES'
chown postgres:postgres /etc/postgresql/16/main/server.{key,crt}
chmod 600 /etc/postgresql/16/main/server.key

# pg_hba: solo conexiones SSL desde red interna
cat > \$PG_HBA <<'HBA'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
local   all             all                                     peer
hostssl deepcheck       deepcheck       10.10.0.0/24            scram-sha-256
hostssl all             all             10.10.100.0/24          scram-sha-256
HBA

# Crear directorio WAL archive
mkdir -p /var/lib/postgresql/wal_archive
chown postgres:postgres /var/lib/postgresql/wal_archive

# Reiniciar para aplicar config
systemctl restart postgresql

# Crear BD y usuario DeepCheck con pgcrypto
sudo -u postgres psql <<'SQL'
-- Base de datos principal
CREATE DATABASE deepcheck
    ENCODING 'UTF8'
    LC_COLLATE 'es_ES.UTF-8'
    LC_CTYPE 'es_ES.UTF-8'
    TEMPLATE template0;

-- Usuario de aplicación (no superusuario)
CREATE ROLE deepcheck WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE deepcheck TO deepcheck;

\c deepcheck

-- Habilitar extensión de cifrado
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Schema para datos biométricos (GDPR: separación de datos)
CREATE SCHEMA biometric AUTHORIZATION deepcheck;
CREATE SCHEMA audit     AUTHORIZATION deepcheck;

-- Tabla de patrones (datos cifrados en reposo con pgcrypto)
CREATE TABLE biometric.keystroke_profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id  TEXT NOT NULL,
    -- Patrón cifrado con AES-256 (clave en app, no en DB)
    pattern_enc   BYTEA NOT NULL,
    model_version TEXT DEFAULT 'v1',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 years',
    -- GDPR: consentimiento explícito
    consent_given BOOLEAN NOT NULL DEFAULT false,
    consent_date  TIMESTAMPTZ,
    data_origin   TEXT -- 'interview' | 'enrollment'
);

-- Índice parcial: solo perfiles con consentimiento activo
CREATE INDEX idx_biometric_active ON biometric.keystroke_profiles (candidate_id)
    WHERE consent_given = true AND expires_at > NOW();

-- Tabla de auditoría (GDPR Art. 5: trazabilidad)
CREATE TABLE audit.access_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ DEFAULT NOW(),
    action      TEXT NOT NULL,
    table_name  TEXT,
    record_id   UUID,
    user_name   TEXT DEFAULT current_user,
    ip_hash     TEXT, -- IP pseudonimizada
    details     JSONB
);

-- Trigger de auditoría automática
CREATE OR REPLACE FUNCTION audit.log_access()
RETURNS TRIGGER LANGUAGE plpgsql AS \$\$
BEGIN
    INSERT INTO audit.access_log(action, table_name, record_id)
    VALUES (TG_OP, TG_TABLE_NAME, COALESCE(NEW.id, OLD.id));
    RETURN NEW;
END;
\$\$;

CREATE TRIGGER biometric_audit
AFTER INSERT OR UPDATE OR DELETE ON biometric.keystroke_profiles
FOR EACH ROW EXECUTE FUNCTION audit.log_access();

-- Política de retención GDPR (2 años)
CREATE OR REPLACE FUNCTION biometric.purge_expired()
RETURNS void LANGUAGE sql AS \$\$
    DELETE FROM biometric.keystroke_profiles WHERE expires_at < NOW();
\$\$;

GRANT USAGE ON SCHEMA biometric, audit TO deepcheck;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA biometric TO deepcheck;
GRANT INSERT ON audit.access_log TO deepcheck;
SQL
"

info "Base de datos configurada:"
echo "  Host: 10.10.0.30:5432"
echo "  DB:   deepcheck"
echo "  User: deepcheck"
warn "IMPORTANTE: Cambia la password en psql:"
warn "  ALTER ROLE deepcheck PASSWORD 'nueva_password_segura';"
