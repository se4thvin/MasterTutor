---
run_id: 2026-10-05-19-plan-phase-0
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: running
depends_on: []
---

You are writing ONE implementation plan, for **Phase 0: Foundations** of the build-phase table in the spec. Use the superpowers writing-plans format: invoke the Skill tool with `skill: "superpowers:writing-plans"` first and follow it exactly. That means the required header, Global Constraints, Review Focus, File Structure, bite-sized TDD tasks with complete code (no placeholders), an Interfaces block on each task, and a self-review.

**Inputs. Read all of these before writing:**
- Spec: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/docs/superpowers/specs/2026-10-05-agentic-notes-design.md`
- Decisions: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` (D1–D31). Decisions override the spec.
- Rules: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`

**Spec amendments that are already decided but not yet in the spec file** (they override it):
1. **Live view uses n.eko WebRTC**, not a CDP screencast. See `orchestration/runs/2026-10-05-15-research-webrtc-live-view/report.md` §8.
   - Compose defines static `browser-1..N` slot services, each running n.eko + headed Chromium + a socat CDP proxy on an internal network. Default N=6.
   - `agent` leases a slot in Postgres and runs `connectOverCDP`.
   - Phase 0 must create the `browser_slots` table and add the slot services to compose (one slot in `compose.test.yml`). The image can be built in Phase 0 or B6, whichever is cleaner; you decide.
2. **`motion` is the only animation library.** React Bits components are copied in later (F phases); nothing is needed in Phase 0.
3. **Model IDs are verified**: `gpt-6-astra`, `gpt-6.1-sol`. The key `OPENAI_API_KEY` lives in the git-ignored repo-root `.env`.
4. **Benchmark mode.** The user's acceptance test has the agent log into zyBooks (via the vault, the model never sees credentials) and complete participation activities in reading assignments 1–5. That needs:
   - a per-run approval policy `approvalMode: "ask" | "auto_within_allowlist"`. Auto mode still writes every decision to `approvals` with `decided_by='policy'` and still blocks out-of-allowlist navigation;
   - a `benchmarks` + `benchmark_runs` table pair to record task, outcome, steps, cost, duration and failure notes.

   Add both to the contracts and the DB schema in Phase 0.

**Environment facts:**
- macOS arm64, Node 24.4, npm 11. **pnpm is not installed**, so your plan must enable it via `corepack enable` or `npm i -g pnpm` and handle failure.
- Docker 28.5 with a 25GB memory limit.
- **Only about 22GB of disk is free**, so keep images lean and note cleanup steps.
- The repo is currently: `CLAUDE.md`, `.gitignore`, `orchestration/`, `design/`, `docs/`. Branch: `houndshark`.

**Phase 0 scope**, from the spec, adjusted:
- pnpm monorepo: root `package.json` and `pnpm-workspace.yaml`, TS project refs or a base tsconfig, ESLint plus Prettier (minimal), Vitest config.
- `packages/contracts`: ALL Zod schemas from spec §6 plus env schemas per service, the `RunEvent` union, `AgentTurn`, `NoteBlock`, `Anchor`, `ApprovalRequest`, the live-view messages adapted to n.eko, and the oRPC router contract.
- `packages/db`:
  - the full Drizzle schema from spec §4, plus `browser_slots`, `benchmarks`, `benchmark_runs` and the `approvalMode` column;
  - drizzle-zod schemas;
  - migrations, including the generated tsvector, pgvector and the `vault_audit` append-only trigger;
  - `web_role` and `agent_role` grants.
- `packages/storage`: Garage S3 wrapper.
- `compose.yml` and `compose.test.yml` skeletons: postgres, garage (with init of buckets and keys), migrate, web and agent placeholders that boot and pass healthchecks, and one browser slot in test.
- Better Auth wired in `apps/web`, a minimal Next.js 16 app with `/healthz`.
- An `apps/agent` skeleton with env parsing and `/healthz`.
- GitHub Actions CI: lint, typecheck, unit tests, integration tests with Testcontainers.

**Return the COMPLETE plan markdown as your final reply.** Do not write files; the orchestrator saves it to `docs/superpowers/plans/2026-10-05-phase-0-foundations.md`. Be thorough: this plan is executed by subagents with zero context.
