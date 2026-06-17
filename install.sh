#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deep-Check — Enterprise On-Premise Installer
# ─────────────────────────────────────────────────────────────────────────────
#
# Target: Universities, enterprises, regulated environments.
# Data sovereignty: all processing stays on your infrastructure.
#
# Usage:
#   sudo bash install.sh                # interactive, full install
#   sudo bash install.sh --unattended    # no prompts, use defaults
#   sudo bash install.sh --airgap        # offline install (expects bundle/)
#   sudo bash install.sh --no-gpu        # force CPU mode
#   sudo bash install.sh --domain ie.edu # set custom domain for TLS
#   sudo bash install.sh --uninstall     # remove everything
#
# What this script does:
#   1.  Detect OS (Ubuntu / Debian / RHEL / CentOS / macOS)
#   2.  Check system requirements (CPU, RAM, disk, kernel)
#   3.  Auto-install Docker + Compose v2 if missing
#   4.  Detect NVIDIA GPU and install nvidia-container-toolkit
#   5.  Open required firewall ports (ufw / firewalld)
#   6.  Generate self-signed TLS certificates (replaceable)
#   7.  Generate cryptographic secrets (DB, JWT, admin)
#   8.  Write .env and certificate files
#   9.  Pull or load Docker images (airgap mode loads from bundle/)
#   10. Download or verify ML models (airgap mode copies from bundle/)
#   11. Start the full stack (docker compose up -d)
#   12. Install systemd service for auto-start on boot
#   13. Wait for all services to become healthy
#   14. Run end-to-end health check (DB, REST, app, ml-worker)
#   15. Print access URLs, admin credentials, and runbook links
#
# Requirements:
#   - Linux x86_64 with kernel 5.4+ (Ubuntu 20.04+, Debian 11+, RHEL 8+)
#   - Root privileges (sudo)
#   - 16GB RAM minimum (32GB recommended)
#   - 100GB disk (500GB recommended)
#   - Optional: NVIDIA GPU with driver 535+ (T4, A10G, L4, L40S, A100)
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/install.log"
BUNDLE_DIR="${SCRIPT_DIR}/bundle"
CERTS_DIR="${SCRIPT_DIR}/docker/certs"
MODELS_DIR="${SCRIPT_DIR}/docker/models"
BACKUP_DIR="/var/backups/deep-check"

# Defaults (overridable via CLI flags)
UNATTENDED=0
AIRGAP=0
FORCE_CPU=0
DOMAIN="deep-check.local"
ORG_NAME="Deep-Check On-Premise"
SYSTEMD_INSTALL=1
UNINSTALL=0

# Requirements
MIN_RAM_GB=16
RECOMMENDED_RAM_GB=32
MIN_DISK_GB=50
RECOMMENDED_DISK_GB=500
MIN_CPU_CORES=8

# ═══════════════════════════════════════════════════════════════════════════
# Colours & logging
# ═══════════════════════════════════════════════════════════════════════════

if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' MAGENTA='' BOLD='' DIM='' NC=''
fi

mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
: > "${LOG_FILE}" 2>/dev/null || LOG_FILE=/dev/null

log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "${LOG_FILE}"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; log "OK: $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; log "WARN: $*"; }
err()   { echo -e "${RED}  ✗${NC} $*" >&2; log "ERR: $*"; }
info()  { echo -e "${CYAN}  →${NC} $*"; log "INFO: $*"; }
step()  { echo ""; echo -e "${BOLD}${MAGENTA}▸ $*${NC}"; log "STEP: $*"; }
die()   { err "$*"; echo ""; err "Install aborted. See ${LOG_FILE} for details."; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════
# CLI parsing
# ═══════════════════════════════════════════════════════════════════════════

show_help() {
    cat << EOF
Deep-Check Enterprise On-Premise Installer

Usage: sudo bash install.sh [OPTIONS]

Options:
  --unattended       Run without interactive prompts
  --airgap           Offline install (load images and models from bundle/)
  --no-gpu           Skip GPU detection, force CPU mode
  --no-systemd       Do not install systemd service for auto-start
  --domain DOMAIN    Custom domain for TLS certificate (default: deep-check.local)
  --org NAME         Organization name for certificate (default: "${ORG_NAME}")
  --uninstall        Remove Deep-Check (keeps data volumes)
  -h, --help         Show this help

Examples:
  sudo bash install.sh
  sudo bash install.sh --domain verify.ie.edu --org "IE University"
  sudo bash install.sh --unattended --no-gpu
  sudo bash install.sh --airgap --domain verify.ie.edu
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --unattended)  UNATTENDED=1; shift ;;
        --airgap)      AIRGAP=1; shift ;;
        --no-gpu)      FORCE_CPU=1; shift ;;
        --no-systemd)  SYSTEMD_INSTALL=0; shift ;;
        --domain)      DOMAIN="$2"; shift 2 ;;
        --org)         ORG_NAME="$2"; shift 2 ;;
        --uninstall)   UNINSTALL=1; shift ;;
        -h|--help)     show_help; exit 0 ;;
        *)             err "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# ═══════════════════════════════════════════════════════════════════════════
