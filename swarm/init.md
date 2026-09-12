# Docker Swarm Cluster Initialization

This guide documents the bootstrapping procedure for the 3-Manager, 3-Worker Docker Swarm HA cluster.

---

## 1. Bootstrapping on First Manager (`swarm-mgr01`)

Log into `swarm-mgr01` (`192.168.0.21`):

```bash
ssh root@192.168.0.21
```

Initialize the Swarm control plane. We specify both `--advertise-addr` (the address other nodes use to communicate with this node) and `--listen-addr` (the IP and port the Swarm daemon listens on):

```bash
docker swarm init \
  --advertise-addr 192.168.0.21 \
  --listen-addr 192.168.0.21:2377 \
  --default-addr-pool 10.10.0.0/16 \
  --default-addr-pool-mask-length 24
```

> **Note on `--default-addr-pool`**: Setting the default address pool to `10.10.0.0/16` with a mask length of `24` guarantees that every overlay network receives a clean `/24` block (e.g. `10.10.1.0/24`, `10.10.2.0/24`), eliminating collisions with the host's `192.168.0.0/24` network.

---

## 2. Retrieving Cluster Join Tokens

Immediately after initialization, retrieve the join tokens for additional managers and workers:

```bash
# Print Manager Join Token
docker swarm join-token manager

# Print Worker Join Token
docker swarm join-token worker
```

To view the raw token strings without the helper text:
```bash
MANAGER_TOKEN=$(docker swarm join-token -q manager)
WORKER_TOKEN=$(docker swarm join-token -q worker)
echo "Manager Token: ${MANAGER_TOKEN}"
echo "Worker Token:  ${WORKER_TOKEN}"
```

Keep these tokens secure. Any node possessing the manager token can join the cluster with root orchestration privileges.
