---
run_id: 2026-10-09-09-spike-agent-vm
date: 2026-10-09
agent_type: primary-executor
phase: spike
status: running
depends_on: [2026-10-09-06-research-agent-vm]
---

You are working in the MasterTutor monorepo.

## Task
Run Phase **P0 (Tasks P0.1–P0.6)** of `docs/superpowers/plans/2026-10-09-agent-vm.md`. The spec is `docs/superpowers/specs/2026-10-09-agent-vm-design.md`. Stop after the P0.6 go/no-go report; P1 and later need the user's sign-off on that report.

## Approved (D55)
You may run containers with `/dev/kvm` and `/dev/net/tun` and `NET_ADMIN` on the shared host `coursebite`, reached over SSH/Tailscale the same way `scripts/remote-test.sh` reaches it (if the host doesn't resolve, run `tailscale up`). Read-only host checks are allowed.

## Hard host limits
- No installs on the host, no sudo, and no changes to `/dev/kvm` permissions, `daemon.json`, AppArmor, SMT/KSM or any host-wide setting.
- Don't touch other tenants' containers, Dokploy or Traefik.
- Name and label every container, network, image and volume you create with an `mt-vm-p0` prefix or label.
- Clean up with label-scoped commands only.
- Use loopback-only published ports.
- If any step needs a host change, STOP and report it as a no-go criterion.

## OpenAI spend
The openbox-vs-Xfce trial (P0.5) is capped at **$10**. Use the key only by reading it from the running bench agent container's environment at runtime, the way the earlier Observer spike did. Never print it, write it to a file, or log it. If you can't do that safely, skip the model part of P0.5 and say so.

## Deliverable
A report with the measured criteria table. Commit it under `orchestration/runs/2026-10-09-09-spike-agent-vm/` as `brief.md` and `report.md`, plus any spike scripts.

## Rules (binding)
- Read `CLAUDE.md` first; its engineering principles bind everything you do. Also read the rows D44–D55 in `orchestration/STATE.md`; D54 says never reword or invent captured content.
- Never read `.env*` files and never print secrets. Write no credentials anywhere.
- Follow the plan task by task, in order, test-first, as the plan prescribes. Its Global Constraints and Review Focus apply to every task. Where the plan is wrong about the current code, make the smallest fix consistent with the spec, and note it in your final report.
- Migration numbers: 0015 is Observer and 0016 is `remove_model_blocks`, both already merged. Use the next free numbers, and keep drizzle `meta/` consistent.
- After each task, run `pnpm typecheck`, `pnpm lint`, and the unit tests (and DB integration tests, if Docker is available) for the touched packages. Fix every failure you cause.
- Commit after every task with explicit paths: `git commit -m "<type>(scope): ..." -- <paths>`. Never `git add -A`, never stash. End every commit message with `Co-Authored-By: Codex <noreply@openai.com>`.
- Do not push, do not merge, and do not touch other worktrees.
- UI work follows Apple HIG, and uses glass only for chrome and the floating layer, never for content.
- Finish with a report listing each task with its commit SHA, the test results, deviations from the plan, and anything left undone.
