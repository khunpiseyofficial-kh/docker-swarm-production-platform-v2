# Swarm Worker Nodes Enrollment

This document outlines the procedure for enrolling the 3 worker nodes into the Swarm cluster.

---

## 1. Retrieve Worker Join Token

From `swarm-mgr01`, retrieve the worker join command:
```bash
docker swarm join-token worker
```

---

## 2. Join Worker Nodes

Execute the join command on each worker VM, explicitly specifying its static IP in `--advertise-addr`:

### On `swarm-worker01` (`192.168.0.31`):
```bash
docker swarm join \
  --token <WORKER_TOKEN> \
  --advertise-addr 192.168.0.31 \
  192.168.0.21:2377
```

### On `swarm-worker02` (`192.168.0.32`):
```bash
docker swarm join \
  --token <WORKER_TOKEN> \
  --advertise-addr 192.168.0.32 \
  192.168.0.21:2377
```

### On `swarm-worker03` (`192.168.0.33`):
```bash
docker swarm join \
  --token <WORKER_TOKEN> \
  --advertise-addr 192.168.0.33 \
  192.168.0.21:2377
```

---

## 3. Verification

Return to `swarm-mgr01` and verify all 6 nodes (3 managers, 3 workers) are registered and report `STATUS: Ready`:

```bash
docker node ls
```

Example verified cluster state:
```text
ID                            HOSTNAME         STATUS    AVAILABILITY   MANAGER STATUS   ENGINE VERSION
mgr01id... *                  swarm-mgr01      Ready     Active         Leader           27.x.x
mgr02id...                    swarm-mgr02      Ready     Active         Reachable        27.x.x
mgr03id...                    swarm-mgr03      Ready     Drain          Reachable        27.x.x
wrk01id...                    swarm-worker01   Ready     Active                          27.x.x
wrk02id...                    swarm-worker02   Ready     Active                          27.x.x
wrk03id...                    swarm-worker03   Ready     Active                          27.x.x
```
