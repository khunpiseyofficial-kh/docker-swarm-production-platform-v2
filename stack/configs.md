# Docker Configs Provisioning

This document outlines the provisioning of non-sensitive configuration files managed via Docker Swarm Configs.

---

## 1. Managed Configs

| Config Name | Source File | Target Container Path | Purpose |
|---|---|---|---|
| `traefik_static_conf` | `traefik/traefik.yml` | `/etc/traefik/traefik.yml` | Traefik entrypoints, Swarm provider, ping/api |
| `traefik_dynamic_conf` | `traefik/dynamic.yml` | `/etc/traefik/dynamic/dynamic.yml` | Ingress TLS certificate store mapping |
| `mariadb_init_sql` | `application/backend/schema.sql` | `/docker-entrypoint-initdb.d/01-init.sql` | Database schema initialization and product seeds |

---

## 2. Provisioning Commands

Execute on `swarm-mgr01` prior to launching the stack:

```bash
# 1. Create Traefik Static Configuration
docker config create traefik_static_conf traefik/traefik.yml

# 2. Create Traefik Dynamic TLS Configuration
docker config create traefik_dynamic_conf traefik/dynamic.yml

# 3. Create MariaDB Initialization Schema
docker config create mariadb_init_sql application/backend/schema.sql
```

### Inspect Provisioned Configs:
```bash
docker config ls
```

Expected output:
```text
ID                          NAME                    DRIVER    CREATED          UPDATED
8x7w6v5u...                 mariadb_init_sql                  3 minutes ago    3 minutes ago
9y8x7w6v...                 traefik_dynamic_conf              3 minutes ago    3 minutes ago
0z9y8x7w...                 traefik_static_conf               3 minutes ago    3 minutes ago
```

---

## 3. Updating Configurations in Swarm

Docker Configs in Swarm are immutable once attached to running services. To roll out an updated configuration:

```bash
# 1. Create a versioned config
docker config create traefik_dynamic_conf_v2 traefik/dynamic.yml

# 2. Update the service to swap configs
docker service update \
  --config-rm traefik_dynamic_conf \
  --config-add source=traefik_dynamic_conf_v2,target=/etc/traefik/dynamic/dynamic.yml \
  shop_traefik
```
