# Monitoring & Observability Stack

This directory contains the configurations and deployment specifications for the observability stack running on standalone host `monitoring01` (`192.168.0.42`).

---

## 1. Architectural Strategy: Isolated Observability

In production architectures, running monitoring services inside the exact compute cluster they observe creates dangerous failure cascades:
- If Swarm quorum is lost or VXLAN networking breaks, Prometheus cannot collect metrics or trigger alerts.
- High container churn or OOM events on worker nodes can starve Prometheus and Grafana.

**Solution**: `monitoring01` operates as a dedicated standalone VM outside the Swarm cluster. It scrapes Swarm nodes via their physical management IPs (`192.168.0.0/24`) using host-mode published ports:
- **Node Exporter**: Port `9100/tcp` (mode: host on Swarm + standalone on `registry01` and `monitoring01`)
- **cAdvisor**: Port `8080/tcp` (mode: host on Swarm nodes)

```
┌───────────────────────────────────────────────┐
│ monitoring01 (192.168.0.42)                   │
│                                               │
│  ┌──────────────────────┐  ┌────────────────┐ │
│  │ Prometheus (:9090)   │◄─┤ Grafana (:3000)│ │
│  │ --web.enable-lifecycle│  └────────────────┘ │
│  └──────────┬───────────┘                     │
└─────────────┼─────────────────────────────────┘
              │
   ┌──────────┴───────────┬─────────────────────┐
   ▼ :9100 / :8080        ▼ :9100 / :8080       ▼ :9100
┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
│ swarm-mgr01..03      ││ swarm-worker01..03   ││ registry01           │
│ (NodeExp + cAdvisor) ││ (NodeExp + cAdvisor) ││ (NodeExp standalone) │
└──────────────────────┘└──────────────────────┘└──────────────────────┘
```

---

## 2. Deploying on `monitoring01`

SSH into `monitoring01`:
```bash
ssh root@192.168.0.42
cd /opt/monitoring
```

Launch the standalone monitoring stack:
```bash
docker compose -f docker-compose.monitoring.yml up -d
```

Verify services:
```bash
docker compose -f docker-compose.monitoring.yml ps
```

---

## 3. Deploying Node Exporter on `registry01`

To achieve 100% host coverage, run a lightweight standalone node-exporter container on `registry01`:

```bash
ssh root@192.168.0.41

docker run -d \
  --name node-exporter \
  --restart always \
  --net="host" \
  --pid="host" \
  -v "/proc:/host/proc:ro" \
  -v "/sys:/host/sys:ro" \
  -v "/:/rootfs:ro,rslave" \
  prom/node-exporter:v1.12.1 \
  --path.procfs=/host/proc \
  --path.sysfs=/host/sys \
  --path.rootfs=/host/root
```

---

## 4. Hot-Reloading Prometheus Configuration

Prometheus was started with `--web.enable-lifecycle`. Whenever `prometheus.yml` is modified to add or adjust scrape targets, reload configuration instantly without restarting the container:

```bash
curl -X POST http://localhost:9090/-/reload
```

Check the target statuses:
- Navigate to: `http://192.168.0.42:9090/targets`
- All 8 host endpoints should report state `UP`.

---

## 5. Grafana Dashboards

1. Navigate to: `http://192.168.0.42:3000`
2. Login credentials:
   - **Username**: `admin`
   - **Password**: `SwarmMetrics2026!`
3. **Import Recommended Community Dashboards**:
   - **Node Exporter Full**: Dashboard ID `1860` (provides comprehensive CPU, RAM, disk I/O, network bandwidth, and temperature metrics for all 8 nodes).
   - **cAdvisor Container Monitoring**: Dashboard ID `14282` or `893` (tracks per-container CPU throttling, memory limits, and container restart rates across the Swarm).
