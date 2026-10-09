#!/usr/bin/env bash
# Offline fallback for a registry outage; only patches our disposable guest artifact.
set -euo pipefail
cd "$(dirname "$0")/../../.."
bash spikes/agent-vm/guest/build-rootfs.sh
image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='mt-ci-runner:*' | head -1)"
docker run --rm -i --name mt-vm-p0-patch-init --label mt-vm-p0=1 --label mt-vm-p0.run=patch-init \
  -v "$PWD/spikes/agent-vm/guest:/guest" "$image" bash -s <<'PATCH'
set -eu
command -v debugfs >/dev/null
debugfs -w /guest/images/rootfs.ext4 <<'COMMANDS'
rm /usr/sbin/vm-init
write /guest/vm-init /usr/sbin/vm-init
set_inode_field /usr/sbin/vm-init mode 0100755
COMMANDS
debugfs -R 'stat /usr/sbin/vm-init' /guest/images/rootfs.ext4
debugfs -R 'cat /usr/sbin/vm-init' /guest/images/rootfs.ext4 | cmp /guest/vm-init -
sha256sum /guest/images/rootfs.ext4
stat -c '%s' /guest/images/rootfs.ext4
PATCH
