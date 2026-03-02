# DeepCheck · Infraestructura Proxmox VE 8

**Convierte tu PC con Xeon E5-2630v4 en un servidor de grado empresarial**
MacBook Pro M5 como cliente de gestión · WireGuard VPN · GDPR compliant

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────┐
│  MacBook Pro M5 (cliente)                                        │
│  WireGuard → 10.10.100.2                                         │
└──────────────────┬───────────────────────────────────────────────┘
                   │ WireGuard VPN (UDP 51820)
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  PROXMOX VE 8 HOST — Xeon E5-2630v4 · 32GB RAM                  │
│  WireGuard: 10.10.100.1  │  LAN interna: 10.10.0.1              │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐   │
│  │  VM 100         │  │  VM 200 · AI Engine                  │   │
│  │  Windows 11     │  │  Ubuntu 22.04                        │   │
│  │  + WSL2         │  │  BiLSTM + XGBoost + IsoForest        │   │
│  │  10.10.0.10     │  │  ★ Quadro M4000 PCIe Passthrough     │   │
│  │  8GB / 4 cores  │  │  10.10.0.20 · 8GB / 4 cores         │   │
│  └─────────────────┘  └──────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐   │
│  │  LXC 300        │  │  LXC 400 · CI/CD                     │   │
│  │  PostgreSQL 16  │  │  Gitea + Woodpecker CI               │   │
│  │  🔐 AES-256     │  │  Deploy automático a VM 200          │   │
│  │  10.10.0.30     │  │  10.10.0.40 · 4GB / 2 cores         │   │
│  │  4GB / 2 cores  │  └──────────────────────────────────────┘   │
│  └─────────────────┘                                             │
│                                                                  │
│  vmbr0 (WAN → router)  ·  vmbr1 (LAN interna 10.10.0.0/24)     │
└──────────────────────────────────────────────────────────────────┘
                   │ NAT / Backup
                   ▼
          ☁️  Backblaze B2 (offsite cifrado AES-256)
```

---

## Mapa de IPs

| Recurso                  | IP            | Puerto(s)     |
|--------------------------|---------------|---------------|
| Proxmox Host (WireGuard) | 10.10.100.1   | 8006 (web UI) |
| MacBook (VPN)            | 10.10.100.2   | —             |
| VM 100 — Windows + WSL2  | 10.10.0.10    | 3389 (RDP)    |
| VM 200 — AI Engine       | 10.10.0.20    | 8080 (API)    |
| LXC 300 — PostgreSQL     | 10.10.0.30    | 5432          |
| LXC 400 — CI/CD          | 10.10.0.40    | 3000, 8000    |

---

## Paso a Paso

### FASE 0 — Preparación (desde tu MacBook)

```bash
# Descarga Proxmox VE 8 ISO
# https://www.proxmox.com/en/downloads/proxmox-virtual-environment

# Crea USB booteable (reemplaza /dev/diskX con tu USB)
diskutil unmountDisk /dev/diskX
sudo dd if=proxmox-ve_8.3-1.iso of=/dev/rdiskX bs=1m status=progress
```

**En el BIOS del servidor (Xeon E5-2630v4) — ANTES de instalar:**
- [ ] Intel VT-x → **Enabled**
- [ ] Intel VT-d (IOMMU) → **Enabled** (necesario para GPU passthrough)
- [ ] Secure Boot → **Disabled**
- [ ] Boot order → USB primero
- [ ] C-States → Enabled (ahorro energético)

---

### FASE 1 — Instalación Proxmox

1. Arranca desde el USB
2. Selecciona el disco principal como destino (ej: 500GB SSD)
3. Configura:
   - **Hostname**: `proxmox.deepcheck.local`
   - **IP**: `192.168.1.100` (la IP de tu red local)
   - **Gateway**: IP de tu router (ej: `192.168.1.1`)
   - **DNS**: `1.1.1.1`
4. Completa la instalación → reinicia
5. Accede desde el MacBook: `https://192.168.1.100:8006`

