#!/usr/bin/env bash
# ==============================================================================
# availability-probe.sh — Continuous Availability & Latency Monitoring Probe
# ==============================================================================
# Usage:
#   ./scripts/availability-probe.sh
#   ./scripts/availability-probe.sh https://shop.local/api/products
#
# Purpose:
#   Run during rolling updates (scripts/update.sh) and failure injection scenarios
#   to empirically measure downtime, latency spikes, and error rates.
# ==============================================================================

set -uo pipefail

TARGET_URL="${1:-https://shop.local/api/products}"
INTERVAL="${INTERVAL:-0.3}" # Delay in seconds between requests

TOTAL_REQUESTS=0
SUCCESS_REQUESTS=0
FAILED_REQUESTS=0

echo "================================================================="
echo "[*] Continuous Availability Probe Active"
echo "[*] Target URL: ${TARGET_URL}"
echo "[*] Probe Interval: ${INTERVAL}s"
echo "[*] Press [Ctrl+C] at any time to generate summary report."
echo "================================================================="

print_summary() {
  echo ""
  echo "================================================================="
  echo "PROBE SUMMARY REPORT"
  echo "================================================================="
  echo "Total Requests:      ${TOTAL_REQUESTS}"
  echo "Successful (200 OK): ${SUCCESS_REQUESTS}"
  echo "Failed / Dropped:    ${FAILED_REQUESTS}"

  if [[ ${TOTAL_REQUESTS} -gt 0 ]]; then
    AVAILABILITY=$(awk "BEGIN {printf \"%.2f\", (${SUCCESS_REQUESTS}/${TOTAL_REQUESTS})*100}")
    echo "Availability SLA:    ${AVAILABILITY}%"
  fi
  echo "================================================================="
  exit 0
}

trap print_summary SIGINT SIGTERM

while true; do
  TOTAL_REQUESTS=$((TOTAL_REQUESTS + 1))
  TIMESTAMP=$(date +"%Y-%m-%dT%H:%M:%S.%3N")

  # Perform probe using curl with custom output format
  # Insecure (-k) is used to support internal self-signed TLS certificates
  RESPONSE=$(curl -k -s -o /dev/null -w "%{http_code}|%{time_total}|%{remote_ip}" --connect-timeout 2 --max-time 5 "${TARGET_URL}" || echo "000|0.000|none")

  HTTP_CODE=$(echo "${RESPONSE}" | cut -d'|' -f1)
  DURATION_SEC=$(echo "${RESPONSE}" | cut -d'|' -f2)
  DURATION_MS=$(awk "BEGIN {printf \"%.1f\", ${DURATION_SEC}*1000}")
  IP=$(echo "${RESPONSE}" | cut -d'|' -f3)

  if [[ "${HTTP_CODE}" == "200" ]]; then
    SUCCESS_REQUESTS=$((SUCCESS_REQUESTS + 1))
    echo "[${TIMESTAMP}] HTTP 200 OK | Latency: ${DURATION_MS}ms | Ingress IP: ${IP}"
  else
    FAILED_REQUESTS=$((FAILED_REQUESTS + 1))
    echo "[${TIMESTAMP}] [ALERT] HTTP ${HTTP_CODE} ERROR | Latency: ${DURATION_MS}ms | Ingress IP: ${IP}" >&2
  fi

  sleep "${INTERVAL}"
done