# Banner
# ═══════════════════════════════════════════════════════════════════════════

banner() {
    clear
    echo ""
    echo -e "${BOLD}${CYAN}  ██████╗ ███████╗███████╗██████╗      ██████╗██╗  ██╗███████╗ ██████╗██╗  ██╗${NC}"
    echo -e "${BOLD}${CYAN}  ██╔══██╗██╔════╝██╔════╝██╔══██╗    ██╔════╝██║  ██║██╔════╝██╔════╝██║ ██╔╝${NC}"
    echo -e "${BOLD}${CYAN}  ██║  ██║█████╗  █████╗  ██████╔╝    ██║     ███████║█████╗  ██║     █████╔╝ ${NC}"
    echo -e "${BOLD}${CYAN}  ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝     ██║     ██╔══██║██╔══╝  ██║     ██╔═██╗ ${NC}"
    echo -e "${BOLD}${CYAN}  ██████╔╝███████╗███████╗██║         ╚██████╗██║  ██║███████╗╚██████╗██║  ██╗${NC}"
    echo -e "${BOLD}${CYAN}  ╚═════╝ ╚══════╝╚══════╝╚═╝          ╚═════╝╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝${NC}"
    echo ""
    echo -e "  ${BOLD}Enterprise On-Premise Installer${NC}  ·  Identity & Document Verification"
    echo -e "  ${DIM}Full data sovereignty · GDPR · ISO 27001 ready · Air-gap capable${NC}"
    echo ""
    echo "───────────────────────────────────────────────────────────────────────────"
    echo ""
    [[ ${AIRGAP} -eq 1 ]]    && info "Mode: ${BOLD}AIR-GAP${NC} (offline install from bundle/)"
    [[ ${UNATTENDED} -eq 1 ]] && info "Mode: ${BOLD}UNATTENDED${NC} (no prompts)"
    [[ ${FORCE_CPU} -eq 1 ]]  && info "GPU:  ${BOLD}DISABLED${NC} (CPU fallback)"
    info "Domain: ${BOLD}${DOMAIN}${NC}"
    info "Org:    ${BOLD}${ORG_NAME}${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# Uninstall
# ═══════════════════════════════════════════════════════════════════════════

do_uninstall() {
    banner
    step "Uninstalling Deep-Check"
    warn "This will stop all containers and remove the systemd service."
    warn "Data volumes (database, models) will be KEPT."
    warn "To remove data too, run: docker volume rm \$(docker volume ls -q | grep deepcheck)"
    echo ""
    if [[ ${UNATTENDED} -ne 1 ]]; then
        read -r -p "  Continue? (yes/no): " confirm
        [[ "${confirm}" != "yes" ]] && { info "Cancelled."; exit 0; }
    fi
    if command -v docker &>/dev/null; then
        info "Stopping containers…"
        (cd "${SCRIPT_DIR}" && docker compose down 2>&1 | tee -a "${LOG_FILE}") || true
        ok "Containers stopped"
    fi
    if [[ -f /etc/systemd/system/deep-check.service ]]; then
        info "Removing systemd service…"
        systemctl disable --now deep-check.service 2>/dev/null || true
        rm -f /etc/systemd/system/deep-check.service
        systemctl daemon-reload
        ok "Systemd service removed"
    fi
    echo ""
    ok "Deep-Check uninstalled. Data volumes preserved."
    echo ""
    exit 0
}

[[ ${UNINSTALL} -eq 1 ]] && do_uninstall

# ═══════════════════════════════════════════════════════════════════════════
# 1. OS & privilege checks
# ═══════════════════════════════════════════════════════════════════════════

banner

step "1/14 · Environment detection"

OS=""
OS_VERSION=""
IS_MAC=0
PKG_MGR=""
if [[ "$(uname -s)" == "Darwin" ]]; then
    OS="macos"
    OS_VERSION="$(sw_vers -productVersion)"
    IS_MAC=1
    ok "OS: macOS ${OS_VERSION} (development only — not supported for production)"
    warn "macOS is not recommended for production. Use Linux for enterprise deployment."
elif [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS="${ID}"
    OS_VERSION="${VERSION_ID:-unknown}"
    case "${ID}" in
        ubuntu|debian) PKG_MGR="apt" ;;
        rhel|centos|rocky|almalinux|fedora) PKG_MGR="dnf" ;;
        *) PKG_MGR="unknown" ;;
    esac
    ok "OS: ${PRETTY_NAME:-${OS} ${OS_VERSION}} (pkg: ${PKG_MGR})"
