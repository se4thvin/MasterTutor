---
run_id: 2026-10-05-20-plan-b1-runtime-core
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. Read `orchestration/briefs/plan-writer-common.md` first; it applies to you in full.

Your phase is **B1: Runtime core** (spec §16, §5, §6 `computer`/`read_page`, §9 model-screenshot masking, §12 agent-behaviour layer). It covers:
- the slot pool with wake-priority leasing, restart-on-release, connectOverCDP via `slotCdpBaseUrl`, and applying `storageState`;
- the run loop: state machine, observe→decide→approve→act, one transaction per step, run leases and heartbeat, checkpoints, sleep and wake, restore by re-observing, compaction, and the OpenAI Responses client with `gpt-6-astra` and fallback to `gpt-6.1-sol`;
- the AbortController and `ControlHeld` guard, the guardrails (budgets, allowlist via `page.route`, the approval policy including `approvalMode: auto_within_allowlist`, loop detection, untrusted wrapping, the kill switch, CAPTCHA detection);
- the `computer` tool (Zod allowlist executed as CDP Input), `read_page` (attribute allowlist, `{unchanged:true}`) and post-capture masking with `sharp`;
- the `run_events` emission plus NOTIFY;
- `tests/llm-mock` (a scripted Responses API) and `tests/fixtures` (the static nginx sites from spec §12; the sites needed by later phases can be stubs that later phases fill in);
- agent-behaviour tests, including crash/restore, slot reset and masking passivity.

The benchmark depends heavily on this phase. Make computer use robust: coordinate scaling, waits, scroll handling, and DOM-assisted clicking via `read_page` element refs.

Your final reply is saved to `docs/superpowers/plans/2026-10-05-phase-b1-runtime-core.md`.
