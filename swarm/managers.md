# Swarm Managers, Raft Quorum & Ingress Scheduling

This document details the configuration of the 3-node Swarm manager quorum, Raft consensus mechanics, and the resolution of the Manager Drain vs Ingress scheduling conflict.

---

## 1. Joining Secondary Managers (`swarm-mgr02`, `swarm-mgr03`)

From `swarm-mgr01`, retrieve the manager join token:
```bash
docker swarm join-token manager
```

### On `swarm-mgr02` (`192.168.0.22`):
```bash
docker swarm join \
  --token <MANAGER_TOKEN> \
  --advertise-addr 192.168.0.22 \
  192.168.0.21:2377
```

### On `swarm-mgr03` (`192.168.0.23`):
```bash
docker swarm join \
  --token <MANAGER_TOKEN> \
  --advertise-addr 192.168.0.23 \
  192.168.0.21:2377
```

Verify quorum on `swarm-mgr01`:
```bash
docker node ls
```
Expected output shows 3 managers with one `Leader` and two `Reachable` members:
```text
ID                            HOSTNAME        STATUS    AVAILABILITY   MANAGER STATUS   ENGINE VERSION
abc123... *                   swarm-mgr01     Ready     Active         Leader           27.x.x
def456...                     swarm-mgr02     Ready     Active         Reachable        27.x.x
ghi789...                     swarm-mgr03     Ready     Active         Reachable        27.x.x
```

---

## 2. Raft Consensus Mechanics & Quorum Math

Docker Swarm utilizes the Raft consensus algorithm for maintaining cluster state across manager nodes.

| Managers ($N$) | Quorum Needed ($\lfloor N/2 \rfloor + 1$) | Max Tolerated Failures |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| **3** | **2** | **1** |
| 5 | 3 | 2 |

### Fault Scenarios:
- **1 Manager Fails**: Quorum of 2 remains ($2 \ge 2$). If the failed node was the Leader, the remaining two hold an election, elect a new Leader, and cluster orchestration proceeds without interruption.
- **2 Managers Fail**: Quorum is lost ($1 < 2$). Surviving worker nodes and existing running tasks **continue serving traffic**, but the Swarm control plane is frozen: no new services can be deployed, no scale events occur, and unhealthy containers cannot be rescheduled until quorum is restored or disaster recovery forced (`docker swarm init --force-new-cluster`).

---

## 3. The Manager Drain vs Ingress Scheduling Conflict

### The Architectural Conflict
Best practices dictate that Swarm managers should not run application containers, preventing CPU/memory exhaustion from destabilizing the Raft consensus engine. This is normally achieved by setting managers to `Availability: Drain`:
```bash
# Common practice:
docker node update --availability drain swarm-mgr01
```

**However, this causes a fatal scheduling failure for Traefik Ingress**:
1. When a node is in `Drain` state, the Swarm scheduler rejects **ALL** new service tasks, even if the service specifies `node.role == manager` as a placement constraint.
2. If all managers are drained, Traefik cannot bind to managers, forcing it to run on worker nodes.
3. Placing ingress on workers either exposes workers directly to perimeter traffic or requires additional external load balancers.

### The Solution: Targeted Ingress Exception
We resolve this conflict by establishing a deliberate, documented exception:

1. **`swarm-mgr03`** is dedicated purely to Raft management and set to `Drain`:
   ```bash
   docker node update --availability drain swarm-mgr03
   ```

2. **`swarm-mgr01`** and **`swarm-mgr02`** remain `Active` but are labeled with `ingress=true`:
   ```bash
   docker node update --label-add ingress=true swarm-mgr01
   docker node update --label-add ingress=true swarm-mgr02
   ```

3. **Placement Constraints in `docker-stack.yml`**:
   - Traefik is constrained strictly to `node.labels.ingress == true`.
   - All backend, frontend, database, and cache services are constrained to `node.role == worker`.

```
Manager 1 (Active, ingress=true)  ──► Runs: Raft Leader/Follower + Traefik Replica 1
Manager 2 (Active, ingress=true)  ──► Runs: Raft Follower       + Traefik Replica 2
Manager 3 (Drain, pure manager)   ──► Runs: Raft Follower only (No workloads)
Workers 1-3 (Active, role=worker) ──► Runs: Frontend, Backend, Redis, MariaDB
```

This guarantees that application workloads cannot steal resources from managers, while Traefik maintains high-availability ingress across two manager nodes with automated failover.
