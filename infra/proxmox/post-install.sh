#!/usr/bin/env bash
# ============================================================
# DeepCheck · Proxmox VE 8 — Post-Installation Hardening
# Run as root on the Proxmox host immediately after first boot.
# Hardware: Xeon E5-2630v4 · 32GB RAM · Quadro M4000 8GB
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
abort() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && abort "Must run as root"

# ── 1. Remove enterprise subscription nag ────────────────────────────────────
info "Configuring APT repositories (no-subscription)..."
cat > /etc/apt/sources.list.d/pve-no-subscription.list <<'EOF'
deb http://download.proxmox.com/debian/pve bookworm pve-no-subscription
EOF
# Disable enterprise repo (requires paid subscription)
if [[ -f /etc/apt/sources.list.d/pve-enterprise.list ]]; then
    sed -i 's/^deb/#deb/' /etc/apt/sources.list.d/pve-enterprise.list
fi
# Disable Ceph enterprise repo if present
if [[ -f /etc/apt/sources.list.d/ceph.list ]]; then
    sed -i 's/^deb/#deb/' /etc/apt/sources.list.d/ceph.list
fi

# ── 2. Full system update ─────────────────────────────────────────────────────
info "Updating system..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y -qq
apt-get autoremove -y -qq

# ── 3. Install essentials ─────────────────────────────────────────────────────
info "Installing essential packages..."
apt-get install -y -qq \
    wireguard wireguard-tools \
    fail2ban \
    ufw \
    htop iotop iftop nethogs \
    git curl wget jq \
    zfsutils-linux \
    qemu-guest-agent \
    libguestfs-tools \
    pve-headers \
    dnsmasq \
    unattended-upgrades \
    apt-listchanges

# ── 4. Enable automatic security updates ─────────────────────────────────────
info "Configuring unattended-upgrades..."
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now unattended-upgrades

# ── 5. SSH hardening ──────────────────────────────────────────────────────────
info "Hardening SSH..."
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
cat > /etc/ssh/sshd_config <<'EOF'
Port 22
Protocol 2
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

# Authentication — key only, no password
PermitRootLogin prohibit-password
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Connection limits
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2

# Disable unused features
X11Forwarding no
AllowTcpForwarding yes
AllowAgentForwarding yes
PrintMotd no
AcceptEnv LANG LC_*

# Ciphers (modern only)
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
EOF
systemctl restart ssh

# ── 6. Fail2ban for SSH + Proxmox web UI ─────────────────────────────────────
info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.d/deepcheck.conf <<'EOF'
[sshd]
enabled  = true
port     = ssh
maxretry = 5
bantime  = 3600
findtime = 600

[proxmox]
enabled  = true
port     = 8006
filter   = proxmox
logpath  = /var/log/daemon.log
maxretry = 5
bantime  = 3600
findtime = 600
EOF

cat > /etc/fail2ban/filter.d/proxmox.conf <<'EOF'
[Definition]
failregex = pvedaemon\[.*\]: authentication failure; rhost=<HOST> user=.* msg=.*
ignoreregex =
EOF
systemctl enable --now fail2ban

# ── 7. IOMMU for GPU Passthrough (Quadro M4000) ───────────────────────────────
info "Enabling IOMMU for GPU passthrough..."
# Intel VT-d — required for PCIe passthrough of the Quadro M4000
GRUB_FILE="/etc/default/grub"
if ! grep -q "intel_iommu=on" "$GRUB_FILE"; then
    sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="quiet"/GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt"/' "$GRUB_FILE"
    update-grub
    info "IOMMU enabled in GRUB — will take effect after reboot"
fi

# Load VFIO modules at boot
cat >> /etc/modules <<'EOF'
vfio
vfio_iommu_type1
vfio_pci
vfio_virqfd
EOF

# Blacklist Nouveau/NVIDIA drivers on host (let VM own the GPU)
cat > /etc/modprobe.d/blacklist-gpu.conf <<'EOF'
blacklist nouveau
blacklist nvidia
blacklist nvidiafb
blacklist nvidia_drm
options kvm ignore_msrs=1
options kvm report_ignored_msrs=0
EOF
update-initramfs -u -k all

# ── 8. ZFS tuning for 32GB RAM ────────────────────────────────────────────────
info "Tuning ZFS ARC (max 8GB for host)..."
cat > /etc/modprobe.d/zfs.conf <<'EOF'
# ARC max = 8GB (leave RAM for VMs)
options zfs zfs_arc_max=8589934592
# ARC min = 1GB
options zfs zfs_arc_min=1073741824
EOF

# ── 9. Proxmox web UI — disable subscription banner ─────────────────────────
info "Removing subscription nag from web UI..."
JS_FILE="/usr/share/javascript/proxmox-widget-toolkit/proxmoxlib.js"
if [[ -f "$JS_FILE" ]]; then
    sed -i.bak "s/if (res === null || res === undefined || \!res || res/if (false || res/" "$JS_FILE" 2>/dev/null || true
fi

# ── 10. Configure time sync ───────────────────────────────────────────────────
info "Configuring NTP..."
timedatectl set-timezone Europe/Madrid
cat > /etc/systemd/timesyncd.conf <<'EOF'
[Time]
NTP=0.es.pool.ntp.org 1.es.pool.ntp.org 2.europe.pool.ntp.org
FallbackNTP=time.cloudflare.com
EOF
systemctl restart systemd-timesyncd

# ── 11. Internal network bridge (vmbr1) ───────────────────────────────────────
info "Network bridges will be configured in /etc/network/interfaces"
info "→ See infra/proxmox/network/interfaces for the full config"

# ── 12. Proxmox datacenter firewall basics ────────────────────────────────────
info "Applying datacenter firewall rules..."
mkdir -p /etc/pve/firewall
cat > /etc/pve/firewall/cluster.fw <<'EOF'
[OPTIONS]
enable: 1
policy_in: DROP
policy_out: ACCEPT

[RULES]
# Allow WireGuard VPN (MacBook access)
IN ACCEPT -p udp --dport 51820 -log nolog
# Allow SSH from WireGuard tunnel only (enforced after VPN up)
IN ACCEPT -p tcp --dport 22 -source 10.10.100.0/24 -log nolog
# Allow Proxmox web UI from WireGuard only
IN ACCEPT -p tcp --dport 8006 -source 10.10.100.0/24 -log nolog
# Allow internal VM traffic
IN ACCEPT -source 10.10.0.0/24 -log nolog
# ICMP (ping) from trusted networks only
IN ACCEPT -p icmp -source 10.10.100.0/24 -log nolog
IN ACCEPT -p icmp -source 10.10.0.0/24 -log nolog
EOF

# ── 13. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Proxmox post-install complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
warn "REQUIRED NEXT STEPS:"
echo "  1. Add your MacBook SSH public key:"
echo "       ssh-copy-id root@<PROXMOX-IP>"
echo "  2. REBOOT to apply IOMMU + kernel changes:"
echo "       reboot"
echo "  3. After reboot, run GPU passthrough detection:"
echo "       ./vms/detect-gpu-pci.sh"
echo "  4. Set up WireGuard VPN:"
echo "       ./network/wireguard/setup-wireguard.sh"
echo ""
