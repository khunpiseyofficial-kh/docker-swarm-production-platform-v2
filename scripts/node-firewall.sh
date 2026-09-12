#!/usr/bin/env bash
# ==============================================================================
# node-firewall.sh — Idempotent Netfilter/iptables Configuration for Docker Swarm
# ==============================================================================
# Usage:
#   sudo ./node-firewall.sh
#   sudo ./node-firewall.sh --extra-ports 5000
#   sudo ./node-firewall.sh --extra-ports 9090,3000
#
# CRITICAL SAFETY NOTE:
#   This script NEVER executes `iptables -X` or blanket `iptables -F`.
#   Flushing or deleting Docker-managed chains (DOCKER, DOCKER-USER, etc.) breaks
#   all host-mode published ports until the Docker daemon is restarted.
# ==============================================================================

set -euo pipefail

SUBNET="192.168.0.0/24"
EXTRA_PORTS=""

# Parse command-line flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extra-ports|-p)
      EXTRA_PORTS="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sudo $0 [--extra-ports <port1,port2,...>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "[FATAL] This script must be executed as root (sudo)." >&2
  exit 1
fi

echo "================================================================="
echo "[*] Configuring raw iptables firewall for Docker Swarm node"
echo "[*] Cluster Subnet: ${SUBNET}"
if [[ -n "${EXTRA_PORTS}" ]]; then
  echo "[*] Additional Allowed Ports: ${EXTRA_PORTS}"
fi
echo "================================================================="

# Ensure iptables-persistent is installed non-interactively
if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
  echo "[+] Installing iptables-persistent and netfilter-persistent..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq iptables-persistent netfilter-persistent
fi

# Ensure UFW is completely disabled and uninstalled to avoid reboot race conditions
if systemctl is-active --quiet ufw || dpkg -s ufw >/dev/null 2>&1; then
  echo "[!] UFW detected. Disabling and purging UFW to prevent boot-time rule overwrites..."
  ufw disable >/dev/null 2>&1 || true
  apt-get purge -y -qq ufw >/dev/null 2>&1 || true
fi

echo "[+] Flushing OS INPUT and FORWARD chains (preserving DOCKER chains)..."
# DO NOT run `iptables -F` (blanket) or `iptables -X`!
iptables -F INPUT
iptables -F FORWARD

echo "[+] Setting default chain policies..."
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

echo "[+] Applying core netfilter rules..."
# 1. Allow local loopback traffic
iptables -A INPUT -i lo -j ACCEPT

# 2. Allow established and related connections (stateful inspection)
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# 3. Allow SSH administration (22/tcp) - Always top priority
iptables -A INPUT -p tcp --dport 22 -m comment --comment "SSH Administration" -j ACCEPT

# 4. Swarm Control Plane & Cluster Management (2377/tcp)
iptables -A INPUT -s "${SUBNET}" -p tcp --dport 2377 -m comment --comment "Swarm Control Plane" -j ACCEPT

# 5. Swarm Node Gossip & State Sync (7946/tcp & 7946/udp)
iptables -A INPUT -s "${SUBNET}" -p tcp --dport 7946 -m comment --comment "Swarm Node Gossip TCP" -j ACCEPT
iptables -A INPUT -s "${SUBNET}" -p udp --dport 7946 -m comment --comment "Swarm Node Gossip UDP" -j ACCEPT

# 6. Swarm Overlay Network VXLAN Data Plane (4789/udp)
iptables -A INPUT -s "${SUBNET}" -p udp --dport 4789 -m comment --comment "Swarm VXLAN Overlay" -j ACCEPT

# 7. Web Ingress (80/tcp, 443/tcp) - Open for Traefik routing mesh
iptables -A INPUT -p tcp --dport 80 -m comment --comment "HTTP Public Ingress" -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -m comment --comment "HTTPS Public Ingress" -j ACCEPT

# 8. Host Metrics Scrape Targets (9100/tcp Node Exporter, 8080/tcp cAdvisor)
iptables -A INPUT -s "${SUBNET}" -p tcp --dport 9100 -m comment --comment "Prometheus Node Exporter" -j ACCEPT
iptables -A INPUT -s "${SUBNET}" -p tcp --dport 8080 -m comment --comment "cAdvisor Metrics" -j ACCEPT

# 9. ICMP Echo Request (Ping) scoped to the cluster subnet
iptables -A INPUT -s "${SUBNET}" -p icmp --icmp-type echo-request -m comment --comment "LAN ICMP Ping" -j ACCEPT

# 10. Role-specific extra ports (e.g., 5000 for Registry, 9090/3000 for Monitoring)
if [[ -n "${EXTRA_PORTS}" ]]; then
  IFS=',' read -ra PORTS <<< "${EXTRA_PORTS}"
  for PORT in "${PORTS[@]}"; do
    PORT_TRIMMED="$(echo "${PORT}" | xargs)"
    if [[ -n "${PORT_TRIMMED}" ]]; then
      echo "[+] Allowing extra role port: ${PORT_TRIMMED}/tcp from ${SUBNET}"
      iptables -A INPUT -s "${SUBNET}" -p tcp --dport "${PORT_TRIMMED}" -m comment --comment "Custom Role Port ${PORT_TRIMMED}" -j ACCEPT
    fi
  done
fi

echo "[+] Persisting netfilter rules across reboots via netfilter-persistent..."
netfilter-persistent save

echo "================================================================="
echo "[✓] Firewall configuration completed successfully!"
echo "[*] Active INPUT rules:"
iptables -S INPUT
echo "================================================================="
echo "[*] ACTION REQUIRED: Execute a VM reboot test to verify rule persistence."
echo "================================================================="
