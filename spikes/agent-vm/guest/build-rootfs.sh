#!/usr/bin/env bash
# All tooling is in images. Export containers are labelled and never started.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
for item in kernel rootfs; do
  if [[ "$item" == kernel ]]; then image=mt-vm-p0-kernel:6.1.188; artifact=vmlinux
  else image=mt-vm-p0-rootfs:local; artifact=rootfs.ext4; fi
  name="mt-vm-p0-export-$item"
  docker create --name "$name" --label mt-vm-p0=1 --label "mt-vm-p0.run=$name" "$image" /not-executed >/dev/null
  docker cp "$name:/$artifact" "images/$artifact"
  ids="$(docker ps -aq --filter label=mt-vm-p0=1 --filter "label=mt-vm-p0.run=$name")"
  [[ -z "$ids" ]] || docker rm $ids >/dev/null
  sha256sum "images/$artifact"
  stat -c '%n %s' "images/$artifact"
done
