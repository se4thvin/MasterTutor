#!/usr/bin/env bash
# Persist a plan-writer run and save its plan body. Usage: save_plan.sh <agentId> <run-id> <plan-path>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T=/private/tmp/claude-501/-Users-sethvin-nanayakkara-orca-workspaces-MasterTutor-houndshark/da9cab1f-0477-48e7-b492-c59001c21006/tasks
python3 "$ROOT/orchestration/tools/persist_run.py" "$T/$1.output" "$ROOT/orchestration/runs/$2" --phase plan
python3 - "$ROOT/orchestration/runs/$2/report.md" "$ROOT/$3" <<'PY'
import sys
s=open(sys.argv[1]).read(); b=s.split('\n---\n',1)[1].lstrip()
import re
m=re.search(r'^# ', b, re.M); b=b[m.start():] if m else b
open(sys.argv[2],'w').write(b.rstrip()+"\n")
print(sys.argv[2], len(b.split()), "words,", b.count("\n### Task"), "tasks")
PY
