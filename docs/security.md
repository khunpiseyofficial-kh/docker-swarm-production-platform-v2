# Security Architecture & Hardening Guide

This document details the zero-trust security controls, network segmentation, secret lifecycle management, and container hardening mechanisms implemented in the platform.

---

## 1. Secrets Management: Fail-Closed Design

Insecure applications often "fail-open" by substituting an insecure default credential (e.g. `root` or `admin`) when an environment variable or secret file is missing. 

In this architecture, both the application code and the underlying database enforce strict **fail-closed** behavior:
- MariaDB uses `MYSQL_ROOT_PASSWORD_FILE` and `MYSQL_PASSWORD_FILE` pointing to `/run/secrets/`. If absent, the database engine aborts startup with exit code 1.
- The Node.js backend implements `readSecretOrFatal()`:
  ```javascript
  export function readSecretOrFatal(secretName, envFallbackName = null) {
    const secretPath = path.join('/run/secrets', secretName);
    if (fs.existsSync(secretPath)) {
      const val = fs.readFileSync(secretPath, 'utf8').trim();
      if (val.length > 0) return val;
    }
    console.error(`[FATAL] Required secret missing: /run/secrets/${secretName}. Terminating immediately (fail-closed).`);
    process.exit(1);
  }
  ```
- Any missing secret immediately crashes the container and surfaces an actionable diagnostic message in the logs, preventing unauthorized execution with default credentials.

---

## 2. Zero-Trust Network Segmentation: Overlay Isolation

Containers communicate across two physically isolated Docker overlay networks with `attachable: false`:

```
[ Ingress: Port 80/443 ]
          │
          ▼
┌──────────────────────────────────────────────┐
│ Traefik Ingress Controller                   │
└──────────────────────┬───────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │   frontend-net (Overlay)  │
         └─────────────┬─────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────┐               ┌──────────────┐
│ Frontend     │               │ Backend API  │
└──────────────┘               └───────┬──────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │   backend-net (Overlay)   │
                         └─────────────┬─────────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
               ┌──────────────┐                ┌──────────────┐
               │ Redis Cache  │                │ MariaDB      │
               └──────────────┘                └──────────────┘
```

### Security Boundaries:
1. **Frontend Cannot Access Databases**: Even if the frontend container were compromised, it cannot resolve or connect to `mariadb:3306` or `redis:6379`.
2. **Databases Have Zero External Exposure**: MariaDB and Redis are not attached to `frontend-net` and publish zero host ports. They are reachable exclusively via `backend-net` by the backend API.
3. **Attachable is Disabled**: Standard containers outside the stack cannot dynamically attach to either overlay network (`attachable: false`).

---

## 3. Container Non-Root Execution

All application containers run with unprivileged user contexts:

- **Backend (Node.js)**:
  - Base image: `node:20-alpine`
  - Explicit user directive: `USER node` (UID 1000).
  - Prevents kernel-level container breakout via root vulnerabilities.
- **Frontend (Web Server)**:
  - Base image: `nginxinc/nginx-unprivileged:alpine` (UID 101).
  - Plain `nginx:alpine` runs the master process as `root` (UID 0); `nginx-unprivileged` runs the master process completely as an unprivileged user, listening on port 8080.
  - Temp directories and PID files are redirected to writable paths in `/tmp`.

---

## 4. Docker Socket Mount Risk Analysis (Traefik Ingress)

Traefik mounts the host's Docker socket `/var/run/docker.sock:ro` to query Docker Swarm service events and discover active routing labels dynamically.

### Threat Modeling & Accepted Tradeoff
- **Risk**: Any container with read access to `docker.sock` can query the Docker API to list containers, inspect environment variables, or extract container metadata. If write access is gained, an attacker possesses effective root control of the host.
- **Mitigation Applied**:
  1. The socket is mounted **read-only** (`:ro`).
  2. Traefik is scheduled exclusively on `swarm-mgr01` and `swarm-mgr02` via `node.labels.ingress == true`, keeping it isolated from application worker nodes.
  3. Traefik does not run general application workloads or untrusted user code.
- **True Production Alternative**: In enterprise production, a Docker socket proxy (such as `tecnativa/docker-socket-proxy`) is deployed between Traefik and the daemon, enforcing an API allowlist that restricts queries strictly to `GET /v1.*/services` and `GET /v1.*/tasks` while rejecting all other endpoints. For this lab platform, the direct read-only mount is an accepted, documented design decision.
