#!/usr/bin/env bash
# ==============================================================================
# setup-registry.sh — Deploy Private Docker Registry with SAN TLS & Auth
# ==============================================================================
# Target Node: registry01 (192.168.0.41)
# Features:
#   - Generates OpenSSL certificate with explicit Subject Alternative Name (SAN)
#   - Sets up htpasswd basic authentication
#   - Configures official registry:2 container with persistence
#   - Populates local Docker daemon cert trust store
# ==============================================================================

set -euo pipefail

REGISTRY_IP="192.168.0.41"
REGISTRY_HOST="registry01"
REGISTRY_PORT="5000"
REGISTRY_DIR="/opt/registry"
REGISTRY_USER="${REGISTRY_USER:-swarmadmin}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-SwarmSecurePass2026!}"

if [[ $EUID -ne 0 ]]; then
  echo "[FATAL] This script must be executed as root (sudo)." >&2
  exit 1
fi

echo "================================================================="
echo "[*] Setting up Secure Docker Private Registry on ${REGISTRY_HOST}"
echo "[*] Address: ${REGISTRY_IP}:${REGISTRY_PORT}"
echo "[*] Auth User: ${REGISTRY_USER}"
echo "================================================================="

# Install dependencies: openssl, apache2-utils (htpasswd), curl
apt-get update -qq
apt-get install -y -qq openssl apache2-utils curl

# Create required directories
mkdir -p "${REGISTRY_DIR}/data"
mkdir -p "${REGISTRY_DIR}/certs"
mkdir -p "${REGISTRY_DIR}/auth"

# Step 1: Generate OpenSSL SAN Configuration
echo "[+] Creating OpenSSL SAN configuration..."
cat <<EOF > "${REGISTRY_DIR}/certs/san.cnf"
[req]
default_bits       = 4096
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = req_ext

[dn]
C  = US
ST = State
L  = Lab
O  = SwarmPlatform
OU = Infrastructure
CN = ${REGISTRY_HOST}

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${REGISTRY_HOST}
DNS.2 = localhost
IP.1  = ${REGISTRY_IP}
IP.2  = 127.0.0.1
EOF

# Step 2: Generate Self-Signed Certificate with SAN
echo "[+] Generating private key and TLS certificate with SAN..."
openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
  -keyout "${REGISTRY_DIR}/certs/registry.key" \
  -out "${REGISTRY_DIR}/certs/registry.crt" \
  -config "${REGISTRY_DIR}/certs/san.cnf" \
  -extensions req_ext

chmod 600 "${REGISTRY_DIR}/certs/registry.key"
chmod 644 "${REGISTRY_DIR}/certs/registry.crt"

# Step 3: Create htpasswd Authentication File
echo "[+] Creating htpasswd credentials..."
htpasswd -B -b -c "${REGISTRY_DIR}/auth/htpasswd" "${REGISTRY_USER}" "${REGISTRY_PASSWORD}"
chmod 600 "${REGISTRY_DIR}/auth/htpasswd"

# Step 4: Configure Local Docker Engine Trust
echo "[+] Configuring local Docker engine trust in /etc/docker/certs.d/..."
LOCAL_CERT_DIR="/etc/docker/certs.d/${REGISTRY_HOST}:${REGISTRY_PORT}"
mkdir -p "${LOCAL_CERT_DIR}"
cp "${REGISTRY_DIR}/certs/registry.crt" "${LOCAL_CERT_DIR}/ca.crt"

# Step 5: Start or Update the registry:2 container
echo "[+] Launching Docker Registry container..."
if docker ps -a --format '{{.Names}}' | grep -q '^registry$'; then
  echo "[!] Existing registry container found. Removing..."
  docker rm -f registry
fi

docker run -d \
  --name registry \
  --restart always \
  --publish "${REGISTRY_PORT}:5000" \
  -v "${REGISTRY_DIR}/data:/var/lib/registry" \
  -v "${REGISTRY_DIR}/certs:/certs:ro" \
  -v "${REGISTRY_DIR}/auth:/auth:ro" \
  -e "REGISTRY_AUTH=htpasswd" \
  -e "REGISTRY_AUTH_HTPASSWD_REALM=Swarm Registry Realm" \
  -e "REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd" \
  -e "REGISTRY_HTTP_TLS_CERTIFICATE=/certs/registry.crt" \
  -e "REGISTRY_HTTP_TLS_KEY=/certs/registry.key" \
  registry:2

# Step 6: Validate registry health
echo "[+] Verifying registry TLS and authentication..."
sleep 2

curl -s -k -u "${REGISTRY_USER}:${REGISTRY_PASSWORD}" \
  "https://${REGISTRY_IP}:${REGISTRY_PORT}/v2/_catalog" || {
    echo "[ERROR] Registry failed initial catalog query!" >&2
    exit 1
  }

echo ""
echo "================================================================="
echo "[✓] Docker Registry is RUNNING and HEALTHY!"
echo "[*] CA Certificate: ${REGISTRY_DIR}/certs/registry.crt"
echo "[*] Distribute this certificate to all Swarm nodes using:"
echo "    ./scripts/distribute-ca.sh"
echo "================================================================="
