#!/usr/bin/env bash
# ============================================================
# DeepCheck · VM 100 — Windows 11 (WSL2 + Dev Tools)
#
# Función: Entorno Windows con WSL2 para desarrollo y
#          herramientas que requieren Windows.
#
# Recursos: 8GB RAM · 4 vCPU · 150GB disco · RDP
# Ejecutar en: Proxmox host como root
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

VM_ID=100
VM_NAME="deepcheck-windows"
STORAGE="local-zfs"       # Ajustar al nombre del storage Proxmox (pvesm status)
RAM_MB=8192
CORES=4
DISK_GB=150
WIN_ISO_PATH="/var/lib/vz/template/iso/Win11_24H2_Spanish_x64.iso"
VIRTIO_ISO="/var/lib/vz/template/iso/virtio-win.iso"

# ── Verificar que el VM ID no existe ──────────────────────────────────────────
if qm status $VM_ID &>/dev/null; then
    echo "VM $VM_ID ya existe. Usa: qm destroy $VM_ID --purge"
    exit 1
fi

# ── Verificar ISOs ────────────────────────────────────────────────────────────
if [[ ! -f "$WIN_ISO_PATH" ]]; then
    warn "ISO Windows no encontrada en $WIN_ISO_PATH"
    warn "Descárgala desde: https://www.microsoft.com/es-es/software-download/windows11"
    warn "Colócala en /var/lib/vz/template/iso/ y vuelve a ejecutar"
    echo ""
    warn "VirtIO drivers (obligatorios para rendimiento):"
    warn "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
    exit 1
fi

info "Creando VM $VM_ID ($VM_NAME)..."

# ── Crear VM ──────────────────────────────────────────────────────────────────
qm create $VM_ID \
    --name "$VM_NAME" \
    --memory $RAM_MB \
    --balloon 4096 \
    --cores $CORES \
    --sockets 1 \
    --cpu host \
    --numa 1 \
    --ostype win11 \
    --machine q35 \
    --bios ovmf \
    --efidisk0 ${STORAGE}:1,format=raw,efitype=4m,pre-enrolled-keys=1 \
    --net0 virtio,bridge=vmbr1,firewall=1 \
    --vga std \
    --audio0 device=ich9-intel-hda,driver=spice \
    --usb0 host=spice \
    --tablet 1 \
    --onboot 1 \
    --startup order=2,up=30 \
    --description "Windows 11 con WSL2 para desarrollo DeepCheck. IP: 10.10.0.10"

# ── Disco principal (VirtIO SCSI para máximo rendimiento) ─────────────────────
qm set $VM_ID --scsi0 ${STORAGE}:${DISK_GB},cache=writeback,discard=on,format=raw
qm set $VM_ID --scsihw virtio-scsi-pci

# ── ISOs de instalación ────────────────────────────────────────────────────────
qm set $VM_ID --cdrom "$WIN_ISO_PATH"
if [[ -f "$VIRTIO_ISO" ]]; then
    qm set $VM_ID --ide2 "$VIRTIO_ISO",media=cdrom
fi

# ── Boot order: DVD primero para instalación ──────────────────────────────────
qm set $VM_ID --boot order="cdrom;scsi0"

# ── TPM 2.0 (requerido Windows 11) ────────────────────────────────────────────
qm set $VM_ID --tpmstate0 ${STORAGE}:4,version=v2.0

# ── Cloud-init / Guest Agent ──────────────────────────────────────────────────
# qemu-guest-agent se instala después desde Windows

info "VM $VM_ID creada. IP configurada: 10.10.0.10 (estática, configurar en Windows)"
echo ""
warn "PASOS POST-INSTALACIÓN WINDOWS:"
echo "  1. Iniciar VM y completar instalación de Windows"
echo "  2. Instalar VirtIO drivers desde la segunda ISO"
echo "  3. Instalar QEMU Guest Agent:"
echo "       virtio-win-gt-x64.msi"
echo "  4. Configurar IP estática en Windows:"
echo "       IP: 10.10.0.10 / Mask: 255.255.255.0 / GW: 10.10.0.1"
echo "  5. Habilitar RDP (Configuración → Sistema → Escritorio Remoto)"
echo "  6. Instalar WSL2:"
echo "       wsl --install"
echo "  7. Desde el MacBook con VPN activa:"
echo "       open rdp://10.10.0.10  (o usar Microsoft Remote Desktop)"
echo ""

# ── Script de instalación post-Windows (para correr dentro de la VM) ─────────
cat > /root/windows-post-install.ps1 <<'PSEOF'
# PowerShell — correr como Administrador dentro de la VM Windows
# Instalación de WSL2 y herramientas de desarrollo DeepCheck

# Habilitar WSL2
wsl --install
wsl --set-default-version 2
wsl --install -d Ubuntu-24.04

# Instalar winget apps
$apps = @(
    "Microsoft.VisualStudioCode",
    "Git.Git",
    "Docker.DockerDesktop",
    "GitHub.cli",
    "Python.Python.3.12",
    "OpenJS.NodeJS.LTS"
)
foreach ($app in $apps) {
    winget install --id $app --silent --accept-package-agreements --accept-source-agreements
}

# Configurar IP estática
netsh interface ip set address "Ethernet" static 10.10.0.10 255.255.255.0 10.10.0.1
netsh interface ip set dns "Ethernet" static 1.1.1.1
netsh interface ip add dns "Ethernet" 8.8.8.8 index=2

# Habilitar RDP
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -name "fDenyTSConnections" -value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"

# Habilitar QEMU Guest Agent autostart
Set-Service -Name "QEMU-GA" -StartupType Automatic
Start-Service "QEMU-GA"

Write-Host "[OK] Windows configurado para DeepCheck" -ForegroundColor Green
PSEOF

info "Script PowerShell post-instalación guardado en: /root/windows-post-install.ps1"
info "Cópialo a la VM Windows y ejecútalo como Administrador"