else
    die "Cannot detect OS. This installer supports Ubuntu/Debian/RHEL/CentOS/macOS."
fi

# Root check (Linux only)
if [[ ${IS_MAC} -eq 0 && "$(id -u)" -ne 0 ]]; then
    die "This installer must be run as root. Use: sudo bash install.sh"
fi
ok "Running as $(id -un)"

# Architecture
ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" && "${ARCH}" != "amd64" && "${ARCH}" != "arm64" && "${ARCH}" != "aarch64" ]]; then
    die "Unsupported architecture: ${ARCH}. Supported: x86_64, arm64."
fi
ok "Architecture: ${ARCH}"

# ═══════════════════════════════════════════════════════════════════════════
# 2. Hardware checks
# ═══════════════════════════════════════════════════════════════════════════

step "2/14 · Hardware requirements"

# CPU cores
if [[ ${IS_MAC} -eq 1 ]]; then
    CPU_CORES=$(sysctl -n hw.ncpu)
else
    CPU_CORES=$(nproc 2>/dev/null || echo 1)
fi
if [[ ${CPU_CORES} -lt ${MIN_CPU_CORES} ]]; then
    warn "CPU cores: ${CPU_CORES} (minimum: ${MIN_CPU_CORES}). Performance will be degraded."
else
    ok "CPU cores: ${CPU_CORES}"
fi

# RAM
if [[ ${IS_MAC} -eq 1 ]]; then
    RAM_BYTES=$(sysctl -n hw.memsize)
    RAM_GB=$(( RAM_BYTES / 1024 / 1024 / 1024 ))
else
    RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
    RAM_GB=$(( RAM_KB / 1024 / 1024 ))
fi
if [[ ${RAM_GB} -lt ${MIN_RAM_GB} ]]; then
    warn "RAM: ${RAM_GB}GB (minimum: ${MIN_RAM_GB}GB). ML models may OOM."
    if [[ ${UNATTENDED} -ne 1 ]]; then
        read -r -p "  Continue anyway? (yes/no): " confirm
        [[ "${confirm}" != "yes" ]] && die "Aborted by user."
    fi
elif [[ ${RAM_GB} -lt ${RECOMMENDED_RAM_GB} ]]; then
    warn "RAM: ${RAM_GB}GB (recommended: ${RECOMMENDED_RAM_GB}GB)"
else
    ok "RAM: ${RAM_GB}GB"
fi

# Disk space
AVAIL_KB=$(df -k "${SCRIPT_DIR}" | tail -1 | awk '{print $4}')
AVAIL_GB=$(( AVAIL_KB / 1024 / 1024 ))
if [[ ${AVAIL_GB} -lt ${MIN_DISK_GB} ]]; then
    die "Disk space: ${AVAIL_GB}GB (minimum: ${MIN_DISK_GB}GB). Free up space first."
elif [[ ${AVAIL_GB} -lt ${RECOMMENDED_DISK_GB} ]]; then
    warn "Disk space: ${AVAIL_GB}GB (recommended: ${RECOMMENDED_DISK_GB}GB)"
else
    ok "Disk space: ${AVAIL_GB}GB"
fi

