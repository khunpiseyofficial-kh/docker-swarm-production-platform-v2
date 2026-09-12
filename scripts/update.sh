#!/usr/bin/env bash
# ==============================================================================
# update.sh — CI/CD Pipeline Build, Push, and Rolling Service Update
# ==============================================================================
# Usage:
#   ./scripts/update.sh backend v1.1.0
#   ./scripts/update.sh frontend v1.1.0
# ==============================================================================

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <service-name: backend|frontend> <version-tag>" >&2
  echo "Example: $0 backend v1.1.0" >&2
  exit 1
fi

SERVICE="$1"
TAG="$2"
REGISTRY="registry01:5000"
IMAGE_NAME="${REGISTRY}/swarm-shop-${SERVICE}:${TAG}"
SWARM_SERVICE="shop_${SERVICE}"
SOURCE_DIR="application/${SERVICE}"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "[FATAL] Source directory ${SOURCE_DIR} does not exist!" >&2
  exit 1
fi

echo "================================================================="
echo "[*] CI/CD Pipeline: Rolling Update for ${SWARM_SERVICE}"
echo "[*] Target Image: ${IMAGE_NAME}"
echo "================================================================="

# Step 1: Build Image
echo "[+] Step 1/3: Building Docker image from ${SOURCE_DIR}..."
docker build -t "${IMAGE_NAME}" "${SOURCE_DIR}"

# Step 2: Push Image to Private Registry
echo "[+] Step 2/3: Pushing image to ${REGISTRY}..."
docker push "${IMAGE_NAME}"

# Step 3: Trigger Swarm Rolling Update
echo "[+] Step 3/3: Executing rolling service update on Swarm..."
docker service update \
  --image "${IMAGE_NAME}" \
  "${SWARM_SERVICE}"

echo ""
echo "[+] Rolling update initiated with 'order: start-first'. Monitoring tasks..."
echo "-----------------------------------------------------------------"
for i in {1..8}; do
  docker service ps --no-trunc "${SWARM_SERVICE}" | head -n 6
  echo "-----------------------------------------------------------------"
  sleep 4
done

echo "================================================================="
echo "[✓] Rolling update completed!"
docker service ls --filter "name=${SWARM_SERVICE}"
echo "================================================================="
