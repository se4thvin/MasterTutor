#!/usr/bin/env bash
# Run inside the remote CI container, from the repository root.
set -euo pipefail
PYTHONPATH=spikes/agent-vm/fc python3 -m unittest discover -s spikes/agent-vm/fc
PYTHONPATH=spikes/agent-vm/guest:spikes/agent-vm/fc python3 -m unittest discover -s spikes/agent-vm/guest
PYTHONPATH=spikes/agent-vm/wm-trial python3 -m unittest discover -s spikes/agent-vm/wm-trial
node --test spikes/agent-vm/wm-trial/bench-key.test.ts spikes/agent-vm/wm-trial/budget.test.ts
pnpm exec tsc --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext \
  --allowImportingTsExtensions --skipLibCheck --lib es2024,dom,dom.iterable --types node --strict \
  spikes/agent-vm/net/*.ts spikes/agent-vm/wm-trial/*.ts
echo 'P0_CHECK spike=0'
