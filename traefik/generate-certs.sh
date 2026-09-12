#!/usr/bin/env bash
# ==============================================================================
# generate-certs.sh — Generate Ingress TLS Certificates with SAN for Traefik v3
# ==============================================================================
# Generates self-signed certificates with explicit Subject Alternative Names (SAN)
# and registers them as Docker Secrets on the Swarm manager.
# ==============================================================================

set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "${CERT_DIR}"

DOMAIN="shop.local"
SAN_CNF="${CERT_DIR}/tls-san.cnf"

echo "================================================================="
echo "[*] Generating Ingress TLS Certificates for ${DOMAIN}"
echo "[*] Target Directory: ${CERT_DIR}"
echo "================================================================="

cat <<EOF > "${SAN_CNF}"
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = req_ext

[dn]
C  = US
ST = State
L  = Lab
O  = SwarmStore
OU = Platform
CN = ${DOMAIN}

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = *.${DOMAIN}
DNS.3 = localhost
IP.1  = 192.168.0.21
IP.2  = 192.168.0.22
IP.3  = 127.0.0.1
EOF

echo "[+] Generating private key and X.509 certificate..."
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout "${CERT_DIR}/shop.local.key" \
  -out "${CERT_DIR}/shop.local.crt" \
  -config "${SAN_CNF}" \
  -extensions req_ext

chmod 600 "${CERT_DIR}/shop.local.key"
chmod 644 "${CERT_DIR}/shop.local.crt"

echo "[✓] Certificate and key created:"
echo "    - Cert: ${CERT_DIR}/shop.local.crt"
echo "    - Key:  ${CERT_DIR}/shop.local.key"

# If running on a Swarm manager, offer to create or update Docker Secrets
if command -v docker >/dev/null 2>&1 && docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q 'active'; then
  echo ""
  echo "[+] Detected active Docker Swarm environment."
  echo "[+] Provisioning Docker Secrets (tls_cert, tls_key)..."

  # Remove existing secrets if present
  docker secret rm tls_cert tls_key 2>/dev/null || true

  docker secret create tls_cert "${CERT_DIR}/shop.local.crt"
  docker secret create tls_key "${CERT_DIR}/shop.local.key"

  echo "[✓] Docker Secrets 'tls_cert' and 'tls_key' created successfully."
else
  echo ""
  echo "[!] Not currently on an active Swarm manager. To create Docker Secrets manually run:"
  echo "    docker secret create tls_cert ${CERT_DIR}/shop.local.crt"
  echo "    docker secret create tls_key ${CERT_DIR}/shop.local.key"
fi

echo "================================================================="
echo "[*] Verification command:"
echo "    openssl x509 -in ${CERT_DIR}/shop.local.crt -text -noout | grep -A 2 'Subject Alternative Name'"
echo "================================================================="