> **Windows**: después de instalar Proxmox, la instalarás como VM 100.
> Esto es más eficiente que dual-boot y te permite usarla a la vez que las otras VMs.

---

### FASE 2 — Post-instalación (SSH desde MacBook)

```bash
# Desde tu MacBook, conecta al servidor
ssh root@192.168.1.100

# Copia el repositorio al servidor
git clone https://github.com/paulrod0/deep-check /opt/deep-check
cd /opt/deep-check/infra/proxmox

# Dar permisos de ejecución a todos los scripts
chmod +x post-install.sh network/wireguard/setup-wireguard.sh \
         vms/*.sh lxc/*.sh security/*.sh

# Ejecutar post-instalación (hardening, IOMMU, repos)
bash post-install.sh

# REINICIAR (obligatorio para IOMMU + kernel changes)
reboot
```

---

### FASE 3 — Red + VPN WireGuard

```bash
# Reconectar tras reinicio
ssh root@192.168.1.100

# Configurar interfaces de red
cp /opt/deep-check/infra/proxmox/network/interfaces /etc/network/interfaces
# Ajusta 'enp3s0' al nombre real de tu NIC (ip link show)
nano /etc/network/interfaces
ifreload -a

# Configurar WireGuard VPN
bash /opt/deep-check/infra/proxmox/network/wireguard/setup-wireguard.sh

# Copiar config al MacBook
scp root@192.168.1.100:/etc/wireguard/macbook-deepcheck.conf ~/Desktop/
```

**En el MacBook:**
```bash
# Instalar WireGuard
brew install wireguard-tools

# Activar VPN
sudo wg-quick up ~/Desktop/macbook-deepcheck.conf

# Verificar conexión
ping 10.10.100.1

# A partir de aquí usar IP VPN para todo
ssh root@10.10.100.1
# Proxmox UI: https://10.10.100.1:8006
```

> ⚡ **Router**: abre el puerto UDP 51820 en tu router apuntando a 192.168.1.100
> para que la VPN funcione desde fuera de casa.

---

### FASE 4 — GPU Passthrough (Quadro M4000)

```bash
# Detectar PCI ID de la GPU (en Proxmox host)
bash /opt/deep-check/infra/proxmox/vms/detect-gpu-pci.sh

# Output esperado:
#   PCI Address:      01:00.0
#   Vendor:Device ID: 10de:13f0

# Usar esos valores para crear la VM con GPU passthrough
bash /opt/deep-check/infra/proxmox/vms/create-ai-vm.sh 01:00.0 10de:13f0
```

---

### FASE 5 — Crear VMs y LXCs

```bash
# Orden de creación (respetar orden de startup)

# 1. VM Windows (requiere ISO descargada)
# Descarga Windows 11 ISO desde microsoft.com → /var/lib/vz/template/iso/
bash /opt/deep-check/infra/proxmox/vms/create-windows-vm.sh

# 2. LXC Base de datos (inicia automáticamente y configura PostgreSQL)
bash /opt/deep-check/infra/proxmox/lxc/create-db-lxc.sh

# 3. LXC CI/CD (Gitea + Woodpecker)
bash /opt/deep-check/infra/proxmox/lxc/create-cicd-lxc.sh

# 4. VM AI Engine (GPU passthrough — requiere FASE 4 completada)
bash /opt/deep-check/infra/proxmox/vms/create-ai-vm.sh

# Ver estado de todos los recursos
pvesh get /nodes/proxmox/status
qm list && pct list
```

---

### FASE 6 — Backups y Cumplimiento GDPR

```bash
# Configurar sistema de backups automáticos
bash /opt/deep-check/infra/proxmox/security/backup-gdpr.sh

# Configurar Backblaze B2 (offsite cifrado)
# Sigue las instrucciones del script anterior para rclone
rclone config

# Verificar primer backup manual
vzdump 200 300 400 --storage local --mode snapshot --compress zstd

# Test de sync
/usr/local/bin/deepcheck-offsite-sync.sh
```

---

### FASE 7 — Flujo de Trabajo desde el MacBook

