#!/usr/bin/env bash
# Read-only host facts. No environment or container configuration is inspected.
set -uo pipefail
section() { printf '\n## %s\n' "$1"; }
section kernel; uname -r
section kvm; ls -l /dev/kvm; getent group kvm; stat -c '%g %a' /dev/kvm
section tun; ls -l /dev/net/tun
section cpu-vulns; grep -H . /sys/devices/system/cpu/vulnerabilities/* 2>/dev/null
section smt; cat /sys/devices/system/cpu/smt/control 2>/dev/null
section ksm; cat /sys/kernel/mm/ksm/run 2>/dev/null
section swap; swapon --show; free -g
section cgroup; stat -fc %T /sys/fs/cgroup; cat /sys/fs/cgroup/cgroup.controllers
section docker; docker info --format '{{.ServerVersion}} {{.CgroupDriver}} {{.CgroupVersion}} {{.DockerRootDir}}'
section disk; df -h "$(docker info --format '{{.DockerRootDir}}')"
section nft; command -v nft || echo 'nft not on host (runs in container)'
