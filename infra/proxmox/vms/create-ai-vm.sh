#!/usr/bin/env bash
# ============================================================
# DeepCheck · VM 200 — Motor de IA (GPU Passthrough)
#
# Función: Inferencia BiLSTM + XGBoost + IsoForest
#          Quadro M4000 vía PCIe passthrough completo
#
# Recursos: 8GB RAM · 4 vCPU · Quadro M4000 (8GB VRAM) · 80GB
# IP: 10.10.0.20
# Ejecutar en: Proxmox host como root
#
# Uso: ./create-ai-vm.sh [PCI_ADDRESS] [PCI_ID]
#      Ejemplo: ./create-ai-vm.sh 01:00.0 10de:13f0
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
abort() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Args: PCI address y Vendor:Device ID de la Quadro M4000 ──────────────────
GPU_PCI_ADDR="${1:-01:00.0}"          # Ajustar con output de detect-gpu-pci.sh
GPU_PCI_ID="${2:-10de:13f0}"          # Quadro M4000 typical ID

VM_ID=200
VM_NAME="deepcheck-ai-engine"
STORAGE="local-zfs"
RAM_MB=8192
CORES=4
DISK_GB=80
UBUNTU_ISO="/var/lib/vz/template/iso/ubuntu-22.04-server-amd64.iso"

# ── Verificar IOMMU ───────────────────────────────────────────────────────────
if ! dmesg | grep -q "IOMMU enabled"; then
    abort "IOMMU no está activo. Ejecuta post-install.sh y reinicia primero."
fi

# ── Verificar ISO ─────────────────────────────────────────────────────────────
if [[ ! -f "$UBUNTU_ISO" ]]; then
    warn "Descargando Ubuntu 22.04 Server..."
    wget -P /var/lib/vz/template/iso/ \
        "https://releases.ubuntu.com/22.04/ubuntu-22.04.5-live-server-amd64.iso" \
        -O "$UBUNTU_ISO" || abort "Descarga fallida — descarga manualmente"
fi

# ── Configurar VFIO para la GPU ───────────────────────────────────────────────
info "Configurando VFIO para GPU $GPU_PCI_ID..."
cat > /etc/modprobe.d/vfio-deepcheck.conf <<EOF
# Bind Quadro M4000 al driver VFIO para passthrough
options vfio-pci ids=${GPU_PCI_ID}
EOF
update-initramfs -u -k all

# ── Crear VM ──────────────────────────────────────────────────────────────────
info "Creando VM $VM_ID ($VM_NAME) con GPU passthrough..."

qm create $VM_ID \
    --name "$VM_NAME" \
    --memory $RAM_MB \
    --cores $CORES \
    --sockets 1 \
    --cpu host \
    --numa 1 \
    --machine q35 \
    --ostype l26 \
    --net0 virtio,bridge=vmbr1,firewall=1 \
    --vga none \
    --onboot 1 \
    --startup order=3,up=60 \
    --description "Motor IA DeepCheck: BiLSTM + XGBoost. GPU: Quadro M4000. IP: 10.10.0.20"

# ── Disco ─────────────────────────────────────────────────────────────────────
qm set $VM_ID --scsi0 ${STORAGE}:${DISK_GB},cache=writeback,discard=on,format=raw
qm set $VM_ID --scsihw virtio-scsi-pci

# ── ISO instalación ───────────────────────────────────────────────────────────
qm set $VM_ID --cdrom "$UBUNTU_ISO"
qm set $VM_ID --boot order="cdrom;scsi0"

# ── PCIe Passthrough: Quadro M4000 ────────────────────────────────────────────
# x-vga=on: la GPU actúa como VGA principal (necesario para NVIDIA)
# rombar=0: deshabilitar ROM bar (evita conflictos en algunos sistemas)
qm set $VM_ID \
    --hostpci0 ${GPU_PCI_ADDR},pcie=1,x-vga=on,rombar=0 \
    --args "-cpu host,kvm=off,hv_vendor_id=proxmox"

# kvm=off + hv_vendor_id: workaround para Error 43 de drivers NVIDIA

info "VM $VM_ID creada con GPU passthrough"
echo ""
warn "PASOS POST-INSTALACIÓN (dentro de la VM):"
echo ""
echo "  1. Instalar Ubuntu 22.04 (IP estática: 10.10.0.20)"
echo "  2. Ejecutar como root:"
echo "       curl -sSL https://raw.githubusercontent.com/paulrod0/deep-check/main/infra/proxmox/vms/setup-ai-vm.sh | bash"
echo ""
echo "  O copia manualmente setup-ai-vm.sh y ejecútalo"
echo ""

# ── Script de configuración interna de la VM ──────────────────────────────────
cat > /root/setup-ai-vm.sh <<'SETUP'
#!/usr/bin/env bash
# Ejecutar DENTRO de la VM 200 (deepcheck-ai-engine) como root
set -euo pipefail

echo "[+] Configurando IP estática..."
cat > /etc/netplan/00-installer-config.yaml <<'NETPLAN'
network:
  version: 2
  ethernets:
    enp6s18:
      addresses: [10.10.0.20/24]
      routes:
        - to: default
          via: 10.10.0.1
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
NETPLAN
netplan apply

echo "[+] Instalando drivers NVIDIA para Quadro M4000..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    ubuntu-drivers-common \
    linux-headers-$(uname -r)
ubuntu-drivers autoinstall

echo "[+] Instalando CUDA Toolkit 12..."
wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
dpkg -i cuda-keyring_1.1-1_all.deb
apt-get update -qq
apt-get install -y --no-install-recommends cuda-toolkit-12-3

echo "[+] Instalando dependencias Python para inferencia DeepCheck..."
apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    docker.io docker-compose-plugin \
    nginx \
    qemu-guest-agent

systemctl enable --now qemu-guest-agent
systemctl enable --now docker

# Crear virtualenv para inferencia
python3.11 -m venv /opt/deepcheck-inference
source /opt/deepcheck-inference/bin/activate
pip install --upgrade pip
pip install \
    onnxruntime-gpu==1.17.3 \
    numpy==1.26.4 \
    scikit-learn \
    fastapi \
    uvicorn[standard] \
    python-multipart

echo "[+] Configurando servicio de inferencia..."
cat > /etc/systemd/system/deepcheck-inference.service <<'SYSTEMD'
[Unit]
Description=DeepCheck AI Inference Server
After=network.target
Wants=network.target

[Service]
Type=simple
User=deepcheck
WorkingDirectory=/opt/deepcheck-inference
ExecStart=/opt/deepcheck-inference/bin/uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SYSTEMD

useradd -r -s /bin/false deepcheck 2>/dev/null || true
mkdir -p /opt/deepcheck-inference/models
chown -R deepcheck:deepcheck /opt/deepcheck-inference

systemctl daemon-reload
echo "[OK] VM AI Engine configurada. Reinicia para cargar drivers NVIDIA."
SETUP

chmod +x /root/setup-ai-vm.sh
info "Script de configuración guardado en /root/setup-ai-vm.sh"
info "Cópialo a la VM con: scp /root/setup-ai-vm.sh root@10.10.0.20:~/"
