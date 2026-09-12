#!/usr/bin/env bash
# ==============================================================================
# deploy.sh — Pre-flight Validation & Stack Deployment for Docker Swarm
# ==============================================================================
# Usage:
#   ./scripts/deploy.sh
# ==============================================================================

set -euo pipefail

STACK_NAME="shop"
STACK_FILE="stack/docker-stack.yml"

echo "================================================================="
echo "[*] Initializing Pre-Flight Validation for Stack: ${STACK_NAME}"
echo "================================================================="

# 1. Validate Swarm Manager status
if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q 'active'; then
  echo "[FATAL] Node is not an active Docker Swarm member." >&2
  exit 1
fi

if ! docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null | grep -q 'true'; then
  echo "[FATAL] This command must be executed on a Swarm MANAGER node." >&2
  exit 1
fi

# 2. Check Node Labels
echo "[+] Checking required node labels..."
STORAGE_NODES=$(docker node ls -q | xargs docker node inspect -f '{{.Description.Hostname}}: {{range $k, $v := .Spec.Labels}}{{if eq $k "storage"}}true{{end}}{{end}}' | grep "true" || true)
INGRESS_NODES=$(docker node ls -q | xargs docker node inspect -f '{{.Description.Hostname}}: {{range $k, $v := .Spec.Labels}}{{if eq $k "ingress"}}true{{end}}{{end}}' | grep "true" || true)

if [[ -z "${STORAGE_NODES}" ]]; then
  echo "[FATAL] No nodes found with label 'storage=true'. Required for MariaDB pinning!" >&2
  echo "        Run: docker node update --label-add storage=true swarm-worker03" >&2
  exit 1
fi

if [[ -z "${INGRESS_NODES}" ]]; then
  echo "[FATAL] No nodes found with label 'ingress=true'. Required for Traefik ingress!" >&2
  echo "        Run: docker node update --label-add ingress=true swarm-mgr01" >&2
  echo "        Run: docker node update --label-add ingress=true swarm-mgr02" >&2
  exit 1
fi

echo "[✓] Required node labels verified."

# 3. Check Required Secrets
REQUIRED_SECRETS=("db_root_password" "db_password" "jwt_secret" "tls_cert" "tls_key")
echo "[+] Verifying Docker Secrets..."
for SECRET in "${REQUIRED_SECRETS[@]}"; do
  if ! docker secret inspect "${SECRET}" >/dev/null 2>&1; then
    echo "[FATAL] Required secret '${SECRET}' does not exist!" >&2
    echo "        See stack/secrets.md for creation commands." >&2
    exit 1
  fi
done
echo "[✓] All required secrets exist."

# 4. Check Required Configs
REQUIRED_CONFIGS=("traefik_static_conf" "traefik_dynamic_conf" "mariadb_init_sql")
echo "[+] Verifying Docker Configs..."
for CONFIG in "${REQUIRED_CONFIGS[@]}"; do
  if ! docker config inspect "${CONFIG}" >/dev/null 2>&1; then
    echo "[FATAL] Required config '${CONFIG}' does not exist!" >&2
    echo "        See stack/configs.md for creation commands." >&2
    exit 1
  fi
done
echo "[✓] All required configs exist."

# 5. Deploy Stack
echo "================================================================="
echo "[+] Deploying Stack '${STACK_NAME}' from ${STACK_FILE}..."
echo "================================================================="

docker stack deploy --compose-file "${STACK_FILE}" "${STACK_NAME}"

echo ""
echo "[+] Monitoring service convergence (waiting for replicas to become ready)..."
sleep 5

docker stack services "${STACK_NAME}"

echo "================================================================="
echo "[✓] Stack '${STACK_NAME}' deployed successfully!"
echo "[*] Access the platform at: https://shop.local (ensure DNS/hosts is mapped)"
echo "================================================================="
