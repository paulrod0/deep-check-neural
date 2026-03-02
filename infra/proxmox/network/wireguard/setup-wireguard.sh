#!/usr/bin/env bash
# ============================================================
# DeepCheck · WireGuard VPN Setup
# Acceso seguro al panel Proxmox desde el MacBook M5
#
# Topología:
#   Proxmox (servidor)  → 10.10.100.1
#   MacBook Pro M5      → 10.10.100.2
#
# Ejecutar en: Proxmox host como root
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

SERVER_IP="10.10.100.1"
CLIENT_IP="10.10.100.2"
VPN_PORT="51820"
VPN_SUBNET="10.10.100.0/24"

# IP pública del servidor Proxmox (se detecta automáticamente)
PUBLIC_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

# ── 1. Generar claves del servidor ────────────────────────────────────────────
info "Generating WireGuard server keys..."
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard

wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
chmod 600 /etc/wireguard/server_private.key

SERVER_PRIVATE=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)

# ── 2. Generar claves del cliente (MacBook) ───────────────────────────────────
info "Generating MacBook client keys..."
wg genkey | tee /etc/wireguard/macbook_private.key | wg pubkey > /etc/wireguard/macbook_public.key
chmod 600 /etc/wireguard/macbook_private.key

MACBOOK_PRIVATE=$(cat /etc/wireguard/macbook_private.key)
MACBOOK_PUBLIC=$(cat /etc/wireguard/macbook_public.key)

# ── 3. Configuración del servidor (wg0) ───────────────────────────────────────
info "Creating server config /etc/wireguard/wg0.conf..."
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address    = ${SERVER_IP}/24
ListenPort = ${VPN_PORT}
PrivateKey = ${SERVER_PRIVATE}

# Habilitar routing para que el MacBook acceda a las VMs internas
PostUp   = iptables -A FORWARD -i wg0 -j ACCEPT
PostUp   = iptables -A FORWARD -o wg0 -j ACCEPT
PostUp   = iptables -t nat -A POSTROUTING -s ${VPN_SUBNET} -o vmbr0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -s ${VPN_SUBNET} -o vmbr0 -j MASQUERADE

# ── MacBook Pro M5 ────────────────────────────────────────────
[Peer]
PublicKey  = ${MACBOOK_PUBLIC}
AllowedIPs = ${CLIENT_IP}/32
EOF
chmod 600 /etc/wireguard/wg0.conf

# ── 4. Activar y habilitar WireGuard ──────────────────────────────────────────
info "Enabling WireGuard service..."
systemctl enable --now wg-quick@wg0

# ── 5. Generar config para el MacBook ─────────────────────────────────────────
info "Generating MacBook client config..."
cat > /etc/wireguard/macbook-deepcheck.conf <<EOF
[Interface]
# IP del MacBook en la VPN
Address    = ${CLIENT_IP}/24
PrivateKey = ${MACBOOK_PRIVATE}
DNS        = 1.1.1.1

[Peer]
# Proxmox server
PublicKey  = ${SERVER_PUBLIC}
Endpoint   = ${PUBLIC_IP}:${VPN_PORT}
# Enrutar SOLO el tráfico de la VPN por el túnel (split tunnel)
# 10.10.0.0/24 = VMs internas, 10.10.100.0/24 = VPN subnet
AllowedIPs = 10.10.0.0/24, 10.10.100.0/24
PersistentKeepalive = 25
EOF

# ── 6. Generar QR para el MacBook (si hay herramienta) ────────────────────────
if command -v qrencode &>/dev/null; then
    info "QR code para importar en iPhone/iPad (WireGuard app):"
    qrencode -t ansiutf8 < /etc/wireguard/macbook-deepcheck.conf
fi

# ── 7. Output resumen ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  WireGuard VPN configurado correctamente${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Servidor VPN:  ${SERVER_IP} (Proxmox)"
echo "  Cliente:       ${CLIENT_IP} (MacBook)"
echo "  Puerto:        UDP ${VPN_PORT}"
echo "  IP pública:    ${PUBLIC_IP}"
echo ""
warn "PASO SIGUIENTE — En tu MacBook Pro M5:"
echo ""
echo "  1. Instala WireGuard: brew install wireguard-tools"
echo "     O descarga la app de la Mac App Store"
echo ""
echo "  2. Copia el archivo de config al MacBook:"
echo "       scp root@${PUBLIC_IP}:/etc/wireguard/macbook-deepcheck.conf ~/Desktop/"
echo ""
echo "  3. Importa en WireGuard:"
echo "       sudo wg-quick up ~/Desktop/macbook-deepcheck.conf"
echo ""
echo "  4. Accede a Proxmox desde el MacBook:"
echo "       https://10.10.100.1:8006"
echo ""
echo -e "${YELLOW}  El config del MacBook está en:${NC}"
echo "       /etc/wireguard/macbook-deepcheck.conf"
echo ""
