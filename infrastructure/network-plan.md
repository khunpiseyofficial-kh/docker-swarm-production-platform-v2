# Network Topology & Port Allocation Plan

This document describes the IP addressing scheme, local name resolution, Docker Swarm overlay network segmentation, and port mapping matrix for the production-like platform.

---

## 1. Physical / Management Subnet (`192.168.0.0/24`)

The cluster nodes communicate across an isolated flat layer-2 segment attached to ESXi `vSwitch0` ("VM Network").

- **CIDR**: `192.168.0.0/24`
- **Subnet Mask**: `255.255.255.0`
- **Default Gateway**: `192.168.0.1`
- **Broadcast**: `192.168.0.255`

### Node IP Allocations

| Hostname | Role | IP Address | Primary Services Hosted |
|---|---|---|---|
| `swarm-mgr01` | Manager 1 | `192.168.0.21` | Swarm Leader/Raft, Traefik Ingress (Replica 1) |
| `swarm-mgr02` | Manager 2 | `192.168.0.22` | Swarm Quorum, Traefik Ingress (Replica 2) |
| `swarm-mgr03` | Manager 3 | `192.168.0.23` | Swarm Quorum (Pure Manager / Drained) |
| `swarm-worker01`| Worker 1 | `192.168.0.31` | Frontend, Backend API tasks |
| `swarm-worker02`| Worker 2 | `192.168.0.32` | Frontend, Backend API, Redis tasks |
| `swarm-worker03`| Worker 3 | `192.168.0.33` | MariaDB (`storage=true`), App tasks |
| `registry01` | Standalone Registry | `192.168.0.41` | Docker Registry v2 (`:5000`), Node Exporter |
| `monitoring01` | Standalone Observability| `192.168.0.42` | Prometheus (`:9090`), Grafana (`:3000`) |

---

## 2. Local DNS & Host Resolution (`/etc/hosts`)

Because this environment operates without an internal enterprise DNS server, all 8 nodes maintain a consistent `/etc/hosts` mapping. This ensures internal API communication, node-to-node management, and private registry verification succeed without relying on external resolvers.

Append the following block to `/etc/hosts` across **all 8 nodes**:

```text
# --- Swarm HA Cluster Hosts ---
192.168.0.21    swarm-mgr01
192.168.0.22    swarm-mgr02
192.168.0.23    swarm-mgr03
192.168.0.31    swarm-worker01
192.168.0.32    swarm-worker02
192.168.0.33    swarm-worker03

# --- Platform Support Services ---
192.168.0.41    registry01
192.168.0.42    monitoring01

# --- Ingress FQDN ---
192.168.0.21    shop.local
192.168.0.22    shop.local
```

> **Client Resolution**: When testing ingress from an external workstation (laptop/desktop on the `192.168.0.0/24` subnet), add `192.168.0.21 shop.local` to the client's `/etc/hosts` file.

---

## 3. Docker Swarm Overlay Networks

To enforce zero-trust defense-in-depth, the application architecture partitions containers across two isolated overlay networks using Docker VXLAN encapsulation (`4789/udp`).

```
[ Internet / Clients ]
         │
         ▼ (Port 80/443 Routing Mesh)
┌───────────────────────────────────────────────┐
│ Traefik Ingress (Replicas: 2)                 │
└──────────────────────┬────────────────────────┘
                       │
       ┌───────────────┴──────────────┐
       │     frontend-net (Overlay)   │
       └───────┬───────────────┬──────┘
               ▼               ▼
     ┌──────────────────┐  ┌──────────────────┐
     │ Frontend (React) │  │ Backend API      │
     └──────────────────┘  └────────┬─────────┘
                                    │
       ┌────────────────────────────┴─────────┐
       │     backend-net (Overlay)            │
       └───────┬───────────────────────┬──────┘
               ▼                       ▼
     ┌──────────────────┐  ┌──────────────────┐
     │ Redis Cache      │  │ MariaDB Storage  │
     └──────────────────┘  └──────────────────┘
```

### Network Definitions

| Network Name | Driver | Scope | Subnet Pool | Encryption | Interconnected Services |
|---|---|---|---|---|---|
| `frontend-net` | `overlay` | Swarm | `10.10.1.0/24` | Default VXLAN | Traefik, Frontend, Backend API |
| `backend-net` | `overlay` | Swarm | `10.10.2.0/24` | Default VXLAN | Backend API, Redis Cache, MariaDB |

### Network Isolation Guarantees
1. **Frontend Isolation**: Frontend cannot reach Redis or MariaDB. It communicates solely with client browsers and the backend.
2. **Database Isolation**: MariaDB and Redis are absent from `frontend-net`. They have no route to Traefik or the outside world.
3. **Ingress Protection**: Traefik cannot access backend data stores directly, preventing direct exposure in the event of an ingress reverse-proxy exploit.

---

## 4. Port Allocation Matrix

### Physical / Host Level Ports

| Port / Protocol | Direction | Source | Destination | Purpose |
|---|---|---|---|---|
| `22/tcp` | Inbound | Admin Subnet | All Nodes | SSH Remote Administration |
| `80/tcp` | Inbound | Any / LAN | `swarm-mgr01`, `swarm-mgr02` | Traefik HTTP Ingress (Redirects to HTTPS) |
| `443/tcp` | Inbound | Any / LAN | `swarm-mgr01`, `swarm-mgr02` | Traefik HTTPS Ingress (TLS Termination) |
| `2377/tcp` | Inbound | `192.168.0.0/24` | Swarm Managers | Swarm Cluster Management (Raft) |
| `7946/tcp+udp` | Inbound | `192.168.0.0/24` | All Swarm Nodes | Swarm Node Gossip & State Synchronization |
| `4789/udp` | Inbound | `192.168.0.0/24` | All Swarm Nodes | VXLAN Overlay Network Data Plane |
| `5000/tcp` | Inbound | `192.168.0.0/24` | `registry01` | Docker Private Registry v2 (TLS + Auth) |
| `9090/tcp` | Inbound | `192.168.0.0/24` | `monitoring01` | Prometheus Web UI and HTTP API |
| `3000/tcp` | Inbound | `192.168.0.0/24` | `monitoring01` | Grafana Dashboards |
| `9100/tcp` | Inbound | `192.168.0.0/24` | All Nodes | Node Exporter host-mode metrics scrape |
| `8080/tcp` | Inbound | `192.168.0.0/24` | Swarm Nodes | cAdvisor host-mode container metrics scrape |
| `ICMP (ping)` | Inbound | `192.168.0.0/24` | All Nodes | Network connectivity verification & latency testing |