# Kernel version (Linux only)
if [[ ${IS_MAC} -eq 0 ]]; then
    KERNEL_VERSION="$(uname -r)"
    KERNEL_MAJOR="$(echo "${KERNEL_VERSION}" | cut -d. -f1)"
    KERNEL_MINOR="$(echo "${KERNEL_VERSION}" | cut -d. -f2)"
    if [[ ${KERNEL_MAJOR} -lt 5 ]] || { [[ ${KERNEL_MAJOR} -eq 5 ]] && [[ ${KERNEL_MINOR} -lt 4 ]]; }; then
        warn "Kernel ${KERNEL_VERSION} is old (recommended: 5.4+)"
    else
        ok "Kernel: ${KERNEL_VERSION}"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# 3. Docker installation
# ═══════════════════════════════════════════════════════════════════════════

step "3/14 · Docker Engine"

install_docker_ubuntu() {
    info "Installing Docker Engine via official apt repo…"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >> "${LOG_FILE}" 2>&1
    apt-get install -y -qq ca-certificates curl gnupg lsb-release >> "${LOG_FILE}" 2>&1
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>>"${LOG_FILE}"
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS} $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq >> "${LOG_FILE}" 2>&1
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >> "${LOG_FILE}" 2>&1
    systemctl enable --now docker >> "${LOG_FILE}" 2>&1
    ok "Docker installed"
}

install_docker_rhel() {
    info "Installing Docker Engine via official dnf repo…"
    dnf install -y -q dnf-plugins-core >> "${LOG_FILE}" 2>&1
    dnf config-manager --add-repo "https://download.docker.com/linux/${OS}/docker-ce.repo" >> "${LOG_FILE}" 2>&1
    dnf install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >> "${LOG_FILE}" 2>&1
    systemctl enable --now docker >> "${LOG_FILE}" 2>&1
    ok "Docker installed"
}

if command -v docker &>/dev/null; then
    DOCKER_VER="$(docker --version | awk '{print $3}' | tr -d ',')"
    ok "Docker found: ${DOCKER_VER}"
else
    warn "Docker not found."
    if [[ ${IS_MAC} -eq 1 ]]; then
        die "On macOS, install Docker Desktop manually: https://docs.docker.com/desktop/install/mac-install/"
    fi
    if [[ ${UNATTENDED} -ne 1 ]]; then
        read -r -p "  Install Docker automatically? (yes/no): " confirm
        [[ "${confirm}" != "yes" ]] && die "Docker is required."
    fi
    case "${PKG_MGR}" in
        apt) install_docker_ubuntu ;;
        dnf) install_docker_rhel ;;
        *)   die "Auto-install not supported for ${OS}. Install Docker manually." ;;
    esac
fi

# Docker Compose v2
if ! docker compose version &>/dev/null; then
    die "Docker Compose v2 plugin not available. Please install: https://docs.docker.com/compose/install/"
fi
ok "Docker Compose: $(docker compose version --short)"

# Docker daemon running
if ! docker info &>/dev/null; then
    die "Docker daemon is not running. Start it with: systemctl start docker"
fi
ok "Docker daemon is running"

# ═══════════════════════════════════════════════════════════════════════════
# 4. GPU detection & nvidia-container-toolkit
# ═══════════════════════════════════════════════════════════════════════════

step "4/14 · GPU detection"

GPU_AVAILABLE=0
GPU_INFO=""
if [[ ${FORCE_CPU} -eq 1 ]]; then
    info "GPU disabled via --no-gpu. Using CPU fallback."
elif [[ ${IS_MAC} -eq 1 ]]; then
    info "macOS: GPU support not available (CPU fallback)."
