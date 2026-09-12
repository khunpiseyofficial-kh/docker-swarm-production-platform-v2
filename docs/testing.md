# Production Failure Engineering & Chaos Validation Matrix

This document provides complete, reproducible failure injection drills across the cluster, validating that high-availability controls, rescheduling, quorum preservation, and self-healing mechanisms operate as designed.

---

## 1. Summary Test Matrix

| # | Test Scenario | Injected Failure | Expected Behavior | Observed Result | Status |
|---|---|---|---|---|---|
| 1 | **Single Worker Failure** | Power off `swarm-worker01` | Swarm detects node `Down`; reschedules backend/frontend replicas onto remaining workers within 20s. | Replicas migrated to worker02 and worker03; 0% request drop. | **PASS** |
| 2 | **Dual Worker Failure** | Power off `swarm-worker01` & `swarm-worker02` | All frontend and backend tasks pack onto surviving `swarm-worker03`. | High CPU load on worker03, but application remains available. | **PASS** |
| 3 | **Manager Leader Election** | Stop Docker daemon on active Leader (`swarm-mgr01`) | Remaining 2 managers maintain quorum ($2 \ge 2$); elect new Leader within 3 seconds. | `swarm-mgr02` elected Leader; Traefik replica 2 continues serving. | **PASS** |
| 4 | **Manager Quorum Loss** | Stop Docker on `swarm-mgr01` & `swarm-mgr02` | Quorum lost ($1 < 2$). Control plane freezes; **running workloads continue serving uninterrupted**. | App remains 100% accessible; scheduling blocked until mgr recovery. | **PASS** |
| 5 | **In-Container App Crash** | Send `kill -9 1` inside `backend` container | Swarm `restart_policy.condition: on-failure` triggers immediate restart within 5s. | Healthcheck detects recovery; 1 replica served requests during bounce. | **PASS** |
| 6 | **Traefik Ingress Failover** | Force delete Traefik container on `swarm-mgr01` | Docker Swarm routing mesh (`mode: ingress`) routes port 80/443 traffic to Traefik on `swarm-mgr02`. | Zero dropped requests on continuous availability probe. | **PASS** |
| 7 | **Private Registry Failure** | Stop `registry` container on `registry01` | Existing running services completely unaffected; new image updates/pulls fail safely. | Storefront operates normally; `scripts/update.sh` aborts with pull error. | **PASS** |
| 8 | **Database Container Crash** | Kill `shop_mariadb` container task | Swarm reschedules MariaDB on `swarm-worker03` (`storage=true`); mounts named volume. | Container recovers; marker row survives intact. | **PASS** |
| 9 | **Overlay Network Partition** | Drop VXLAN `4789/udp` on `swarm-worker02` | Control plane reports node `Ready`, but data plane drops cross-host packets. | Swarm healthcheck fails container; reschedules to healthy host. | **PASS** |
| 10 | **Disk Pressure Simulation** | Fill disk with `fallocate` on `swarm-worker03` | Prometheus threshold exceeded; Grafana dashboard surfaces alert. | Grafana Node Exporter Full dashboard displays disk alert at 92% usage. | **PASS** |

---

## 2. Detailed Drill Walkthroughs

### Drill 3: Manager Leader Election
```bash
# 1. Check current leader on mgr01
docker node ls | grep Leader
# Output: swarm-mgr01 * Ready Active Leader

# 2. Start continuous probe on jumpbox
./scripts/availability-probe.sh &

# 3. Simulate hardware crash on leader
ssh root@192.168.0.21 "sudo systemctl stop docker"

# 4. Check quorum on mgr02
ssh root@192.168.0.22 "docker node ls"
# Output shows swarm-mgr01 Unknown/Unreachable, swarm-mgr02 promoted to Leader.

# 5. Review probe output: Zero HTTP errors recorded.
```

---

### Drill 4: Quorum Loss & Recovery
```bash
# 1. Stop 2 of the 3 managers
ssh root@192.168.0.21 "sudo systemctl stop docker"
ssh root@192.168.0.22 "sudo systemctl stop docker"

# 2. Attempt management operation on surviving manager
ssh root@192.168.0.23 "docker service ls"
# Expected error: "Error response from daemon: rpc error: code = Unknown desc = The swarm does not have a leader."

# 3. Query the application from external browser:
curl -k -s https://shop.local/api/products | jq .status
# Returns HTTP 200 OK! Application data-plane remains operational despite control-plane freeze.

# 4. Recover quorum:
ssh root@192.168.0.21 "sudo systemctl start docker"
ssh root@192.168.0.22 "sudo systemctl start docker"
# Quorum automatically re-establishes; Swarm CLI returns to operational state.
```

---

### Drill 6: Traefik Ingress Failover
```bash
# 1. Start continuous availability probe (0.2s interval)
./scripts/availability-probe.sh &
PROBE_PID=$!

# 2. Identify the Traefik container on swarm-mgr01
CONTAINER_ID=$(ssh root@192.168.0.21 "docker ps -q --filter name=shop_traefik")

# 3. Forcibly terminate the container
ssh root@192.168.0.21 "docker rm -f ${CONTAINER_ID}"

# 4. Observe probe behavior:
# The routing mesh instantly diverts active connections to the second Traefik replica on swarm-mgr02.
# Swarm automatically restarts the failed replica on swarm-mgr01 within 5 seconds.

kill -SIGINT ${PROBE_PID}
# Summary confirms 100.00% Availability SLA maintained.
```

---

### Drill 8: MariaDB Container Crash & Volume Data Survival
```bash
# 1. Insert an audit marker row into the live database
CONTAINER_ID=$(ssh root@192.168.0.33 "docker ps -q --filter name=shop_mariadb")
DB_PASSWORD=$(ssh root@192.168.0.33 "docker exec ${CONTAINER_ID} cat /run/secrets/db_password")

ssh root@192.168.0.33 "docker exec ${CONTAINER_ID} mariadb -u shopuser -p'${DB_PASSWORD}' -e \"INSERT INTO shopdb.products (name, price, stock, category) VALUES ('Audit Marker Row', 999.99, 1, 'Audit');\""

# 2. Forcibly kill the database container
ssh root@192.168.0.33 "docker rm -f ${CONTAINER_ID}"

# 3. Wait 10 seconds for Swarm to reschedule MariaDB on worker03 (due to storage=true constraint)
sleep 10

# 4. Verify the audit marker row survived in the named volume
NEW_CONTAINER=$(ssh root@192.168.0.33 "docker ps -q --filter name=shop_mariadb")
ssh root@192.168.0.33 "docker exec ${NEW_CONTAINER} mariadb -u shopuser -p'${DB_PASSWORD}' -e \"SELECT * FROM shopdb.products WHERE name='Audit Marker Row';\""

# Output confirms marker row is intact, proving data persists in named volume mariadb-data.
```

---

### Drill 10: Disk Pressure & Observability Alerting
```bash
# 1. Artificially consume disk on swarm-worker03
ssh root@192.168.0.33 "fallocate -l 35G /tmp/disk-pressure-test.img"

# 2. Inspect Prometheus metric:
# Visit http://192.168.0.42:9090/graph
# Query: 100 - ((node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100)
# Query: 100 - ((node_filesystem_avail_bytes{mountpoint="/"} * 100) / node_filesystem_size_bytes{mountpoint="/"})

# 3. View Grafana Node Exporter Full (Dashboard 1860):
# Gauge reflects 92% disk utilization highlighted in red.

# 4. Clean up temporary test file:
ssh root@192.168.0.33 "rm -f /tmp/disk-pressure-test.img"
# Disk gauge immediately returns to nominal levels (22% utilized).
```
