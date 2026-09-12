#!/usr/bin/env bash
# ==============================================================================
# database-backup.sh — MariaDB Consistent Backup with Compression & Retention
# ==============================================================================
# Target Host: swarm-worker03 (pinned node with storage=true label)
#
# PRODUCTION LIMITATION DISCLOSURE:
#   This lab script writes backups to a local directory (/opt/backups/mariadb)
#   on the same physical disk hosting the live MariaDB named volume. In a true
#   production architecture, backups must be streamed immediately off-node to
#   immutable remote object storage (e.g. AWS S3, MinIO, or NFS).
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/mariadb}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/shopdb_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

mkdir -p "${BACKUP_DIR}"

echo "================================================================="
echo "[*] MariaDB Consistent Backup Initiated"
echo "[*] Timestamp: ${TIMESTAMP}"
echo "[*] Destination: ${BACKUP_FILE}"
echo "================================================================="

# Locate MariaDB container on this worker
CONTAINER_ID=$(docker ps --filter "name=shop_mariadb" --filter "status=running" -q | head -n 1)

if [[ -z "${CONTAINER_ID}" ]]; then
  echo "[FATAL] MariaDB container not found running on this host!" >&2
  echo "        Ensure this script is executed on the pinned storage node (swarm-worker03)." >&2
  exit 1
fi

echo "[+] Located MariaDB container: ${CONTAINER_ID}"

# Extract DB credentials from container secret mount
DB_PASSWORD=$(docker exec "${CONTAINER_ID}" cat /run/secrets/db_password)

echo "[+] Executing mariadb-dump with --single-transaction and gzip compression..."
START_TIME=$(date +%s)

docker exec "${CONTAINER_ID}" mariadb-dump \
  -u shopuser \
  -p"${DB_PASSWORD}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  shopdb | gzip -9 > "${BACKUP_FILE}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Generate SHA256 integrity checksum
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"

FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)

echo "[✓] Backup completed in ${DURATION}s. Archive size: ${FILESIZE}"
echo "[✓] Integrity checksum recorded: ${BACKUP_FILE}.sha256"

# Prune archives older than retention window
echo "[+] Pruning backups older than ${RETENTION_DAYS} days..."
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "shopdb_*.sql.gz*" -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
echo "[+] Pruned ${DELETED_COUNT} outdated backup archive(s)."

echo "================================================================="
echo "[✓] Backup cycle completed successfully!"
echo "================================================================="
