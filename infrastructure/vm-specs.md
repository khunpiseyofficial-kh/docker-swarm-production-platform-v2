# Infrastructure Specification & VM Provisioning Guide

This document defines the physical hardware topology, VM resource sizing, cloning procedures, and post-provisioning hardening steps for the 8-node lab running on VMware ESXi 8.

---

## 1. Physical Host & Hypervisor Specifications

| Parameter | Specification | Notes |
|---|---|---|
| **Hypervisor** | VMware ESXi 8.0 (Free / Standalone) | No vCenter Server; managed via Web UI and SSH shell |
| **Physical CPU** | 64 Logical Cores (vCPU) | Capable of hosting all 8 VMs concurrently |
| **Physical RAM** | 128 GB DDR4 ECC | Ample memory for OS, containers, MariaDB, and Redis caches |
| **Storage Datastore** | 1.5 TB SSD Datastore | Thin-provisioned VMDKs |
| **Virtual Switch** | Standard vSwitch (`vSwitch0`) | Port group: `VM Network`, Uplink: `vmnic0` |
| **Network Subnet** | `192.168.0.0/24` | Gateway: `192.168.0.1`, DNS: `192.168.0.1` + public fallback |

---

## 2. Virtual Machine Matrix

All virtual machines run **Ubuntu Server 24.04 LTS (Noble Numbat)** with 64-bit architecture.

| VM Name | Role | vCPU | RAM | Disk | Static IP | MAC Address Pattern |
|---|---|---|---|---|---|---|
| `swarm-mgr01` | Swarm Manager (Leader Candidate / Ingress) | 2 | 4 GB | 40 GB | `192.168.0.21` | Static / ESXi Generated |
| `swarm-mgr02` | Swarm Manager (Quorum / Ingress) | 2 | 4 GB | 40 GB | `192.168.0.22` | Static / ESXi Generated |
| `swarm-mgr03` | Swarm Manager (Quorum) | 2 | 4 GB | 40 GB | `192.168.0.23` | Static / ESXi Generated |
| `swarm-worker01` | Swarm Worker (App Workloads) | 4 | 8 GB | 60 GB | `192.168.0.31` | Static / ESXi Generated |
| `swarm-worker02` | Swarm Worker (App Workloads) | 4 | 8 GB | 60 GB | `192.168.0.32` | Static / ESXi Generated |
| `swarm-worker03` | Swarm Worker (`storage=true` MariaDB) | 4 | 8 GB | **80 GB min** | `192.168.0.33` | Static / ESXi Generated |
| `registry01` | Private Registry (Standalone TLS) | 2 | 4 GB | 60 GB | `192.168.0.41` | Static / ESXi Generated |
| `monitoring01` | Prometheus + Grafana (Standalone) | 2 | 4 GB | 40 GB | `192.168.0.42` | Static / ESXi Generated |

> **Total Resource Allocation**: 22 vCPUs, 44 GB RAM, 420 GB Disk. Fits comfortably within the host's 64 vCPU / 128 GB RAM budget with plenty of headroom for bursts and caching.

---

## 3. Storage Reclamation Gotcha: Ubuntu 24.04 LVM Under-Allocation

### The Problem
The default Ubuntu Server Subiquity installer configures Logical Volume Management (LVM) with a conservative allocation policy, typically provisioning only 50% of the volume group to the root logical volume (`ubuntu-lv`), leaving the remaining storage unallocated in the volume group. If uncorrected, disks report full even when half the physical virtual disk is empty.

### Mandatory Post-Install Command (Run on ALL 8 nodes)
Immediately following initial boot or post-clone initialization, inspect and expand the root logical volume to 100% of the available volume group space:

```bash
# 1. Inspect existing Volume Groups and Logical Volumes
sudo vgs
sudo lvs

# 2. Extend the root logical volume to consume 100% of free extents
sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv

# 3. Resize the underlying ext4 filesystem online without unmounting
sudo resize2fs /dev/mapper/ubuntu-vg-ubuntu-lv

# 4. Verify full capacity is reflected
df -h /
```

