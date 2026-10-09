---
run_id: 2026-10-09-09-spike-agent-vm
date: 2026-10-09
agent_type: primary-executor
phase: spike
status: running
depends_on: [2026-10-09-06-research-agent-vm]
---

# P0 execution brief

Run Phase P0 (P0.1–P0.6) of `docs/superpowers/plans/2026-10-09-agent-vm.md`, against `docs/superpowers/specs/2026-10-09-agent-vm-design.md`. Stop after the go/no-go report. P1 and later require the user's acceptance of a go report.

D55 authorizes containers with `/dev/kvm`, `/dev/net/tun` and NET_ADMIN on coursebite, reached using the SSH alias in `scripts/remote-test.sh`. Read-only host checks are authorized. If resolution fails, the user authorizes `tailscale up`.

No host installs, sudo, device permission changes, daemon.json, AppArmor, SMT/KSM or other host-wide changes. Do not touch other tenants, Dokploy or Traefik. Every resource created has an `mt-vm-p0` name or label. Cleanup is label-scoped; published ports bind only loopback. A required host change stops execution and is a no-go criterion.

Read CLAUDE.md and D44–D55. D54 prohibits rewording or inventing captured content. Never read `.env*`, print secrets, or write credentials. P0.5 has a $10 cap; its key may only be read in memory from the running bench agent container environment at runtime. Skip model work if that cannot be done safely.

Follow tasks in order and test-first as prescribed. Global Constraints and Review Focus apply. Record minimal corrections for current-code mismatches. Migrations 0015 and 0016 are occupied; P0 makes no migrations. Run pnpm typecheck, pnpm lint and unit tests after each task, plus DB integration for touched packages when Docker is available. Fix failures caused by this work.

Commit each task with explicit paths and `Co-Authored-By: Codex <noreply@openai.com>`. Never add all, stash, push, merge, or touch another worktree. UI follows Apple HIG; glass is limited to chrome and floating layers.

Deliver brief.md, report.md, raw measurement evidence and spike scripts. Report task commit SHAs, test results, deviations and unfinished work.