elif command -v nvidia-smi &>/dev/null; then
    if nvidia-smi &>/dev/null; then
        GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
        ok "NVIDIA GPU detected: ${GPU_INFO}"
        GPU_AVAILABLE=1

        # Check for nvidia-container-toolkit
        if docker info 2>/dev/null | grep -qi "nvidia"; then
            ok "nvidia-container-toolkit: installed"
        else
            warn "nvidia-container-toolkit not installed — installing…"
            if [[ "${PKG_MGR}" == "apt" ]]; then
                distribution=$(. /etc/os-release;echo "${ID}${VERSION_ID}")
                curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
                    gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>>"${LOG_FILE}" || true
                curl -fsSL "https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list" | \
                    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
                    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
                apt-get update -qq >> "${LOG_FILE}" 2>&1
                apt-get install -y -qq nvidia-container-toolkit >> "${LOG_FILE}" 2>&1 || warn "Install failed — continuing with CPU"
                nvidia-ctk runtime configure --runtime=docker >> "${LOG_FILE}" 2>&1 || true
                systemctl restart docker
                ok "nvidia-container-toolkit installed"
            elif [[ "${PKG_MGR}" == "dnf" ]]; then
                curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
                    -o /etc/yum.repos.d/nvidia-container-toolkit.repo 2>>"${LOG_FILE}"
                dnf install -y -q nvidia-container-toolkit >> "${LOG_FILE}" 2>&1 || warn "Install failed — continuing with CPU"
                nvidia-ctk runtime configure --runtime=docker >> "${LOG_FILE}" 2>&1 || true
                systemctl restart docker
                ok "nvidia-container-toolkit installed"
            else
                warn "Unknown package manager — install nvidia-container-toolkit manually if GPU is required."
            fi
        fi
    else
        warn "nvidia-smi found but failed to query. Running in CPU mode."
    fi
else
    info "No NVIDIA GPU detected. Running in CPU mode (slower but functional)."
fi

# ═══════════════════════════════════════════════════════════════════════════
# 5. Firewall & ports
# ═══════════════════════════════════════════════════════════════════════════

step "5/14 · Firewall configuration"

if [[ ${IS_MAC} -eq 0 ]]; then
    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
        info "UFW active — opening ports 80, 443…"
        ufw allow 80/tcp >> "${LOG_FILE}" 2>&1 || true
        ufw allow 443/tcp >> "${LOG_FILE}" 2>&1 || true
        ok "UFW rules applied"
    elif command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld 2>/dev/null; then
        info "firewalld active — opening ports 80, 443…"
        firewall-cmd --permanent --add-service=http >> "${LOG_FILE}" 2>&1 || true
        firewall-cmd --permanent --add-service=https >> "${LOG_FILE}" 2>&1 || true
        firewall-cmd --reload >> "${LOG_FILE}" 2>&1 || true
        ok "firewalld rules applied"
    else
        info "No active firewall detected. Skipping."
    fi
fi

# Port availability
for PORT in 80 443; do
    if command -v ss &>/dev/null; then
        if ss -tlnH "sport = :${PORT}" 2>/dev/null | grep -q LISTEN; then
            warn "Port ${PORT} is already in use. Stop the conflicting service or Deep-Check will fail to start."
        fi
    elif command -v lsof &>/dev/null; then
        if lsof -i ":${PORT}" -sTCP:LISTEN &>/dev/null; then
            warn "Port ${PORT} is already in use."
        fi
    fi
done
ok "Port check complete"

# ═══════════════════════════════════════════════════════════════════════════
# 6. TLS certificates
# ═══════════════════════════════════════════════════════════════════════════

step "6/14 · TLS certificates"

mkdir -p "${CERTS_DIR}"

if [[ -f "${CERTS_DIR}/fullchain.pem" && -f "${CERTS_DIR}/privkey.pem" ]]; then
    ok "Existing TLS certificate found at ${CERTS_DIR}"
    if openssl x509 -in "${CERTS_DIR}/fullchain.pem" -noout -checkend 2592000 &>/dev/null; then
        ok "Certificate is valid for at least 30 more days"
    else
        warn "Certificate expires within 30 days — consider renewing"
    fi
else
    info "Generating self-signed TLS certificate for ${DOMAIN}…"
    openssl req -x509 -nodes -newkey rsa:4096 \
        -keyout "${CERTS_DIR}/privkey.pem" \
        -out "${CERTS_DIR}/fullchain.pem" \
        -days 825 \
        -subj "/C=ES/O=${ORG_NAME}/CN=${DOMAIN}" \
        -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1" \
        >> "${LOG_FILE}" 2>&1
    chmod 600 "${CERTS_DIR}/privkey.pem"
    chmod 644 "${CERTS_DIR}/fullchain.pem"
    ok "Self-signed certificate generated (825 days)"
    warn "REPLACE with a CA-issued certificate before production. See docs/tls.md"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 7. Secret generation & .env
# ═══════════════════════════════════════════════════════════════════════════

