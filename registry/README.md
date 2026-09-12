# Private Docker Registry (registry01) Architecture & Lifecycle

This document describes the design, configuration, TLS hardening, and end-to-end verification lifecycle for the private Docker registry deployed on standalone node `registry01` (`192.168.0.41:5000`).

---

## 1. Registry Architecture & Security Model

The registry operates as a standalone container outside the Swarm cluster to avoid circular dependencies (e.g. Swarm nodes requiring images from a registry that is hosted on the Swarm itself).

```
                      ┌────────────────────────┐
                      │ registry01             │
                      │ (192.168.0.41)         │
                      │                        │
                      │  ┌──────────────────┐  │
                      │  │  registry:2      │  │
                      │  │  Port 5000       │  │
                      │  │  - TLS (SAN)     │  │
                      │  │  - htpasswd Auth │  │
                      │  └────────┬─────────┘  │
                      │           │            │
                      │  ┌────────┴─────────┐  │
                      │  │ /opt/registry    │  │
                      │  │  ├── certs/      │  │
                      │  │  ├── auth/       │  │
                      │  │  └── data/       │  │
                      │  └──────────────────┘  │
                      └───────────▲────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         │ Push Image                              │ Pull Image
         │ (docker push)                           │ (docker pull)
┌────────┴─────────┐                      ┌────────┴─────────┐
│ swarm-mgr01      │                      │ swarm-worker01   │
│ (192.168.0.21)   │                      │ (192.168.0.31)   │
└──────────────────┘                      └──────────────────┘
```

### Key Security Decisions
1. **Self-Signed TLS with Explicit SAN**: Modern Docker daemons strictly reject certificates lacking `Subject Alternative Name` (SAN) extensions, returning `x509: certificate relies on legacy Common Name field, use SANs instead`. The OpenSSL config explicitly maps `DNS.1 = registry01` and `IP.1 = 192.168.0.41`.
2. **Basic Authentication (htpasswd)**: The registry requires bcrypt-hashed credentials for all catalog queries, pulls, and pushes.
3. **Dedicated Trust Store (`/etc/docker/certs.d/`)**: Rather than installing the self-signed CA into the OS-wide root CA bundle, the CA is placed inside `/etc/docker/certs.d/registry01:5000/ca.crt` on each node. This isolates trust strictly to the Docker daemon.

---

## 2. Automated Deployment

### Step 1: Execute Registry Setup on `registry01`
```bash
# Log into registry01
ssh root@192.168.0.41

# Run the automated setup script
sudo /opt/scripts/setup-registry.sh
```

### Step 2: Distribute CA Certificate to All Nodes
From an administrative node or `registry01`:
```bash
sudo /opt/scripts/distribute-ca.sh
```

---

## 3. Mandatory End-to-End Verification Lifecycle

> [!CRITICAL]
> Never consider private registry setup complete based on a successful `docker push` alone. Push operations write layers; pull operations across other nodes validate TLS trust, network routing, DNS resolution, and authentication token verification.

### Phase 1: Authentication from `swarm-mgr01`
SSH into `swarm-mgr01`:
```bash
ssh root@192.168.0.21

# Authenticate against the registry
docker login registry01:5000 -u swarmadmin -p SwarmSecurePass2026!
# Expected output: Login Succeeded
```

### Phase 2: Build, Tag & Push from `swarm-mgr01`
```bash
# Tag a lightweight test image
docker pull alpine:3.20
docker tag alpine:3.20 registry01:5000/test-probe:v1

# Push to private registry
docker push registry01:5000/test-probe:v1
# Verify all layers push and receive sha256 digests
```

### Phase 3: Query the Catalog API via HTTPS
```bash
curl -u swarmadmin:SwarmSecurePass2026! \
  --cacert /etc/docker/certs.d/registry01:5000/ca.crt \
  https://registry01:5000/v2/_catalog

# Expected output:
# {"repositories":["test-probe"]}
```

### Phase 4: Pull and Run from a Different Node (`swarm-worker01`)
SSH into `swarm-worker01`:
```bash
ssh root@192.168.0.31

# Authenticate
docker login registry01:5000 -u swarmadmin -p SwarmSecurePass2026!

# Pull image pushed by mgr01
docker pull registry01:5000/test-probe:v1

# Execute test container
docker run --rm registry01:5000/test-probe:v1 echo "Registry verification SUCCESSFUL!"
```

Once Phase 4 executes without certificate warnings or pull failures, the private registry infrastructure is certified ready for production workloads.