```bash
# Con VPN activa

# Gestión Proxmox
open https://10.10.100.1:8006

# SSH a VMs directamente
ssh root@10.10.0.20    # AI Engine
ssh root@10.10.0.30    # Database

# Windows via RDP
open rdp://10.10.0.10
# O: Microsoft Remote Desktop → 10.10.0.10

# Gitea (gestión de código)
open http://10.10.0.40:3000

# Woodpecker CI
open http://10.10.0.40:8000

# Push código desde MacBook al servidor local
git remote add proxmox ssh://git@10.10.0.40:2222/admin/deep-check.git
git push proxmox main   # → trigger CI/CD → deploy automático a VM 200
```

---

## Consumo de Recursos

| Recurso   | Total    | Windows | AI VM | DB LXC | CI/CD LXC | Host |
|-----------|----------|---------|-------|--------|-----------|------|
| RAM       | 32GB     | 8GB     | 8GB   | 4GB    | 4GB       | 8GB  |
| CPU (virt)| 20 hilos | 4       | 4     | 2      | 2         | 8    |
| Disco     | ~400GB   | 150GB   | 80GB  | 60GB   | 40GB      | 70GB |
| GPU       | M4000    | —       | ✓ PCIe| —      | —         | —    |

---

## Seguridad

| Control                  | Implementación                              |
|--------------------------|---------------------------------------------|
| Acceso externo           | Solo WireGuard VPN (UDP 51820)              |
| Autenticación SSH        | Solo clave pública (password off)           |
| Brute-force              | Fail2ban (SSH + Proxmox UI)                 |
| Cifrado datos biométricos| AES-256-GCM (pgcrypto) + SSL en tránsito   |
| Backup cifrado           | rclone crypt (AES-256-CTR) → Backblaze B2   |
| Firewall                 | Proxmox datacenter FW + UFW por contenedor  |
| Actualizaciones          | unattended-upgrades (security patches auto) |
| Auditoría GDPR           | Logs 365 días + tabla audit.access_log      |
| Retención datos          | 2 años máximo (Art. 5 GDPR)                 |

---

## Estructura de Archivos

```
infra/proxmox/
├── README.md                           ← Este archivo
├── post-install.sh                     ← Hardening inicial
├── network/
│   ├── interfaces                      ← Config puentes vmbr0/vmbr1
│   └── wireguard/
│       └── setup-wireguard.sh          ← VPN MacBook ↔ Proxmox
├── vms/
│   ├── detect-gpu-pci.sh               ← Detectar Quadro M4000
│   ├── create-windows-vm.sh            ← VM 100: Windows + WSL2
│   └── create-ai-vm.sh                 ← VM 200: Motor IA + GPU
├── lxc/
│   ├── create-db-lxc.sh               ← LXC 300: PostgreSQL GDPR
│   └── create-cicd-lxc.sh             ← LXC 400: Gitea + Woodpecker
└── security/
    └── backup-gdpr.sh                  ← Backups 3-2-1 + offsite
```

---

## Troubleshooting

**GPU Passthrough Error 43 (Windows)**
```bash
# Ya está configurado en create-ai-vm.sh con:
# --args "-cpu host,kvm=off,hv_vendor_id=proxmox"
# Si persiste, edita la VM y añade en BIOS → Machine: q35
```

**WireGuard no conecta desde fuera de casa**
```bash
# En tu router: NAT → UDP 51820 → 192.168.1.100
# Verifica IP pública del servidor: curl ifconfig.me
# Actualiza Endpoint en macbook-deepcheck.conf
```

**LXC no puede usar Docker (nesting)**
```bash
# Verificar features del LXC:
pct config 400 | grep features
# Debe incluir: features: nesting=1
```

**PostgreSQL no acepta conexiones SSL**
```bash
# Regenerar certificado dentro del LXC:
pct exec 300 -- openssl req -new -x509 -days 3650 -nodes \
    -keyout /etc/postgresql/16/main/server.key \
    -out /etc/postgresql/16/main/server.crt \
    -subj '/CN=deepcheck-db'
pct exec 300 -- systemctl restart postgresql
```