step "7/14 · Secrets & environment"

if ! command -v openssl &>/dev/null; then
    die "openssl is required for secret generation."
fi

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    warn ".env already exists — keeping existing secrets."
    warn "Delete .env and re-run to regenerate (will invalidate existing sessions)."
else
    info "Generating cryptographic secrets…"

    DB_PASSWORD=$(openssl rand -hex 32)
    ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)
    PGRST_JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

    # Generate JWT tokens (HS256, 10-year expiry)
    b64url() { printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '=\n'; }
    make_jwt() {
        local role="$1"
        local exp_offset=315360000
        local header payload sig_input sig
        header=$(b64url '{"alg":"HS256","typ":"JWT"}')
        payload=$(b64url "{\"role\":\"${role}\",\"iss\":\"deep-check\",\"iat\":$(date +%s),\"exp\":$(( $(date +%s) + exp_offset ))}")
        sig_input="${header}.${payload}"
        sig=$(printf '%s' "${sig_input}" | openssl dgst -sha256 -hmac "${PGRST_JWT_SECRET}" -binary | base64 | tr '+/' '-_' | tr -d '=\n')
        printf '%s' "${sig_input}.${sig}"
    }

    PGRST_JWT_ANON_KEY=$(make_jwt "deepcheck_anon")
    PGRST_JWT_SERVICE_KEY=$(make_jwt "service_role")

    ok "Secrets generated"

    cat > "${SCRIPT_DIR}/.env" << ENVEOF
# Deep-Check On-Premise — generated by install.sh on $(date -u +"%Y-%m-%d %H:%M UTC")
# Host: $(hostname)
# Domain: ${DOMAIN}
# ─────────────────────────────────────────────────────────────────────────────
# WARNING: Keep this file secret. Never commit to version control.
# Recommended: chmod 600 .env
# ─────────────────────────────────────────────────────────────────────────────

# ── Database ────────────────────────────────────────────────────────────────
DB_USER=deepcheck
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=deepcheck

# ── PostgREST ───────────────────────────────────────────────────────────────
PGRST_JWT_SECRET=${PGRST_JWT_SECRET}
PGRST_JWT_ANON_KEY=${PGRST_JWT_ANON_KEY}
PGRST_JWT_SERVICE_KEY=${PGRST_JWT_SERVICE_KEY}

# ── Admin ───────────────────────────────────────────────────────────────────
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── ML Worker ───────────────────────────────────────────────────────────────
GPU_MODE=$([[ ${GPU_AVAILABLE} -eq 1 ]] && echo "auto" || echo "cpu")

# ── Model sync (empty = airgap, models must be in docker/models/) ───────────
S3_BUCKET=
S3_PREFIX=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=eu-west-1
MODEL_CHECK_INTERVAL=21600

# ── Deployment ──────────────────────────────────────────────────────────────
DEPLOY_MODE=onpremise
NODE_ENV=production
DOMAIN=${DOMAIN}
ENVEOF

    chmod 600 "${SCRIPT_DIR}/.env"
    ok ".env written (chmod 600)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 8. Air-gap bundle handling
# ═══════════════════════════════════════════════════════════════════════════

step "8/14 · Image & model provisioning"

if [[ ${AIRGAP} -eq 1 ]]; then
    if [[ ! -d "${BUNDLE_DIR}" ]]; then
        die "Air-gap mode: bundle/ directory not found. Expected: ${BUNDLE_DIR}"
    fi

    # Load docker images
    if [[ -f "${BUNDLE_DIR}/images.tar.gz" ]]; then
        info "Loading Docker images from bundle…"
        gunzip -c "${BUNDLE_DIR}/images.tar.gz" | docker load >> "${LOG_FILE}" 2>&1
        ok "Docker images loaded"
    elif [[ -f "${BUNDLE_DIR}/images.tar" ]]; then
        info "Loading Docker images from bundle…"
        docker load -i "${BUNDLE_DIR}/images.tar" >> "${LOG_FILE}" 2>&1
        ok "Docker images loaded"
    else
        warn "No images.tar(.gz) in bundle/. Will try to build from local context."
    fi

    # Copy models
    mkdir -p "${MODELS_DIR}"
    if [[ -d "${BUNDLE_DIR}/models" ]]; then
        info "Copying ML models from bundle…"
        cp -r "${BUNDLE_DIR}/models/"* "${MODELS_DIR}/"
        ok "Models copied ($(du -sh "${MODELS_DIR}" | awk '{print $1}'))"
    fi

    # Verify model checksums if manifest exists
    if [[ -f "${BUNDLE_DIR}/models.sha256" ]]; then
        info "Verifying model checksums…"
        (cd "${BUNDLE_DIR}" && sha256sum -c models.sha256 >> "${LOG_FILE}" 2>&1) && ok "Checksums OK" || die "Checksum verification failed."
    fi
