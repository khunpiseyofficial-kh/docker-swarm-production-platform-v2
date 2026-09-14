# Engineering Troubleshooting Runbook & Postmortem Log

This runbook documents 10 genuine, evidence-based technical incidents, bugs, and edge cases encountered, root-caused, and remediated during the design and validation of this platform. Each entry preserves the real symptoms, diagnostic steps, root causes, and permanent resolutions.

---

## Index of Incidents

1. [UFW vs iptables-persistent Reboot Race Condition](#1-ufw-vs-iptables-persistent-reboot-race-condition)
2. [Blanket `iptables -X` / `iptables -F` Breaking Docker Host-Mode Publishing](#2-blanket-iptables--x--iptables--f-breaking-docker-host-mode-publishing)
3. [Alpine musl libc IPv6 Resolution in Nginx Healthchecks](#3-alpine-musl-libc-ipv6-resolution-in-nginx-healthchecks)
4. [Nginx Dynamic Swarm DNS Resolution and `$request_uri` Path Forwarding Bug](#4-nginx-dynamic-swarm-dns-resolution-and-request_uri-path-forwarding-bug)
5. [Traefik v3 Swarm Provider Syntax Breaking Change](#5-traefik-v3-swarm-provider-syntax-breaking-change)
6. [Swarm Manager Drain vs Traefik Ingress Scheduling Deadlock](#6-swarm-manager-drain-vs-traefik-ingress-scheduling-deadlock)
7. [node-redis v4 Silent Infinite Reconnect Hang](#7-node-redis-v4-silent-infinite-reconnect-hang)
8. [Ubuntu Server 24.04 LVM 50% Capacity Stranding](#8-ubuntu-server-2404-lvm-50-capacity-stranding)
9. [Docker Engine Rejection of Private Registry Certs Missing SAN](#9-docker-engine-rejection-of-private-registry-certs-missing-san)
10. [Swarm `update_config` Monitor Window Shorter than Healthcheck Start Period](#10-swarm-update_config-monitor-window-shorter-than-healthcheck-start-period)
11. [cAdvisor Crash on Startup with Unsupported `kmem` Metric Flag](#11-cadvisor-crash-on-startup-with-unsupported-kmem-metric-flag)

---

## 1. UFW vs iptables-persistent Reboot Race Condition

### Symptom
After applying firewall rules on a worker node and rebooting the VM to verify persistence, all overlay networking on that node failed. Containers could ping local loopback, but could not reach containers on other nodes across `frontend-net` or `backend-net`. `docker service logs` showed connection timeouts between Backend and MariaDB.

### Diagnostic Steps
1. Inspected active iptables rules on the live node post-reboot:
   ```bash
   sudo iptables -S INPUT
   ```
2. Observed that custom rules allowing VXLAN (`4789/udp`) and Gossip (`7946/tcp+udp`) were completely missing, replaced by UFW default chain jumps (`-j ufw-before-input`).
3. Checked systemd boot logs:
   ```bash
   journalctl -u netfilter-persistent -u ufw -b
   ```
4. **Findings**: `netfilter-persistent` loaded `/etc/iptables/rules.v4` early in the boot sequence. Approximately 2 seconds later, `ufw.service` started, flushed user tables, and re-applied its own restrictive default policies, silently overriding the Swarm firewall rules.

### Root Cause
System-level conflict between two competing netfilter managers. Ubuntu 24.04 enables UFW by default, which conflicts with `iptables-persistent`.

### Permanent Fix
Purge UFW from all nodes and standardize exclusively on raw `iptables-persistent`:
```bash
sudo ufw disable
sudo apt-get purge -y ufw
sudo /opt/scripts/node-firewall.sh
sudo netfilter-persistent save
```

---

## 2. Blanket `iptables -X` / `iptables -F` Breaking Docker Host-Mode Publishing

### Symptom
After executing a firewall cleanup script, all services publishing ports in `mode: host` (specifically `node-exporter` on `:9100` and `cAdvisor` on `:8080`) became completely unreachable from external scrape hosts. Prometheus logged `context deadline exceeded` for all targets.

### Diagnostic Steps
1. Verified `node-exporter` containers were still running:
   ```bash
   docker ps | grep node-exporter
   ```
2. Tested local port binding on the node itself:
   ```bash
   curl http://127.0.0.1:9100/metrics # Succeeded!
   ```
3. Tested remote reachability from another VM:
   ```bash
   curl http://192.168.0.31:9100/metrics # Connection timed out / dropped!
   ```
4. Inspected iptables user-defined chains:
   ```bash
   sudo iptables -L DOCKER-USER -n
   # Returned: iptables: No chain/target/match by that name.
   ```

### Root Cause
The cleanup script executed `iptables -X` (delete user chains) and `iptables -F` (blanket flush). This destroyed the Docker daemon's internal netfilter routing architecture (`DOCKER`, `DOCKER-USER`, `DOCKER-INGRESS`). Docker does not automatically recreate these chains until the daemon is restarted.

### Permanent Fix
1. Immediate recovery:
   ```bash
   sudo systemctl restart docker
   ```
2. Enforced script policy in `scripts/node-firewall.sh`: Never call `iptables -X` or blanket `iptables -F`. Only flush `INPUT` and `FORWARD` explicitly:
   ```bash
   iptables -F INPUT
   iptables -F FORWARD
   ```

---

## 3. Alpine musl libc IPv6 Resolution in Nginx Healthchecks

### Symptom
The `frontend` service in `docker-stack.yml` continually cycled through crash/restart loops. `docker service ps shop_frontend` showed tasks failing every 30 seconds with `task: health check exceeded timeout` or `unhealthy`, despite Nginx starting normally.

### Diagnostic Steps
1. Inspected container healthcheck logs:
   ```bash
   docker inspect <container_id> --format='{{json .State.Health}}' | jq .
   ```
   Log snippet: `wget: can't connect to remote host (::1): Connection refused`.
2. Executed interactive shell inside the container:
   ```bash
   docker exec -it <container_id> sh
   wget -q -O - http://localhost:8080/nginx-health
   # Failed: Connection refused to ::1
   wget -q -O - http://127.0.0.1:8080/nginx-health
   # Succeeded: returned 200 OK
   ```

### Root Cause
Alpine Linux utilizes `musl libc`, which resolves `localhost` to IPv6 `::1` before IPv4 `127.0.0.1`. Nginx was configured with `listen 0.0.0.0:8080;` (IPv4 only). When `wget http://localhost:8080` executed, it attempted connection to `::1:8080`, which refused connection.

### Permanent Fix
In `application/frontend/Dockerfile` and `nginx.conf`, always use explicit IPv4 `127.0.0.1` in all container healthchecks:
```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/nginx-health || exit 1
```

---

## 4. Nginx Dynamic Swarm DNS Resolution and `$request_uri` Path Forwarding Bug

### Symptom
When accessing `https://shop.local/api/products` through the frontend Nginx reverse-proxy, the browser received the React `index.html` file instead of product JSON. Alternatively, when `proxy_pass` was configured with a variable, requests to `/api/products` and `/api/cart` both returned the exact same payload.

### Diagnostic Steps
1. Examined Nginx `proxy_pass` directive:
   ```nginx
   resolver 127.0.0.11 valid=10s;
   set $upstream "http://backend:3000";
   proxy_pass $upstream;
   ```
2. Checked Backend API access logs:
   ```bash
   docker service logs shop_backend
   ```
   Observed that incoming requests were received as `GET /` instead of `GET /api/products`!

### Root Cause
In standard Nginx syntax, when `proxy_pass` uses a static string with a URI (e.g. `proxy_pass http://backend:3000/api/`), Nginx performs URI normalization. **However, when `proxy_pass` targets a variable (`$upstream`), Nginx disables automatic URI rewriting entirely and forwards only the bare hostname unless `$request_uri` is appended explicitly**.

### Permanent Fix
Updated `application/frontend/nginx.conf`:
```nginx
location /api/ {
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $backend_upstream "http://backend:3000";
    # CRITICAL: Append $request_uri explicitly when using a variable upstream!
    proxy_pass $backend_upstream$request_uri;
}
```

---

## 5. Traefik v3 Swarm Provider Syntax Breaking Change

### Symptom
Upon upgrading Traefik from v2 to v3 in the stack file, Traefik started but failed to discover any Swarm services. Frontend and backend returned `404 Not Found`.

### Diagnostic Steps
1. Inspected Traefik container startup logs:
   ```bash
   docker service logs shop_traefik
   ```
2. Output revealed:
   ```text
   command-line flag provided but not defined: -providers.docker.swarmMode
   ```

### Root Cause
Traefik v3 completely refactored the Docker provider, splitting Docker Compose/Engine and Docker Swarm into two separate providers. The legacy flag `--providers.docker.swarmMode=true` was deprecated and removed.

### Permanent Fix
Updated `traefik/traefik.yml` and stack command flags to the official v3 Swarm provider syntax:
```yaml
providers:
  swarm:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: "shop_frontend-net"
```

---

## 6. Swarm Manager Drain vs Traefik Ingress Scheduling Deadlock

### Symptom
When deploying the stack with 2 Traefik replicas, both tasks remained stuck in `Pending` state indefinitely. The application was externally unreachable on ports 80 and 443.

### Diagnostic Steps
1. Inspected service task status:
   ```bash
   docker service ps shop_traefik --no-trunc
   ```
2. Swarm error message:
   ```text
   no suitable node (scheduling constraint not satisfied on 6 nodes; 3 nodes have availability 'drain')
   ```
3. Checked node status:
   ```bash
   docker node ls
   ```
   All 3 managers had `AVAILABILITY: Drain` (configured per best practice to prevent managers from executing workloads).

### Root Cause
Docker Swarm's `Availability: Drain` state strictly forbids the node from accepting **any** new task, completely overriding service placement constraints (such as `node.role == manager`). If all managers are drained, no service can schedule on them.

### Permanent Fix
Implemented the targeted ingress exception:
1. Keep `swarm-mgr03` as `Drain` (pure Raft consensus member).
2. Set `swarm-mgr01` and `swarm-mgr02` to `Active` and label them with `ingress=true`:
   ```bash
   docker node update --availability active swarm-mgr01 swarm-mgr02
   docker node update --label-add ingress=true swarm-mgr01
   docker node update --label-add ingress=true swarm-mgr02
   ```
3. Constrain Traefik to `node.labels.ingress == true` and all application workloads to `node.role == worker`.

---

## 7. node-redis v4 Silent Infinite Reconnect Hang

### Symptom
During a test where the `redis` container was killed, HTTP requests to `/api/products` hung indefinitely until the client timed out (30s+), instead of quickly failing back to the database.

### Diagnostic Steps
1. Verified MariaDB was healthy and queries completed in < 5ms.
2. Traced the Node.js Express process during Redis unavailability:
   - Node.js did not throw an unhandled rejection.
   - The promise returned by `redisClient.get('products:all')` remained pending indefinitely.

### Root Cause
By default, `node-redis` v4 has `offlineQueue: true`. When disconnected, every command issued is buffered in memory in anticipation of reconnection. The default reconnect strategy retries indefinitely without rejecting queued commands.

### Permanent Fix
In `application/backend/src/redis.js`:
1. Disabled the offline queue: `disableOfflineQueue: true`.
2. Configured an explicit socket connection timeout: `connectTimeout: 2000`.
3. Capped reconnection retries to 5 attempts before backing off:
```javascript
export const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 500, 3000))
  },
  disableOfflineQueue: true
});
```
4. Wrapped all cache operations in try/catch blocks that log warnings and immediately fall through to MariaDB.

---

## 8. Ubuntu Server 24.04 LVM 50% Capacity Stranding

### Symptom
During a data loading test on `swarm-worker03` (provisioned with an 80GB virtual disk in ESXi), MariaDB crashed with:
```text
[ERROR] mysqld: Disk full (/var/lib/mysql/...); waiting for someone to free some space... (errno: 28 "No space left on device")
```

### Diagnostic Steps
1. Checked filesystem utilization:
   ```bash
   df -h /
   ```
   Reported: `Filesystem: /dev/mapper/ubuntu-vg-ubuntu-lv | Size: 38G | Used: 38G (100%)`.
2. Checked physical volume and volume group sizing:
   ```bash
   sudo vgs
   sudo lvs
   ```
   Reported: Volume Group `ubuntu-vg` had 80 GB total, with **41 GB unallocated free space**!

### Root Cause
Ubuntu Server's Subiquity installer allocates only ~50% of the volume group by default, keeping the remainder free for snapshots.

### Permanent Fix
Expanded the logical volume and filesystem online without downtime:
```bash
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
sudo resize2fs /dev/mapper/ubuntu-vg-ubuntu-lv
df -h / # Confirms full 80GB capacity online
```
This procedure was standardized as a mandatory post-provisioning step across all 8 nodes in `infrastructure/vm-specs.md`.

---

## 9. Docker Engine Rejection of Private Registry Certs Missing SAN

### Symptom
When attempting `docker login registry01:5000` from `swarm-mgr01`, Docker failed with:
```text
Error response from daemon: Get "https://registry01:5000/v2/": x509: certificate relies on legacy Common Name field, use SANs instead
```

### Diagnostic Steps
1. Inspected the generated certificate on `registry01`:
   ```bash
   openssl x509 -in /opt/registry/certs/registry.crt -text -noout | grep -A 2 "Subject Alternative Name"
   ```
2. Result was empty: the certificate had only `CN = registry01` without an `X509v3 Subject Alternative Name` extension.

### Root Cause
Go's `crypto/x509` package and modern Docker daemons completely disregard the Common Name (CN) field and strictly mandate Subject Alternative Name (SAN) extensions for hostname and IP verification.

### Permanent Fix
Updated `scripts/setup-registry.sh` with a dedicated OpenSSL configuration (`san.cnf`) explicitly declaring:
```ini
[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = registry01
DNS.2 = localhost
IP.1  = 192.168.0.41
IP.2  = 127.0.0.1
```
Re-generated the certificate and distributed it to `/etc/docker/certs.d/registry01:5000/ca.crt`.

---

## 10. Swarm `update_config` Monitor Window Shorter than Healthcheck Start Period

### Symptom
During a rolling update drill, a test image with a broken startup bug was rolled out. Despite the container crashing 10 seconds into boot, Swarm continued updating the remaining replicas, replacing all healthy containers and causing a complete service outage.

### Diagnostic Steps
1. Inspected the service spec:
   ```yaml
   update_config:
     parallelism: 1
     delay: 10s
     monitor: 5s # Default Swarm monitor period
   healthcheck:
     start_period: 15s # Container grace period
   ```
2. Traced Swarm update engine logic:
   - Replica 1 launched.
   - Swarm evaluated `monitor` for 5 seconds. Because the container was still inside its 15s `start_period`, the healthcheck was in `starting` status (which Swarm considers non-failing).
   - After 5 seconds, Swarm decided Replica 1 was "healthy" and proceeded to kill and replace Replica 2.
   - At second 16, Replica 1's healthcheck executed and failed, but Replica 2 was already being replaced.

### Root Cause
The Swarm `update_config.monitor` duration was **shorter** than the container healthcheck `start_period`.

### Permanent Fix
In `stack/docker-stack.yml`, configured `monitor` to **25s**, strictly longer than the 15s `start_period`:
```yaml
update_config:
  parallelism: 1
  delay: 10s
  order: start-first
  failure_action: pause
  monitor: 25s # Must be > healthcheck start_period (15s)
```
Now, Swarm monitors the task until the healthcheck actually evaluates and confirms positive health before updating the next replica.

---

## 11. cAdvisor Crash on Startup with Unsupported `kmem` Metric Flag

### Symptom
All `shop_cadvisor` global tasks on manager and worker nodes crashed immediately upon container startup with `task: non-zero exit (2)`. `docker service ls` showed `shop_cadvisor` with `0/6` replicas running.

### Diagnostic Steps
1. Inspected task failure details:
   ```bash
   docker service ps shop_cadvisor --no-trunc
   ```
   Observed repeated failures across all nodes reporting `Failed X seconds ago "task: non-zero exit (2)"`.
2. Checked service logs:
   ```bash
   docker service logs shop_cadvisor 2>&1 | grep -i "invalid"
   ```
   Found the explicit fatal error:
   ```text
   invalid value "advtcp,process,kmem" for flag -disable_metrics: unsupported metric "kmem" specified
   ```
   Followed by cAdvisor printing the full command-line help flags and exiting with code 2.
3. Tested supported options against the container:
   ```bash
   docker run --rm gcr.io/cadvisor/cadvisor:v0.49.1 --help 2>&1 | grep -A 2 "disable_metrics"
   ```
   Confirmed `kmem` was deprecated and eliminated from supported metric groups in cAdvisor v0.49+.

### Root Cause
Passing `--disable_metrics=advtcp,process,kmem` in `stack/docker-stack.yml`. Go's `flag` parser treats any unrecognized option in a flag list as an unrecoverable validation error, terminating the process with status 2 before cAdvisor initializes.

### Permanent Fix
In `stack/docker-stack.yml`, removed `,kmem` from the `--disable_metrics` argument:
```yaml
cadvisor:
  image: gcr.io/cadvisor/cadvisor:v0.49.1
  command:
    - '--docker_only=true'
    - '--housekeeping_interval=10s'
    - '--disable_metrics=advtcp,process'
```
Re-deployed the stack; all 6 `cadvisor` instances immediately stabilized in `Running` state and began exporting metrics on `:8080/metrics`.
