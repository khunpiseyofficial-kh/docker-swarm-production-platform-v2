# System Architecture & Topology

This document details the hardware infrastructure, hypervisor virtualization layer, Docker Swarm clustering model, network segmentation, and data durability topology.

---

## 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Hypervisor["VMware ESXi 8.0 Standalone (128GB RAM / 64 vCPUs / 1.5TB SSD)"]
        subgraph Subnet["Subnet: 192.168.0.0/24 (vSwitch0 'VM Network')"]

            subgraph Managers["Swarm HA Control Plane (Raft Quorum)"]
                mgr01["swarm-mgr01\n(192.168.0.21)\nLeader / Ingress"]
                mgr02["swarm-mgr02\n(192.168.0.22)\nQuorum / Ingress"]
                mgr03["swarm-mgr03\n(192.168.0.23)\nQuorum (Drained)"]
            end

            subgraph Workers["Swarm Compute Workers"]
                wrk01["swarm-worker01\n(192.168.0.31)\nFrontend / Backend"]
                wrk02["swarm-worker02\n(192.168.0.32)\nFrontend / Backend / Redis"]
                wrk03["swarm-worker03\n(192.168.0.33)\nMariaDB (storage=true)"]
            end

            subgraph Platform["Standalone Platform Services"]
                reg01["registry01\n(192.168.0.41)\nPrivate Registry (SAN TLS)"]
                mon01["monitoring01\n(192.168.0.42)\nPrometheus + Grafana"]
            end

        end
    end

    mgr01 <-->|Raft 2377/tcp| mgr02
    mgr02 <-->|Raft 2377/tcp| mgr03
    mgr01 <-->|Raft 2377/tcp| mgr03

    Managers <-->|Gossip 7946 & VXLAN 4789| Workers
    mon01 -.->|Scrape :9100/:8080| Managers
    mon01 -.->|Scrape :9100/:8080| Workers
    mon01 -.->|Scrape :9100| reg01
    Workers -.->|Pull Images :5000| reg01
```

---

## 2. Ingress & Overlay Network Flow

```mermaid
flowchart TD
    Client["Client Browser (HTTPS / shop.local)"] --> IngressMesh["Docker Swarm Routing Mesh (Port 80/443)"]

    subgraph IngressTier["Ingress Tier (node.labels.ingress == true)"]
        IngressMesh --> Traefik1["Traefik v3 Replica 1 (swarm-mgr01)"]
        IngressMesh --> Traefik2["Traefik v3 Replica 2 (swarm-mgr02)"]
    end

    subgraph OverlayFrontend["frontend-net (Overlay 10.10.1.0/24)"]
        Traefik1 -->|Host: shop.local| Frontend["React SPA (Nginx Unprivileged :8080)"]
        Traefik2 -->|Host: shop.local| Frontend
        Traefik1 -->|Path: /api (Priority 100)| Backend["Node.js API (:3000)"]
        Traefik2 -->|Path: /api (Priority 100)| Backend
        Frontend -.->|Dynamic Proxy /api| Backend
    end

    subgraph OverlayBackend["backend-net (Overlay 10.10.2.0/24)"]
        Backend -->|Cache-Aside 60s TTL| Redis["Redis 7 (AOF Durability)"]
        Backend -->|ACID Persistence| MariaDB["MariaDB 11.4 (:3306)"]
    end

    subgraph StorageTier["Persistent Storage Node (swarm-worker03)"]
        MariaDB --> NamedVol[("Named Volume: mariadb-data\n(/var/lib/mysql)")]
    end
```

---

## 3. Core Architectural Decisions & Tradeoffs

| Component | Design Selection | Production Tradeoff / Justification |
|---|---|---|
| **Swarm Managers** | 3-Node Quorum (`mgr01`, `mgr02`, `mgr03`) | Tolerates 1 node failure without quorum loss. Minimizes Raft chatter while maintaining high availability. |
| **Ingress Routing** | `mode: ingress` with 2 replicas on managers | Trades client IP visibility for automated failover across managers via the Swarm routing mesh. |
| **Ingress Placement** | `node.labels.ingress == true` on `mgr01` & `mgr02` | Resolves the Swarm Manager Drain deadlock by providing an explicit, minimal exception to run Traefik on managers while keeping app tasks on workers. |
| **Stateful Database** | Pinned to `swarm-worker03` (`storage=true`) | Limits MariaDB to 1 replica on the dedicated storage node. Protects against container failure, but not physical node loss. |
| **Cache Tier** | Redis Cache-Aside with Graceful Fallback | Redis read/write failures do not 500 or hang HTTP requests; backend falls through to MariaDB. Offline queuing disabled to avoid infinite reconnect hangs. |
| **Observability** | Standalone VM (`monitoring01`) | Prevents monitoring failure cascades if Swarm overlay or quorum destabilizes. |
| **Container Security** | Non-root execution (`node`, `nginx`) | Prevents container breakout exploits by running processes with unprivileged UIDs. |
