# Swarm Node Labels & Placement Constraints

This document specifies the custom node labels applied across the Swarm cluster to enforce workload isolation, storage pinning, and ingress failover.

---

## 1. Applied Node Labels

| Node | Label | Value | Architectural Purpose |
|---|---|---|---|
| `swarm-mgr01` | `ingress` | `true` | Permits Traefik ingress replica 1 to schedule here |
| `swarm-mgr02` | `ingress` | `true` | Permits Traefik ingress replica 2 to schedule here |
| `swarm-worker03` | `storage` | `true` | Pins MariaDB container to the dedicated 80GB persistent storage node |

---

## 2. Applying Labels

Execute these commands from `swarm-mgr01`:

```bash
# 1. Label Ingress Managers
docker node update --label-add ingress=true swarm-mgr01
docker node update --label-add ingress=true swarm-mgr02

# 2. Label Persistent Storage Worker
docker node update --label-add storage=true swarm-worker03
```

---

## 3. Placement Constraints Reference in `docker-stack.yml`

### Traefik Ingress:
Constrained to managers with `ingress=true` to provide 2-node HA across the ingress managers:
```yaml
deploy:
  replicas: 2
  placement:
    constraints:
      - node.labels.ingress == true
```

### MariaDB Database:
Constrained to `storage=true` so the container attaches to the persistent volume on `swarm-worker03`:
```yaml
deploy:
  replicas: 1
  placement:
    constraints:
      - node.labels.storage == true
```

### Frontend & Backend Workloads:
Constrained to general worker nodes to keep managers free of application execution:
```yaml
deploy:
  replicas: 2
  placement:
    constraints:
      - node.role == worker
```

### Redis Cache:
Constrained to any worker node (losing Redis on reschedule is an acceptable tradeoff; data rebuilds from DB):
```yaml
deploy:
  replicas: 1
  placement:
    constraints:
      - node.role == worker
```

---

## 4. Verification

Inspect labels across all nodes simultaneously:

```bash
docker node ls -q | xargs docker node inspect -f '{{.Description.Hostname}}: {{range $k, $v := .Spec.Labels}}{{$k}}={{$v}} {{end}}'
```

Expected output:
```text
swarm-mgr01: ingress=true
swarm-mgr02: ingress=true
swarm-mgr03: 
swarm-worker01: 
swarm-worker02: 
swarm-worker03: storage=true
```
