# Complete Platform Deployment Guide

This document provides step-by-step instructions to deploy the entire 8-node infrastructure, private registry, Swarm HA cluster, monitoring stack, and e-commerce microservices from scratch.

---

## Phase 1: Infrastructure Provisioning on ESXi 8

1. **Deploy Gold Master VM (`swarm-mgr01`)**:
   - Install Ubuntu Server 24.04 LTS with 2 vCPU, 4GB RAM, 40GB Disk.
   - Run post-install LVM reclaim:
     ```bash
     sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv && sudo resize2fs /dev/mapper/ubuntu-vg-ubuntu-lv
     ```
   - Place and execute the firewall script:
     ```bash
     sudo /opt/scripts/node-firewall.sh
     ```
   - Power off `swarm-mgr01`.

2. **Clone the Remaining 7 Nodes via ESXi Host Shell**:
   - Follow [infrastructure/vm-specs.md](file:///home/pisey/docker-swarm-production-platform-v2/infrastructure/vm-specs.md) for the `vmkfstools` and `sed` cloning workflow.
   - Power on each clone and execute the **mandatory post-clone checklist**:
     - Regenerate machine-id (`rm /etc/machine-id && systemd-machine-id-setup`)
     - Regenerate SSH host keys (`dpkg-reconfigure openssh-server`)
     - Set hostname (`hostnamectl set-hostname <name>`)
     - Configure static IP in Netplan (`192.168.0.x`) and verify interface name with `ip link show`
     - Expand LVM storage to 100% of the virtual disk.

3. **Distribute `/etc/hosts` to All 8 Nodes**:
   - Copy the host table from [infrastructure/network-plan.md](file:///home/pisey/docker-swarm-production-platform-v2/infrastructure/network-plan.md) to `/etc/hosts` on all machines.

---

## Phase 2: Docker Installation & Private Registry Setup

1. **Install Docker on All 8 Nodes**:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```

2. **Deploy Private Registry on `registry01` (`192.168.0.41`)**:
   ```bash
   ssh root@192.168.0.41
   sudo /opt/scripts/setup-registry.sh
   ```

3. **Distribute Registry CA to All Nodes**:
   ```bash
   sudo /opt/scripts/distribute-ca.sh
   ```

4. **Verify Registry Trust Across Nodes**:
   ```bash
   ssh root@192.168.0.21 "docker login registry01:5000 -u swarmadmin -p SwarmSecurePass2026!"
   ssh root@192.168.0.31 "docker login registry01:5000 -u swarmadmin -p SwarmSecurePass2026!"
   ```

---

## Phase 3: Swarm HA Cluster Formation & Node Labeling

1. **Initialize Swarm on `swarm-mgr01`**:
   ```bash
   ssh root@192.168.0.21
   docker swarm init --advertise-addr 192.168.0.21 --listen-addr 192.168.0.21:2377 --default-addr-pool 10.10.0.0/16 --default-addr-pool-mask-length 24
   ```

2. **Join Secondary Managers (`swarm-mgr02`, `swarm-mgr03`)**:
   - Retrieve manager token: `docker swarm join-token -q manager`
   - Run `docker swarm join --token <TOKEN> --advertise-addr <NODE_IP> 192.168.0.21:2377` on mgr02 and mgr03.

3. **Join Workers (`swarm-worker01`, `swarm-worker02`, `swarm-worker03`)**:
   - Retrieve worker token: `docker swarm join-token -q worker`
   - Run `docker swarm join --token <TOKEN> --advertise-addr <NODE_IP> 192.168.0.21:2377` on all workers.

4. **Apply Role Labels & Availability**:
   ```bash
   # Ingress managers
   docker node update --label-add ingress=true swarm-mgr01
   docker node update --label-add ingress=true swarm-mgr02

   # Pure Raft manager (drained)
   docker node update --availability drain swarm-mgr03

   # Storage pinned worker for MariaDB
   docker node update --label-add storage=true swarm-worker03
   ```

5. **Verify Cluster State**:
   ```bash
   docker node ls
   ```

---

## Phase 4: Standalone Observability Stack on `monitoring01`

1. **Launch Prometheus & Grafana on `monitoring01` (`192.168.0.42`)**:
   ```bash
   ssh root@192.168.0.42
   cd /opt/monitoring
   docker compose -f docker-compose.monitoring.yml up -d
   ```

2. **Launch Node Exporter on `registry01` (`192.168.0.41`)**:
   - See [monitoring/README.md](file:///home/pisey/docker-swarm-production-platform-v2/monitoring/README.md) for the docker run command.

3. **Verify Scrapes**:
   - Visit `http://192.168.0.42:9090/targets` and verify all 8 node-exporter endpoints report `UP`.

---

## Phase 5: Application Build, Secrets, and Stack Deployment

1. **Build and Push Application Images to `registry01`**:
   From `swarm-mgr01`:
   ```bash
   # Build & push backend
   docker build -t registry01:5000/swarm-shop-backend:v1.0.0 application/backend
   docker push registry01:5000/swarm-shop-backend:v1.0.0

   # Build & push frontend
   docker build -t registry01:5000/swarm-shop-frontend:v1.0.0 application/frontend
   docker push registry01:5000/swarm-shop-frontend:v1.0.0
   ```

2. **Generate TLS Certificates and Register Docker Secrets**:
   ```bash
   # Generate certs with SAN for shop.local
   ./traefik/generate-certs.sh

   # Generate random database & JWT secrets
   openssl rand -base64 24 | tr -d '\n' | docker secret create db_root_password -
   openssl rand -base64 24 | tr -d '\n' | docker secret create db_password -
   openssl rand -base64 48 | tr -d '\n' | docker secret create jwt_secret -
   ```

3. **Register Docker Configs**:
   ```bash
   docker config create traefik_static_conf traefik/traefik.yml
   docker config create traefik_dynamic_conf traefik/dynamic.yml
   docker config create mariadb_init_sql application/backend/schema.sql
   ```

4. **Deploy Stack**:
   ```bash
   ./scripts/deploy.sh
   ```

5. **Verify Running Services**:
   ```bash
   docker stack services shop
   ```
   All 7 services (`shop_traefik`, `shop_frontend`, `shop_backend`, `shop_redis`, `shop_mariadb`, `shop_node-exporter`, `shop_cadvisor`) should report `Replicas: 1/1` or `2/2`.

6. **Access Platform**:
   Add `192.168.0.21 shop.local` to your client `/etc/hosts` and open `https://shop.local` in your browser.
