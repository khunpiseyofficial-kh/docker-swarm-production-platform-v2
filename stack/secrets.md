# Docker Secrets Provisioning & Fail-Closed Validation

This document defines the secrets architecture, provisioning workflows, and fail-closed validation procedures for the platform.

---

## 1. Secrets Architecture in Docker Swarm

In Docker Swarm mode:
- Secrets are stored encrypted at rest inside the Raft distributed log across manager nodes.
- Secrets are decrypted only when a task is scheduled on a specific node and mounted exclusively into an ephemeral, in-memory `tmpfs` filesystem at `/run/secrets/<secret_name>`.
- Workers never possess secrets for services they are not actively executing.

### Managed Secrets

| Secret Name | Consumed By | Purpose | Fail-Closed Enforcement |
|---|---|---|---|
| `db_root_password` | `mariadb` | MariaDB DBA root authentication | Yes (MariaDB crashes on init if absent) |
| `db_password` | `mariadb`, `backend` | Application user DB password | Yes (`readSecretOrFatal()` exits code 1) |
| `jwt_secret` | `backend` | Token signature cryptographic key | Yes (`readSecretOrFatal()` exits code 1) |
| `tls_cert` | `traefik` | Ingress SSL/TLS public certificate | Yes (Traefik file provider fails to bind) |
| `tls_key` | `traefik` | Ingress SSL/TLS private key | Yes (Traefik file provider fails to bind) |

---

## 2. Provisioning Commands

Execute on `swarm-mgr01` prior to launching the stack:

```bash
# 1. Generate strong database passwords
openssl rand -base64 24 | tr -d '\n' | docker secret create db_root_password -
openssl rand -base64 24 | tr -d '\n' | docker secret create db_password -

# 2. Generate strong 512-bit JWT cryptographic signing secret
openssl rand -base64 48 | tr -d '\n' | docker secret create jwt_secret -

# 3. Create TLS secrets from generated certificates (traefik/generate-certs.sh)
docker secret create tls_cert traefik/certs/shop.local.crt
docker secret create tls_key traefik/certs/shop.local.key
```

### Inspect Provisioned Secrets:
```bash
docker secret ls
```
Expected output:
```text
ID                          NAME               DRIVER    CREATED         UPDATED
1a2b3c4d...                 db_password                  2 minutes ago   2 minutes ago
2b3c4d5e...                 db_root_password             2 minutes ago   2 minutes ago
3c4d5e6f...                 jwt_secret                   2 minutes ago   2 minutes ago
4d5e6f7a...                 tls_cert                     1 minute ago    1 minute ago
5e6f7a8b...                 tls_key                      1 minute ago    1 minute ago
```

---

## 3. Negative Testing: Fail-Closed Security Validation

A core production requirement is ensuring application containers **fail-closed** (crash immediately with an actionable fatal log line) rather than falling back to an insecure default password if a secret is omitted.

### Execution Procedure:

#### 1. Spin up a backend test replica missing the `jwt_secret`:
```bash
docker service create \
  --name test_failclosed \
  --secret db_password \
  --network shop_backend-net \
  --restart-condition none \
  registry01:5000/swarm-shop-backend:v1.0.0
```

#### 2. Inspect container termination status:
```bash
docker service ps test_failclosed
```
Output confirms task exited with code 1:
```text
NAME                     IMAGE                                NODE            DESIRED STATE   CURRENT STATE
test_failclosed.1        registry01:5000/swarm-shop-backend   swarm-worker01  Shutdown        Failed 10 seconds ago "task: non-zero exit (1)"
```

#### 3. Inspect container logs for actionable FATAL message:
```bash
docker service logs test_failclosed
```
Confirmed log output:
```text
[FATAL] Required secret missing: /run/secrets/jwt_secret (or env JWT_SECRET). Terminating immediately (fail-closed).
```

#### 4. Clean up test service:
```bash
docker service rm test_failclosed
```

This negative test proves that the application cannot run in an insecure, secret-less configuration.
