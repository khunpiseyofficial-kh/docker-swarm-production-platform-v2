#!/usr/bin/env bash
# ==============================================================================
# restore.sh — MariaDB Disaster Recovery & Database Restoration
# ==============================================================================
# Target Host: swarm-worker03 (pinned node with storage=true label)
# Usage:
#   sudo ./backup/restore.sh /opt/backups/mariadb/shopdb_20260912_084500.sql.gz
# ==============================================================================

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-backup.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[FATAL] Backup file ${BACKUP_FILE} does not exist!" >&2
  exit 1
fi

echo "================================================================="
echo "[*] MariaDB Disaster Recovery Restoration Initiated"
echo "[*] Source Archive: ${BACKUP_FILE}"
echo "================================================================="

# Step 1: Verify SHA256 Checksum if present
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ -f "${CHECKSUM_FILE}" ]]; then
  echo "[+] Validating SHA256 archive integrity..."
  sha256sum --check "${CHECKSUM_FILE}"
  echo "[✓] Archive integrity verified."
else
  echo "[!] Warning: No .sha256 checksum file found. Proceeding with caution..."
fi

# Step 2: Locate MariaDB container
CONTAINER_ID=$(docker ps --filter "name=shop_mariadb" --filter "status=running" -q | head -n 1)
if [[ -z "${CONTAINER_ID}" ]]; then
  echo "[FATAL] MariaDB container not found running on this host!" >&2
  echo "        Ensure this script is executed on the pinned storage node (swarm-worker03)." >&2
  exit 1
fi

echo "[+] Located MariaDB container: ${CONTAINER_ID}"
DB_PASSWORD=$(docker exec "${CONTAINER_ID}" cat /run/secrets/db_password)

# Step 3: Stream Restoration into MariaDB
echo "[+] Streaming decompressing SQL into MariaDB container..."
RESTORE_START=$(date +%s)

gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_ID}" \
  mariadb -u shopuser -p"${DB_PASSWORD}" shopdb

RESTORE_END=$(date +%s)
RTO_DURATION=$((RESTORE_END - RESTORE_START))

echo "[✓] Database restoration completed in ${RTO_DURATION}s (Recovery Time Objective)."

# Step 4: Verification Queries
echo "[+] Validating database table record counts..."
PRODUCT_COUNT=$(docker exec "${CONTAINER_ID}" mariadb -u shopuser -p"${DB_PASSWORD}" -e "SELECT COUNT(*) FROM shopdb.products;" -s -N)
USER_COUNT=$(docker exec "${CONTAINER_ID}" mariadb -u shopuser -p"${DB_PASSWORD}" -e "SELECT COUNT(*) FROM shopdb.users;" -s -N)

echo "================================================================="
echo "[✓] POST-RESTORE VERIFICATION AUDIT:"
echo "    - Products in Database: ${PRODUCT_COUNT}"
echo "    - Users in Database:    ${USER_COUNT}"
echo "    - Measured Database RTO: ${RTO_DURATION} seconds"
echo "================================================================="
