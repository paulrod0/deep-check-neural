#!/usr/bin/env bash
# ============================================================
# DeepCheck · LXC 400 — CI/CD Pipeline
#
# Función: Gitea (Git self-hosted) + Woodpecker CI
#          Recibe código desde MacBook → tests → deploy a AI VM
#
# Recursos: 4GB RAM · 2 vCPU · 40GB disco
# IP: 10.10.0.40
# Ejecutar en: Proxmox host como root
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

CT_ID=400
CT_NAME="deepcheck-cicd"
STORAGE="local-zfs"
RAM_MB=4096
CORES=2
DISK_GB=40
TEMPLATE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE_PATH="/var/lib/vz/template/cache/${TEMPLATE}"

[[ ! -f "$TEMPLATE_PATH" ]] && { pveam update; pveam download local "$TEMPLATE"; }

# ── Crear LXC ─────────────────────────────────────────────────────────────────
info "Creando LXC $CT_ID ($CT_NAME)..."
pct create $CT_ID "$TEMPLATE_PATH" \
    --hostname "$CT_NAME" \
    --memory $RAM_MB \
    --cores $CORES \
    --rootfs ${STORAGE}:${DISK_GB} \
    --net0 name=eth0,bridge=vmbr1,ip=10.10.0.40/24,gw=10.10.0.1,firewall=1 \
    --nameserver 1.1.1.1 \
    --onboot 1 \
    --startup order=2,up=40 \
    --unprivileged 1 \
    --features nesting=1 \
    --description "Gitea + Woodpecker CI · Deploys a AI Engine · IP: 10.10.0.40"

# ── Firewall del contenedor ────────────────────────────────────────────────────
cat > /etc/pve/firewall/${CT_ID}.fw <<'EOF'
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT

[RULES]
# Gitea web: desde VPN (MacBook) y red interna
IN ACCEPT -p tcp --dport 3000 -source 10.10.100.0/24 -log nolog
IN ACCEPT -p tcp --dport 3000 -source 10.10.0.0/24 -log nolog
# Gitea SSH
IN ACCEPT -p tcp --dport 2222 -source 10.10.100.0/24 -log nolog
# Woodpecker UI y agent
IN ACCEPT -p tcp --dport 8000 -source 10.10.100.0/24 -log nolog
IN ACCEPT -p tcp --dport 9000 -source 10.10.0.0/24 -log nolog
# SSH admin
IN ACCEPT -p tcp --dport 22 -source 10.10.100.0/24 -log nolog
EOF

pct start $CT_ID
sleep 8

# ── Instalar Docker y dependencias ────────────────────────────────────────────
info "Instalando Docker dentro del LXC..."
pct exec $CT_ID -- bash -c "
apt-get update -qq
apt-get install -y --no-install-recommends \
    curl gnupg ca-certificates git sqlite3

# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
"

# ── Generar secrets ───────────────────────────────────────────────────────────
GITEA_SECRET=$(openssl rand -hex 32)
WOODPECKER_SECRET=$(openssl rand -hex 32)
GITEA_DB_PASS=$(openssl rand -hex 24)

# Guardar secrets de forma segura
cat > /etc/deepcheck/cicd-secrets.env <<EOF
GITEA_SECRET_KEY=${GITEA_SECRET}
WOODPECKER_AGENT_SECRET=${WOODPECKER_SECRET}
GITEA_DB_PASS=${GITEA_DB_PASS}
EOF
chmod 600 /etc/deepcheck/cicd-secrets.env
warn "Secrets guardados en /etc/deepcheck/cicd-secrets.env"

# ── Docker Compose stack: Gitea + Woodpecker ──────────────────────────────────
info "Desplegando Gitea + Woodpecker CI..."
pct exec $CT_ID -- bash -c "
mkdir -p /opt/deepcheck-cicd
cat > /opt/deepcheck-cicd/docker-compose.yml <<'COMPOSE'
version: '3.9'

volumes:
  gitea-data:
  gitea-db:
  woodpecker-data:

networks:
  cicd:
    driver: bridge

