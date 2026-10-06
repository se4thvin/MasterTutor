---
run_id: 2026-10-05-26-plan-7-10
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. Read `orchestration/briefs/plan-writer-common.md` first; it applies to you in full.

Your plan covers **Phase 7 Integration**, **Phase 8 QA**, **Phase 9 Deploy readiness** and a new **Phase 10 Benchmark suite** (spec §12, §13, §16, D22, D28, D32–D34).

**Phase 7 Integration**
- Wire F to B over oRPC, SSE and the live iframe.
- Write the full `compose.test.yml` E2E suite (Playwright `e2e` service with `greenmail`, `llm-mock` and fixtures), including the WebRTC playback and takeover E2E.
- Run the full security suite in CI.

**Phase 8 QA**
- **UI validation swarm.** Define how the orchestrator dispatches parallel computer-use and browser-automation subagents per screen group, at 5 widths × 2 themes, and the report format they return.
- **Automated backing:** visual regression baselines, the DOM overflow detector, axe.
- **Animation-expert pass.** Define how the orchestrator dispatches it and what it checks. Back it with a CDP trace harness.
- **Fix loop:** findings feed back into fixes.

**Phase 9 Deploy readiness**
- Production compose labels for Dokploy.
- Firewall ports, sysctl, secrets and backups.
- A local production-like smoke run.
- Do not actually deploy: there's no domain yet, and deploying is outward-facing.

**Phase 10 Benchmark suite.** This is the user's acceptance test.
- Build a benchmark harness, e.g. `apps/agent/src/bin/bench.ts` or `tests/bench/`. It creates benchmark tasks through the real oRPC API and starts runs with `approvalMode: auto_within_allowlist`. It records `benchmarks`/`benchmark_runs` with outcome, steps, cost, duration, takeover count and failure notes, and writes a Markdown report under `orchestration/benchmarks/`.
- **Two capability tracks to measure:**
  - (a) pure computer use: screenshots plus the `computer` tool;
  - (b) browser use: `read_page`, DOM-assisted actions and capture.

  Use a per-run tool-profile setting if needed. If it isn't in the contracts, specify the minimal contract addition.
- **Initial suite:**
  - local fixture tasks (deterministic, with the mock LLM and with the real model);
  - the real zyBooks task: log in at `https://learn.zybooks.com/signin` with vault alias `zybooks` (credentials entered through the Vault UI by the orchestrator at run time, never stored in files), open `https://learn.zybooks.com/zybook/UTDALLASCE2310EE2310AkourFall2026`, and complete participation activities in reading assignments 1–5 until zyBooks shows them complete.
- **Success criteria** must be verifiable from the page, e.g. completion checkmarks or percentages, read via `read_page`.
- **Failure loop protocol:** document where it fails (step, screenshot key, reason), classify the failure (perception / action / navigation / auth / policy / budget), write a fix ticket, the fix lands through normal review, re-run, and repeat until it fully completes.
- Include budgets, and how the orchestrator watches a live run, including takeover only as a last resort, which is counted as a failure.

The orchestrator saves your final reply to `docs/superpowers/plans/2026-10-05-phase-7-10-integration-qa-deploy-benchmark.md`.
