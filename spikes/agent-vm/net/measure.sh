#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='mt-ci-runner:*' | head -1)"
ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mt-vm-p0-net-fc)"
docker run --rm --name mt-vm-p0-net-probe --label mt-vm-p0=1 --label mt-vm-p0.run=probe --network mt-vm-p0-cdp -v "$PWD:$PWD:ro" -w "$PWD" -e SLOT_IP="$ip" "$image" node spikes/agent-vm/net/cdp-probe.ts
# With host networking TCP ICE can reach the loopback-only published mux.
# Viewer needs CDP via the private network IP (no CDP host publication).
docker run --rm --name mt-vm-p0-net-viewer --label mt-vm-p0=1 --label mt-vm-p0.run=viewer --network host -v "$PWD:$PWD:ro" -v /var/run/docker.sock:/var/run/docker.sock:ro -w "$PWD" -e CDP_URL="http://$ip:9223" "$image" node spikes/agent-vm/net/viewer.ts
