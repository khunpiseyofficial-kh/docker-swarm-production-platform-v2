#!/usr/bin/env bash
# ==============================================================================
# distribute-ca.sh — Distribute Registry CA Certificate Across Swarm Nodes
# ==============================================================================
# Run from an admin workstation or registry01
# Prerequisite: SSH key-based access to all nodes
# ==============================================================================

set -euo pipefail

REGISTRY_HOST="registry01"
REGISTRY_PORT="5000"
REGISTRY_CERT="${1:-/opt/registry/certs/registry.crt}"

NODES=(
  "192.168.0.21" # swarm-mgr01
  "192.168.0.22" # swarm-mgr02
  "192.168.0.23" # swarm-mgr03
  "192.168.0.31" # swarm-worker01
  "192.168.0.32" # swarm-worker02
  "192.168.0.33" # swarm-worker03
  "192.168.0.42" # monitoring01
)

if [[ ! -f "${REGISTRY_CERT}" ]]; then
  echo "[FATAL] Registry certificate not found at ${REGISTRY_CERT}" >&2
  echo "Usage: $0 [path-to-registry.crt]" >&2
  exit 1
fi

echo "================================================================="
echo "[*] Distributing Registry CA to Docker Trust Store across nodes"
echo "[*] Source Cert: ${REGISTRY_CERT}"
echo "[*] Target Path: /etc/docker/certs.d/${REGISTRY_HOST}:${REGISTRY_PORT}/ca.crt"
echo "================================================================="

for NODE in "${NODES[@]}"; do
  echo "[+] Configuring node: ${NODE}..."
  
  # Ensure target directory exists on remote node
  ssh -o StrictHostKeyChecking=no "root@${NODE}" \
    "mkdir -p /etc/docker/certs.d/${REGISTRY_HOST}:${REGISTRY_PORT}"
  
  # Secure copy certificate
  scp -o StrictHostKeyChecking=no "${REGISTRY_CERT}" \
    "root@${NODE}:/etc/docker/certs.d/${REGISTRY_HOST}:${REGISTRY_PORT}/ca.crt"
  
  # Verify system trust
  ssh -o StrictHostKeyChecking=no "root@${NODE}" \
    "chmod 644 /etc/docker/certs.d/${REGISTRY_HOST}:${REGISTRY_PORT}/ca.crt && \
     grep -q '${REGISTRY_HOST}' /etc/hosts || echo '192.168.0.41 registry01' >> /etc/hosts"
  
  echo "[✓] Node ${NODE} trusted registry01 successfully."
done

echo "================================================================="
echo "[✓] All nodes successfully configured to trust ${REGISTRY_HOST}:${REGISTRY_PORT}"
echo "================================================================="
