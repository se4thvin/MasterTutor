---
run_id: 2026-10-09-01-research-observer-integration-map
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

You are a codebase research agent for MasterTutor. Repo: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`, branch `agentic-notes-browser-agent`. Observability Tracks B and C are on branches `obs-b`/`obs-c`, not yet merged; read them with `git show obs-b:<path>`.

**Goal.** Produce a precise integration map for a new **Observer** subsystem, so it is designed in rather than bolted on. The Observer has two roles:
1. **Guard.** It watches the main agent's pipeline using scrubbed metadata only, and can pause or block steps. Secret detection stays the local exact-match screen with no model call.
2. **Copilot.** It lives in the observability dashboard and answers questions using read-only access to telemetry, DB metadata and code.

Read `CLAUDE.md` and `orchestration/STATE.md` (D34–D50). Then map the actual code:
- **The agent run loop and its phases (observe → decide → approve → act).** Cover the exact seam where a guard verdict could gate an action: `decideByPolicy` in `packages/contracts/src/approval.ts`, the approval flow and `decided_by`, safety checks, the bypass invariants (D44), the click guard, the network policy, vault fill pinning, and the local secret screen. For each, list the file and function, and what data is available there without secrets.
- **Run events, step store, run-event SSE and the approval cards.** How a guard verdict would surface to the person, for example a new approval kind or event type, and how it would appear in telemetry.
- **The telemetry layer from Track A** (`packages/telemetry`, the eight `instrument()` seams, the attribute allowlist), plus the Collector and OpenObserve. What a guard could consume in-process versus from the telemetry stream. Note the latency each path implies.
- **The OpenAI wrapper and the MODELS constants**, plus budget and usage accounting. Where Observer calls would go, and how their spend is attributed.
- **Postgres roles and grants, and existing read-only patterns.** What a least-privilege `observer` role would need, which tables must be excluded (vault, sessions, credentials), and the migration numbering. Main is at 0013; obs takes 0014.
- **The web app and `/observability`.** Covers the owner gate, `obs.<DOMAIN>` (Track C) and the alerts. Where a copilot UI and API would live.
- **Package boundaries and the dependency map.** Find where a new `packages/observer` (or similar) would sit with no cycles, and what it may import.

**Deliverable.** An integration-map report:
- the seams, by file:line;
- data available at each seam;
- the proposed module placement and dependency edges;
- the new contracts needed;
- the migration and role;
- risks, such as latency on the hot path and coupling;
- what existing code to reuse rather than recreate.

Return the full report as your final reply. Don't write files and don't dispatch subagents. Never read `.env*`.