Ensure `df -h /` reflects the complete allocated VMDK disk size (e.g. 40GB, 60GB, or 80GB) before proceeding to software installation.

---

## 4. ESXi 8 Standalone VM Cloning Workflow

Free/standalone ESXi disables the vCenter GUI clone action. To provision the cluster rapidly and identically, build `swarm-mgr01` as the gold master image (OS, updates, base packages, firewall script placed, SSH keys), power it off, and clone via the ESXi SSH shell.

### Step 1: Enable SSH on ESXi Host
Navigate to **ESXi Host Client > Manage > Services > TSM-SSH > Start** (and enable policy "Start and stop with host").

### Step 2: Clone Disk and VMX via Shell
SSH into the ESXi hypervisor:

```bash
# SSH into ESXi host
ssh root@192.168.0.x

# Navigate to the VM datastore
cd /vmfs/volumes/datastore1

# Target clone: swarm-mgr01 -> swarm-mgr02
mkdir swarm-mgr02
vmkfstools -i swarm-mgr01/swarm-mgr01.vmdk swarm-mgr02/swarm-mgr02.vmdk -d thin
cp swarm-mgr01/swarm-mgr01.vmx swarm-mgr02/swarm-mgr02.vmx

# Update VM name references inside the VMX descriptor
sed -i 's/swarm-mgr01/swarm-mgr02/g' swarm-mgr02/swarm-mgr02.vmx

# Register VM in ESXi inventory
vim-cmd solo/registervm /vmfs/volumes/datastore1/swarm-mgr02/swarm-mgr02.vmx
```

Repeat this procedure for `swarm-mgr03`, `swarm-worker01`, `swarm-worker02`, `swarm-worker03`, `registry01`, and `monitoring01`. When cloning workers with larger disks (60GB/80GB), adjust the virtual disk size via `vmkfstools -X 60G <dest>.vmdk` prior to boot.

---

## 5. Critical Post-Clone VM Initialization Checklist

> [!CAUTION]
> When power-on prompts `I moved it` vs `I copied it`, always select **`I copied it`** to force ESXi to generate a unique UUID and MAC address.

Execute the following 5 steps on **every cloned VM** prior to starting Docker or Swarm services:

### 1. Regenerate systemd Machine ID
Prevents DHCP/systemd collision and duplicate D-Bus machine IDs:
```bash
sudo rm -f /etc/machine-id /var/lib/dbus/machine-id
sudo systemd-machine-id-setup
```

### 2. Regenerate OpenSSH Host Keys
Prevents SSH host key collisions across VMs:
```bash
sudo rm -f /etc/ssh/ssh_host_*
sudo dpkg-reconfigure openssh-server
sudo systemctl restart ssh
```

### 3. Update Hostname
```bash
# Replace with the node's hostname
sudo hostnamectl set-hostname swarm-mgr02
```

### 4. Detect Actual Network Interface Name & Configure Netplan
ESXi assigns a new virtual MAC address on clone registration. Ubuntu's udev rules may assign a different predictable interface name (e.g., `ens34` instead of `ens33`). 

Inspect current interface name:
```bash
ip link show
```

Update `/etc/netplan/01-netcfg.yaml` with the confirmed interface name and node static IP:
```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens33: # Verify whether this is ens33, ens34, or ens160
      dhcp4: no
      addresses:
        - 192.168.0.22/24
      routes:
        - to: default
          via: 192.168.0.1
      nameservers:
        addresses:
          - 192.168.0.1
          - 1.1.1.1
```

Apply and verify:
```bash
sudo netplan apply
ip addr show
ip route
```

### 5. Expand LVM Storage
Run the LVM reclamation procedure detailed in Section 3 to ensure disk resize took effect.
