#!/usr/bin/env bash
# ============================================================
# DeepCheck · Detectar PCI ID de la Quadro M4000
# Ejecutar en Proxmox host DESPUÉS del reboot con IOMMU activo
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${GREEN}── GPU PCI Detection ─────────────────────────────────────${NC}"
echo ""

# Verificar IOMMU activo
if dmesg | grep -q "IOMMU enabled"; then
    echo -e "${GREEN}[✓]${NC} IOMMU activo"
else
    echo -e "${RED}[✗]${NC} IOMMU NO detectado — asegúrate de haber reiniciado"
    echo "     Verifica /etc/default/grub: GRUB_CMDLINE_LINUX_DEFAULT debe contener intel_iommu=on"
    exit 1
fi

echo ""
echo "── GPUs detectadas ──────────────────────────────────────────"
lspci -nn | grep -iE "VGA|3D|Display|NVIDIA"
echo ""

# Extraer IDs de la Quadro M4000
GPU_LINE=$(lspci -nn | grep -i "M4000" || lspci -nn | grep -i "NVIDIA" | head -1)
if [[ -z "$GPU_LINE" ]]; then
    echo -e "${YELLOW}[!]${NC} No se encontró M4000 directamente. Mostrando todas las GPUs NVIDIA:"
    lspci -nn | grep -i NVIDIA
    echo ""
    echo "Copia el PCI address (ej: 01:00.0) y extrae la ID con: lspci -n -s 01:00.0"
    exit 0
fi

PCI_ADDR=$(echo "$GPU_LINE" | awk '{print $1}')
PCI_ID=$(echo "$GPU_LINE" | grep -oP '\[\K[0-9a-f]{4}:[0-9a-f]{4}(?=\])')
AUDIO_LINE=$(lspci -nn | grep -A1 "$PCI_ADDR" | grep -i "Audio" || true)

echo -e "${GREEN}[✓]${NC} GPU encontrada: $GPU_LINE"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo "  PCI Address:  $PCI_ADDR"
echo "  Vendor:Device ID: $PCI_ID"
if [[ -n "$AUDIO_LINE" ]]; then
    AUDIO_ADDR=$(echo "$AUDIO_LINE" | awk '{print $1}')
    AUDIO_ID=$(echo "$AUDIO_LINE" | grep -oP '\[\K[0-9a-f]{4}:[0-9a-f]{4}(?=\])')
    echo "  Audio PCI:    $AUDIO_ADDR (ID: $AUDIO_ID)"
fi
echo "─────────────────────────────────────────────────────────────"
echo ""

# IOMMU groups
echo "── IOMMU Group de la GPU ─────────────────────────────────────"
IOMMU_GROUP=""
for d in /sys/kernel/iommu_groups/*/devices/*; do
    if [[ $(basename "$d") == "${PCI_ADDR}"* ]]; then
        IOMMU_GROUP=$(echo "$d" | grep -oP 'iommu_groups/\K[0-9]+')
        break
    fi
done

if [[ -n "$IOMMU_GROUP" ]]; then
    echo "  IOMMU Group $IOMMU_GROUP contiene:"
    for dev in /sys/kernel/iommu_groups/${IOMMU_GROUP}/devices/*; do
        lspci -nns "$(basename "$dev")"
    done
    echo ""
    DEVICES_IN_GROUP=$(ls /sys/kernel/iommu_groups/${IOMMU_GROUP}/devices/ | wc -l)
    if [[ $DEVICES_IN_GROUP -gt 2 ]]; then
        echo -e "${YELLOW}[!]${NC} El grupo tiene $DEVICES_IN_GROUP dispositivos — puede necesitar ACS override patch"
    else
        echo -e "${GREEN}[✓]${NC} Grupo aislado ($DEVICES_IN_GROUP dispositivos) — passthrough OK"
    fi
fi

echo ""
echo "── Añadir al VFIO (copiar estas líneas) ─────────────────────"
echo ""
echo "  Añade a /etc/modprobe.d/vfio.conf:"
echo "  options vfio-pci ids=$PCI_ID"
if [[ -n "${AUDIO_ID:-}" ]]; then
    echo "  options vfio-pci ids=$PCI_ID,$AUDIO_ID"
fi
echo ""
echo -e "${YELLOW}  Ejecuta el script de creación de VM AI con estos IDs:${NC}"
echo "  ./vms/create-ai-vm.sh $PCI_ADDR $PCI_ID"
echo ""
