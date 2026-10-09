#!/usr/bin/env bash
set -euo pipefail
ip tuntap add dev tap0 mode tap user fc
ip addr add 192.168.127.1/30 dev tap0
ip link set tap0 up
exec setpriv --reuid=10001 --regid=10001 --groups=994 --inh-caps=-all --no-new-privs python3 /opt/spike/restore.py