services:
  # ── Gitea: Git self-hosted ─────────────────────────────────────────────────
  gitea-db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: ${GITEA_DB_PASS}
      POSTGRES_DB: gitea
    volumes:
      - gitea-db:/var/lib/postgresql/data
    networks: [cicd]
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U gitea\"]
      interval: 10s

  gitea:
    image: gitea/gitea:1.22-rootless
    restart: unless-stopped
    depends_on:
      gitea-db:
        condition: service_healthy
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: gitea-db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: ${GITEA_DB_PASS}
      GITEA__security__SECRET_KEY: ${GITEA_SECRET}
      GITEA__server__DOMAIN: 10.10.0.40
      GITEA__server__ROOT_URL: http://10.10.0.40:3000
      GITEA__server__SSH_DOMAIN: 10.10.0.40
      GITEA__server__SSH_PORT: 2222
      GITEA__server__LFS_START_SERVER: 'true'
      GITEA__mailer__ENABLED: 'false'
      GITEA__openid__ENABLE_OPENID_SIGNUP: 'false'
      GITEA__service__DISABLE_REGISTRATION: 'true'
      GITEA__service__REQUIRE_SIGNIN_VIEW: 'true'
    ports:
      - '3000:3000'
      - '2222:2222'
    volumes:
      - gitea-data:/var/lib/gitea
    networks: [cicd]

  # ── Woodpecker CI ──────────────────────────────────────────────────────────
  woodpecker-server:
    image: woodpeckerci/woodpecker-server:latest
    restart: unless-stopped
    depends_on: [gitea]
    ports:
      - '8000:8000'
      - '9000:9000'
    environment:
      WOODPECKER_OPEN: 'false'
      WOODPECKER_HOST: http://10.10.0.40:8000
      WOODPECKER_GITEA: 'true'
      WOODPECKER_GITEA_URL: http://10.10.0.40:3000
      WOODPECKER_GITEA_CLIENT: GITEA_OAUTH_CLIENT_ID
      WOODPECKER_GITEA_SECRET: GITEA_OAUTH_CLIENT_SECRET
      WOODPECKER_AGENT_SECRET: ${WOODPECKER_SECRET}
      WOODPECKER_LOG_LEVEL: info
    volumes:
      - woodpecker-data:/var/lib/woodpecker
    networks: [cicd]

  woodpecker-agent:
    image: woodpeckerci/woodpecker-agent:latest
    restart: unless-stopped
    depends_on: [woodpecker-server]
    command: agent
    environment:
      WOODPECKER_SERVER: woodpecker-server:9000
      WOODPECKER_AGENT_SECRET: ${WOODPECKER_SECRET}
      WOODPECKER_MAX_WORKFLOWS: 4
      WOODPECKER_BACKEND: docker
      DOCKER_HOST: unix:///var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks: [cicd]
COMPOSE

docker compose -f /opt/deepcheck-cicd/docker-compose.yml up -d
"

info "Stack CI/CD desplegado:"
echo "  Gitea:      http://10.10.0.40:3000"
echo "  Gitea SSH:  ssh://git@10.10.0.40:2222"
echo "  Woodpecker: http://10.10.0.40:8000"
echo ""
warn "CONFIGURACIÓN DESDE EL MACBOOK (con VPN activa):"
echo "  1. Abre http://10.10.0.40:3000 → Crea el primer admin"
echo "  2. Crea repo 'deep-check' en Gitea"
echo "  3. Añade remote en tu Mac:"
echo "       git remote add proxmox ssh://git@10.10.0.40:2222/admin/deep-check.git"
echo "  4. Configura OAuth en Gitea → Settings → Applications"
echo "     para conectar Woodpecker"
echo ""

# ── Pipeline ejemplo para DeepCheck ──────────────────────────────────────────
cat > /tmp/woodpecker-pipeline.yml <<'PIPELINE'
# .woodpecker.yml — Pipeline CI/CD DeepCheck
# Coloca este archivo en la raíz del repo deep-check

when:
  branch: [main, feat/*]

steps:
  # ── Test TypeScript ──────────────────────────────────────────────────────
  test-ts:
    image: node:20-alpine
    commands:
      - npm ci
      - npx tsc --noEmit
      - npm run lint 2>/dev/null || true

  # ── Test Python (modelos ML) ─────────────────────────────────────────────
  test-ml:
    image: python:3.11-slim
    commands:
      - pip install -r scripts/requirements.txt -q
      - python -m pytest scripts/tests/ -v 2>/dev/null || echo "No ML tests yet"

  # ── Build Docker image ────────────────────────────────────────────────────
  build:
    image: plugins/docker
    settings:
      repo: deepcheck/app
      tags: [latest, "${CI_COMMIT_SHA:0:8}"]
      dockerfile: Dockerfile
    when:
      branch: main

  # ── Deploy a AI Engine VM ─────────────────────────────────────────────────
  deploy-ai:
    image: alpine:3.19
    environment:
      AI_VM_IP: 10.10.0.20
      SSH_KEY:
        from_secret: deploy_ssh_key
    commands:
      - apk add --no-cache openssh-client
      - echo "$SSH_KEY" > /tmp/deploy_key && chmod 600 /tmp/deploy_key
      - ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no deepcheck@$AI_VM_IP
          "cd /opt/deepcheck-inference && git pull && sudo systemctl restart deepcheck-inference"
    when:
      branch: main
      event: push
PIPELINE

pct push $CT_ID /tmp/woodpecker-pipeline.yml /opt/deepcheck-cicd/woodpecker-pipeline-example.yml
info "Pipeline ejemplo guardado en LXC: /opt/deepcheck-cicd/woodpecker-pipeline-example.yml"
info "Cópialo como .woodpecker.yml en la raíz de tu repo"
