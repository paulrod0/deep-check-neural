#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deep-Check On-Premise Installer
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage (one-liner):
#   curl -fsSL https://deep-check.io/install.sh | bash
#
# Or clone the repo and run:
#   bash install.sh
#
# What this script does:
#   1. Checks prerequisites (Docker, Docker Compose v2, ports, disk space)
#   2. Generates cryptographic secrets (DB password, JWT tokens, admin password)
#   3. Writes .env automatically — no manual editing required
#   4. Starts the Docker Compose stack
#   5. Waits for the database to be healthy
#   6. Prints the access URL and admin credentials
#
# Requirements:
#   - Docker Engine 24+ (with Docker Compose v2 plugin)
#   - Linux / macOS (or WSL2 on Windows)
#   - Ports 80 and 443 available
#   - At least 2 GB of free disk space
#   - openssl (standard on macOS/Linux)
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'   # No Colour

ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠ ${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*"; }
info() { echo -e "${CYAN}  →${NC} $*"; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}  ██████╗ ███████╗███████╗██████╗      ██████╗██╗  ██╗███████╗ ██████╗██╗  ██╗${NC}"
echo -e "${BOLD}${CYAN}  ██╔══██╗██╔════╝██╔════╝██╔══██╗    ██╔════╝██║  ██║██╔════╝██╔════╝██║ ██╔╝${NC}"
echo -e "${BOLD}${CYAN}  ██║  ██║█████╗  █████╗  ██████╔╝    ██║     ███████║█████╗  ██║     █████╔╝ ${NC}"
echo -e "${BOLD}${CYAN}  ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝     ██║     ██╔══██║██╔══╝  ██║     ██╔═██╗ ${NC}"
echo -e "${BOLD}${CYAN}  ██████╔╝███████╗███████╗██║         ╚██████╗██║  ██║███████╗╚██████╗██║  ██╗${NC}"
echo -e "${BOLD}${CYAN}  ╚═════╝ ╚══════╝╚══════╝╚═╝          ╚═════╝╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝${NC}"
echo ""
echo -e "${BOLD}  On-Premise Installer${NC}  ·  Identity Verification Platform"
echo -e "  ${CYAN}https://deep-check.io${NC}  ·  Full data sovereignty"
echo ""
echo "─────────────────────────────────────────────────────────────────────────────"
echo ""

# ── 1. Pre-flight checks ──────────────────────────────────────────────────────

info "Running pre-flight checks…"

# Docker
if ! command -v docker &>/dev/null; then
  err "Docker is not installed."
  echo "     Install Docker from: https://docs.docker.com/get-docker/"
  exit 1
fi
ok "Docker found: $(docker --version | head -1)"

# Docker Compose v2
if ! docker compose version &>/dev/null 2>&1; then
  err "Docker Compose v2 plugin is required (docker compose, not docker-compose)."
  echo "     Install: https://docs.docker.com/compose/install/"
  exit 1
fi
ok "Docker Compose found: $(docker compose version --short)"

# openssl
if ! command -v openssl &>/dev/null; then
  err "openssl is required for secret generation."
  exit 1
fi
ok "openssl found"

# Disk space — require at least 2 GB free
AVAIL_KB=$(df -k . | tail -1 | awk '{print $4}')
AVAIL_GB=$(( AVAIL_KB / 1048576 ))
if [ "${AVAIL_GB}" -lt 2 ]; then
  warn "Less than 2 GB of free disk space (${AVAIL_GB} GB available). Consider freeing space."
else
  ok "Disk space: ${AVAIL_GB} GB available"
fi

# Port check
for PORT in 80 443; do
  if command -v lsof &>/dev/null && lsof -i ":${PORT}" -sTCP:LISTEN &>/dev/null 2>&1; then
    warn "Port ${PORT} is in use. Stop the conflicting service or edit nginx.conf to use a different port."
  fi
done

echo ""

# ── 2. Check for existing .env ────────────────────────────────────────────────

if [ -f ".env" ]; then
  warn ".env already exists — skipping secret generation."
  warn "Delete .env and re-run to generate fresh secrets."
  echo ""
else

  # ── 3. Generate secrets ──────────────────────────────────────────────────────

  info "Generating cryptographic secrets…"

  DB_PASSWORD=$(openssl rand -hex 32)
  ok "Database password generated"

  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
  ok "Admin password generated"

  # JWT secret (64 bytes)
  PGRST_JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
  ok "JWT secret generated"

  # Generate PostgREST JWT tokens (same algorithm as docker/generate-jwt.sh)
  b64url() {
    printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '='
  }

  make_jwt() {
    local role="$1"
    local exp_offset=315360000  # 10 years
    local header
    header=$(b64url '{"alg":"HS256","typ":"JWT"}')
    local exp
    exp=$(( $(date +%s) + exp_offset ))
    local payload
    payload=$(b64url "{\"role\":\"${role}\",\"iss\":\"deep-check\",\"iat\":$(date +%s),\"exp\":${exp}}")
    local sig_input="${header}.${payload}"
    local sig
    sig=$(printf '%s' "${sig_input}" | \
      openssl dgst -sha256 -hmac "${PGRST_JWT_SECRET}" -binary | \
      base64 | tr '+/' '-_' | tr -d '=')
    printf '%s' "${sig_input}.${sig}"
  }

  PGRST_JWT_ANON_KEY=$(make_jwt "deepcheck_anon")
  PGRST_JWT_SERVICE_KEY=$(make_jwt "service_role")
  ok "PostgREST JWT tokens generated"

  # ── 4. Write .env ────────────────────────────────────────────────────────────

  cat > .env << ENVEOF
# Deep-Check On-Premise — generated by install.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# ─────────────────────────────────────────────────────────────────────────────
# WARNING: Keep this file secret. Never commit it to version control.
# ─────────────────────────────────────────────────────────────────────────────

# ── Database ──────────────────────────────────────────────────────────────────
DB_USER=deepcheck
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=deepcheck

# ── PostgREST (Supabase-compatible REST layer) ────────────────────────────────
PGRST_JWT_SECRET=${PGRST_JWT_SECRET}
PGRST_JWT_ANON_KEY=${PGRST_JWT_ANON_KEY}
PGRST_JWT_SERVICE_KEY=${PGRST_JWT_SERVICE_KEY}

# ── Admin Dashboard ───────────────────────────────────────────────────────────
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── ML Lambda (optional — leave empty for client-side ONNX inference) ─────────
LSTM_LAMBDA_URL=
LSTM_LAMBDA_SECRET=

# ── On-premise mode ───────────────────────────────────────────────────────────
DEPLOY_MODE=onpremise
NODE_ENV=production
ENVEOF

  ok ".env written"
  echo ""
fi

# ── 5. Start stack ────────────────────────────────────────────────────────────

info "Pulling images and building containers…"
echo ""
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build

echo ""
info "Waiting for database to be healthy…"

MAX_WAIT=60
WAITED=0
while ! docker compose exec -T db pg_isready -U deepcheck -q 2>/dev/null; do
  if [ "${WAITED}" -ge "${MAX_WAIT}" ]; then
    err "Database did not become healthy within ${MAX_WAIT}s."
    echo "     Check logs with: docker compose logs db"
    exit 1
  fi
  printf "."
  sleep 2
  WAITED=$(( WAITED + 2 ))
done
echo ""
ok "Database is healthy"

# ── 6. Done ───────────────────────────────────────────────────────────────────

# Re-read admin password from .env in case we skipped generation
ADMIN_PW=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)

echo ""
echo "─────────────────────────────────────────────────────────────────────────────"
echo ""
echo -e "${GREEN}${BOLD}  ✅ Deep-Check is running!${NC}"
echo ""
echo -e "  ${BOLD}URL:${NC}            http://localhost"
echo -e "  ${BOLD}Dashboard:${NC}      http://localhost/dashboard"
echo -e "  ${BOLD}Documents:${NC}      http://localhost/documents"
echo -e "  ${BOLD}KYC Verify:${NC}     http://localhost/documents/verify"
echo ""
echo -e "  ${BOLD}Admin password:${NC} ${YELLOW}${ADMIN_PW}${NC}"
echo ""
echo -e "  ${CYAN}Change your password after first login:${NC}"
echo -e "  http://localhost/dashboard/settings"
echo ""
echo "  Logs:    docker compose logs -f app"
echo "  Stop:    docker compose down"
echo "  Restart: docker compose restart"
echo ""
echo "─────────────────────────────────────────────────────────────────────────────"
echo ""
echo -e "  ${BOLD}Security note:${NC} All biometric processing runs in the browser."
echo -e "  No face data, voice data, or biometric templates are stored."
echo -e "  Audit logs are tamper-evident via SHA-256 chain."
echo ""
