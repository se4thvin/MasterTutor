#!/usr/bin/env bash
# stdin is forwarded directly to Node. Shell never reads, echoes, or stores the credential.
set -euo pipefail
image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='mt-ci-runner:*' | head -1)"
ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mt-vm-p0-trial-fc)"
exec docker run -i --rm --name mt-vm-p0-model-trial --label mt-vm-p0=1 --label mt-vm-p0.run=model-trial \
  --network mt-vm-p0-cdp --ulimit core=0 --memory 2g --memory-swap 2g --cpus 2 --read-only --tmpfs /tmp:size=64m --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$PWD:$PWD:ro" -v "$PWD/spikes/agent-vm/out:/out" -w "$PWD" -e NODE_OPTIONS= -e NODE_DEBUG= -e OTEL_SDK_DISABLED=true -e SLOT_CONTROL="http://$ip:9226" "$image" node spikes/agent-vm/wm-trial/run-trial.ts
