# Node Firewall Architecture & Netfilter Rules

This document outlines the firewall design, explains critical gotchas with Docker and Ubuntu's UFW, and provides the specifications for the cluster-wide `node-firewall.sh` script.

---

## 1. Why Raw iptables? The UFW + iptables-persistent Reboot Conflict

During a previous build cycle, an insidious race condition was identified when using Ubuntu's standard `ufw` alongside `iptables-persistent`:

```
               ┌──────────────────────────┐
               │    System Boot / Reboot  │
               └─────────────┬────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   netfilter-persistent.service           ufw.service
   (Restores custom Swarm rules)       (Restores UFW chains)
            │                                 │
            ▼                                 ▼
   Rules loaded into iptables         UFW silently flushes and
                                      overrides custom rules!
                                              │
                                              ▼
                                      Swarm VXLAN (4789/udp)
                                      and Gossip (7946) BLOCKED!
```

### The Conflict Mechanism
1. `iptables-persistent` loads rules early during boot from `/etc/iptables/rules.v4`.
2. `ufw` starts subsequently via systemd. When UFW initializes, it tears down and reconstructs its own application chains (`ufw-before-input`, `ufw-user-input`, etc.).
3. This lifecycle collision silently overrides, truncates, or resets the policies configured for Swarm overlay VXLAN, Raft consensus, and host-mode metrics scraping.
4. While rules appear functional on a live system, the cluster catastrophically partitions upon host reboot.

### The Rule of Thumb
**Do not install or enable UFW.** Standardize completely on raw `iptables` managed exclusively by `iptables-persistent` / `netfilter-persistent`.

```bash
# Ensure UFW is completely disabled and uninstalled
sudo ufw disable
sudo apt-get purge -y ufw
```

---

## 2. Docker Chain Preservation: The Danger of `iptables -X` and Blanket `iptables -F`

Docker injects custom netfilter chains into the `filter` and `nat` tables to facilitate container networking and port publishing:
- `DOCKER`
- `DOCKER-USER`
- `DOCKER-INGRESS`
- `DOCKER-ISOLATION-STAGE-1` / `DOCKER-ISOLATION-STAGE-2`

### The Critical Failure Mode
- Running `iptables -X` deletes **all user-defined chains**, including Docker's active runtime chains.
- Running a blanket `iptables -F` without specifying a chain flushes Docker's routing chains alongside the OS chains.
- **Result**: Every container publishing ports in `mode: host` or `mode: ingress` stops receiving traffic immediately. The only remedy is to restart the Docker daemon (`sudo systemctl restart docker`) to recreate the chains.

### Safe Flush Command
Only flush the native OS chains individually:
```bash
# SAFE: Flushes only the standard system chains
sudo iptables -F INPUT
sudo iptables -F FORWARD

# DANGEROUS: Never run these on Docker hosts!
# sudo iptables -F      <-- Destroys DOCKER chains
# sudo iptables -X      <-- Deletes DOCKER chains
```

---

## 3. Firewall Policy Specifications

- **Default Policies**:
  - `INPUT`: `DROP` (strict zero-trust ingress)
  - `FORWARD`: `DROP` (prevent unauthorized routing; Docker manages its own forward rules in `DOCKER-USER` / `FORWARD`)
  - `OUTPUT`: `ACCEPT` (unrestricted outbound for package updates, NTP time sync, and container image pulls)

- **Standard Inbound Allowlist**:
  1. Loopback interface: `lo` (`127.0.0.1`, `::1`)
  2. Established & Related state tracking (`ctstate ESTABLISHED,RELATED`)
  3. SSH (`22/tcp`) from any or management subnet
  4. Swarm Control Plane (`2377/tcp`) from `192.168.0.0/24`
  5. Swarm Node Gossip (`7946/tcp` and `7946/udp`) from `192.168.0.0/24`
  6. Swarm VXLAN Data Plane (`4789/udp`) from `192.168.0.0/24`
  7. Public Web Ingress (`80/tcp`, `443/tcp`) open to all
  8. Host Monitoring Scrapes (`9100/tcp` node-exporter, `8080/tcp` cadvisor) from `192.168.0.0/24`
  9. ICMP Echo Request (`ping`) from `192.168.0.0/24`

- **Role-Specific Additions**:
  - `registry01`: `5000/tcp` (Docker Registry) from `192.168.0.0/24`
  - `monitoring01`: `9090/tcp` (Prometheus) and `3000/tcp` (Grafana) from `192.168.0.0/24`

---

## 4. Post-Reboot Verification Procedure

Never trust an iptables configuration based solely on live terminal output. Always execute an end-to-end reboot test:

```bash
# 1. Apply rules using the automated script
sudo bash /opt/scripts/node-firewall.sh

# 2. Persist rules
sudo netfilter-persistent save

# 3. Reboot the VM
sudo reboot

# 4. Post-reboot: verify rules are intact and DOCKER chains are preserved
sudo iptables -S INPUT
sudo iptables -L DOCKER-USER -n -v

# 5. Verify connectivity:
# Test SSH from jumpbox
# Test ping from another cluster node
# Verify Swarm cluster health (docker node ls)
```