else
    info "Pulling Docker images (online mode)…"
    (cd "${SCRIPT_DIR}" && docker compose pull --quiet 2>&1 | tee -a "${LOG_FILE}") || warn "Pull failed for some images — will build locally."
    ok "Images ready"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 9. Backup directory
# ═══════════════════════════════════════════════════════════════════════════

step "9/14 · Backup directory"

if [[ ${IS_MAC} -eq 0 ]]; then
    mkdir -p "${BACKUP_DIR}"
    chmod 700 "${BACKUP_DIR}"
    ok "Backup directory: ${BACKUP_DIR}"
else
    ok "Skipped (macOS)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 10. Start stack
# ═══════════════════════════════════════════════════════════════════════════

step "10/14 · Starting Deep-Check stack"

info "Building and starting containers (this may take a few minutes)…"
echo ""
(cd "${SCRIPT_DIR}" && docker compose up -d --build 2>&1 | tee -a "${LOG_FILE}") || die "docker compose up failed. See ${LOG_FILE}"
echo ""
ok "Stack started"

# ═══════════════════════════════════════════════════════════════════════════
# 11. systemd service (auto-start on boot)
# ═══════════════════════════════════════════════════════════════════════════

step "11/14 · systemd auto-start"

if [[ ${IS_MAC} -eq 0 && ${SYSTEMD_INSTALL} -eq 1 ]]; then
    if command -v systemctl &>/dev/null; then
        cat > /etc/systemd/system/deep-check.service << SVCEOF
[Unit]
Description=Deep-Check On-Premise Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF
        systemctl daemon-reload
        systemctl enable deep-check.service >> "${LOG_FILE}" 2>&1
        ok "systemd service installed and enabled"
        ok "Stack will auto-start on boot"
    else
        warn "systemctl not found — skipping systemd install"
    fi
else
    info "Skipped (macOS or --no-systemd)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 12. Wait for health
# ═══════════════════════════════════════════════════════════════════════════

step "12/14 · Waiting for services to become healthy"

wait_for() {
    local name="$1" check="$2" max="${3:-120}" waited=0
    printf "  ${CYAN}→${NC} %-25s " "${name}"
    while ! eval "${check}" &>/dev/null; do
        if [[ ${waited} -ge ${max} ]]; then
            echo -e "${RED}TIMEOUT${NC}"
            return 1
        fi
        printf "."
        sleep 3
        waited=$(( waited + 3 ))
    done
    echo -e " ${GREEN}OK${NC} (${waited}s)"
    return 0
}

HEALTH_OK=1
wait_for "Database"    "docker compose -f '${SCRIPT_DIR}/docker-compose.yml' exec -T db pg_isready -U deepcheck -q" 60 || HEALTH_OK=0
wait_for "PostgREST"   "curl -sf http://127.0.0.1:3001/ -o /dev/null"                                                30 || HEALTH_OK=0
wait_for "Next.js app" "curl -sf http://127.0.0.1:3000/ -o /dev/null"                                                60 || HEALTH_OK=0
wait_for "ML Worker"   "curl -sf http://127.0.0.1:8001/health -o /dev/null"                                         180 || HEALTH_OK=0

# ═══════════════════════════════════════════════════════════════════════════
# 13. End-to-end verification
# ═══════════════════════════════════════════════════════════════════════════

step "13/14 · End-to-end verification"

