#!/usr/bin/env bash
set -euo pipefail
[[ "${KVM_GID:-}" =~ ^[0-9]+$ ]] || exit 64
printf 'container-init-status\n'
grep -E '^(Cap|Seccomp:|NoNewPrivs:)' /proc/1/status
capsh --decode="$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/1/status)"
printf 'swap-max=%s\n' "$(cat /sys/fs/cgroup/memory.swap.max)"
ip tuntap add dev tap0 mode tap user fc
ip addr add 192.168.127.1/30 dev tap0
ip link set tap0 up
exec setpriv --reuid=10001 --regid=10001 --groups="$KVM_GID" \
  --inh-caps=-all --no-new-privs python3 /opt/spike/boot.py
