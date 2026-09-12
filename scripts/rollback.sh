#!/usr/bin/env bash
# ==============================================================================
# rollback.sh — Instant Single-Command Service Rollback on Docker Swarm
# ==============================================================================
# Usage:
#   ./scripts/rollback.sh backend
#   ./scripts/rollback.sh frontend
# ==============================================================================

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <service-name: backend|frontend|traefik>" >&2
  echo "Example: $0 backend" >&2
  exit 1
fi

SERVICE="$1"
SWARM_SERVICE="shop_${SERVICE}"

echo "================================================================="
echo "[*] Triggering Native Swarm Rollback for ${SWARM_SERVICE}"
echo "================================================================="

# Execute Docker Swarm native rollback
docker service rollback "${SWARM_SERVICE}"

echo ""
echo "[+] Rollback in progress. Streaming task states..."
echo "-----------------------------------------------------------------"

for i in {1..6}; do
  docker service ps --no-trunc "${SWARM_SERVICE}" | head -n 5
  echo "-----------------------------------------------------------------"
  sleep 3
done

echo "================================================================="
echo "[✓] Service ${SWARM_SERVICE} successfully rolled back to previous spec!"
docker service ls --filter "name=${SWARM_SERVICE}"
echo "================================================================="