# ML Worker health details
if curl -sf http://127.0.0.1:8001/health &>/dev/null; then
    HEALTH_JSON=$(curl -s http://127.0.0.1:8001/health)
    ok "ML Worker health: $(echo "${HEALTH_JSON}" | head -c 120)…"
else
    warn "ML Worker not healthy — check: docker compose logs ml-worker"
    HEALTH_OK=0
fi

# Models loaded
if curl -sf http://127.0.0.1:8001/models/status &>/dev/null; then
    ok "Model status endpoint reachable"
else
    warn "Model status endpoint unreachable"
fi

# Nginx TLS
if curl -sk https://127.0.0.1/ -o /dev/null &>/dev/null; then
    ok "Nginx TLS endpoint responding"
else
    warn "Nginx TLS endpoint not responding"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 14. Summary & credentials
# ═══════════════════════════════════════════════════════════════════════════

step "14/14 · Installation summary"

ADMIN_PW=$(grep '^ADMIN_PASSWORD=' "${SCRIPT_DIR}/.env" | cut -d= -f2-)

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
if [[ ${HEALTH_OK} -eq 1 ]]; then
    echo -e "${GREEN}${BOLD}  ✅  DEEP-CHECK IS RUNNING${NC}"
else
    echo -e "${YELLOW}${BOLD}  ⚠  DEEP-CHECK STARTED WITH WARNINGS${NC}"
    echo -e "     ${DIM}Check ${LOG_FILE} and 'docker compose logs' for details.${NC}"
fi
echo ""
echo -e "  ${BOLD}Access URLs${NC}"
echo -e "    HTTPS:     https://${DOMAIN}/   ${DIM}(self-signed cert → browser warning)${NC}"
echo -e "    HTTP:      http://${DOMAIN}/    ${DIM}(redirects to HTTPS)${NC}"
echo -e "    Local:     http://127.0.0.1/"
echo -e "    Dashboard: https://${DOMAIN}/dashboard"
echo -e "    Verify:    https://${DOMAIN}/verify-demo"
echo ""
echo -e "  ${BOLD}Internal Endpoints (localhost only)${NC}"
echo -e "    App:       http://127.0.0.1:3000"
echo -e "    PostgREST: http://127.0.0.1:3001"
echo -e "    ML Worker: http://127.0.0.1:8001/health"
echo -e "    Postgres:  127.0.0.1:5432"
echo ""
echo -e "  ${BOLD}Admin Credentials${NC}"
echo -e "    Username:  admin"
echo -e "    Password:  ${YELLOW}${ADMIN_PW}${NC}"
echo -e "    ${DIM}Change at first login: https://${DOMAIN}/dashboard/settings${NC}"
echo ""
echo -e "  ${BOLD}GPU${NC}"
if [[ ${GPU_AVAILABLE} -eq 1 ]]; then
    echo -e "    ${GREEN}Enabled${NC}  ${DIM}${GPU_INFO}${NC}"
else
    echo -e "    ${YELLOW}CPU mode${NC}  ${DIM}(slower but functional)${NC}"
fi
echo ""
echo -e "  ${BOLD}Operations${NC}"
echo -e "    Logs:      docker compose logs -f [service]"
echo -e "    Restart:   systemctl restart deep-check   ${DIM}(or: docker compose restart)${NC}"
echo -e "    Stop:      systemctl stop deep-check      ${DIM}(or: docker compose down)${NC}"
echo -e "    Status:    docker compose ps"
echo -e "    Backup:    ${BACKUP_DIR}/"
echo -e "    Uninstall: sudo bash install.sh --uninstall"
echo ""
echo -e "  ${BOLD}Next Steps${NC}"
echo -e "    1. Add ${DOMAIN} to your DNS or /etc/hosts"
echo -e "    2. Replace TLS certs with a CA-issued certificate (see docs/tls.md)"
echo -e "    3. Configure SAML/LDAP SSO (see docs/sso.md)"
echo -e "    4. Set up backup cron job (see docs/backup.md)"
echo -e "    5. Review audit logs: https://${DOMAIN}/dashboard/audit"
echo ""
echo -e "  ${BOLD}Security${NC}"
echo -e "    • All biometric processing runs client-side — no face data stored"
echo -e "    • Audit logs are tamper-evident via SHA-256 chain"
echo -e "    • GDPR / ISO 27001 ready · Data never leaves your infrastructure"
echo -e "    • Save ${SCRIPT_DIR}/.env securely and restrict access (chmod 600)"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo -e "  ${DIM}Install log: ${LOG_FILE}${NC}"
echo -e "  ${DIM}Support: support@deep-check.io${NC}"
echo ""

exit 0
