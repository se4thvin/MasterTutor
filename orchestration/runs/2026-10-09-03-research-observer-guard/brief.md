---
run_id: 2026-10-09-03-research-observer-guard
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

You are a research agent for MasterTutor, an agentic browser app. Repo: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`. Read `CLAUDE.md`, `orchestration/STATE.md` (especially D34, D36–D39 and D44–D50), and `orchestration/briefs/openai-data-policy.md`.

**What the user wants.** An "Observer agent" that sits on top of the main browsing agent and can **block** a step when something unsafe is detected in the pipeline. It must integrate robustly with the existing safety layers and the observability layer, not be patched on the side.

**The binding constraint.** The Observer is an LLM (OpenAI via our wrapper, `store:false`), so it can never see raw secrets. Secret detection stays a local exact-match screen that makes no model call. The Observer sees only scrubbed metadata and telemetry.

**Research the best approach, using web search for primary sources.**
1. **Prior art for monitor and guardian agents.** Cover AI control research (trusted monitoring, untrusted/trusted model setups, defer-to-trusted, resampling), LLM-as-judge and guard models (Llama Guard, NeMo Guardrails, OpenAI's guardrails/moderation patterns, Anthropic's constitutional classifiers), the security monitors in agent frameworks (OpenAI Agents SDK guardrails, LangGraph interrupts, AutoGen), and browser-agent safety: computer-use safety checks and prompt-injection detectors such as PromptGuard and Lakera-style approaches (study the patterns only, since we must self-host). Learn what's effective and what fails.
2. **Placement.** Inline and synchronous (it gates each action), asynchronous (it watches and can pause), or a hybrid that is synchronous only for high-risk action classes. Cover latency and cost budgets, fail-open versus fail-closed, and how monitors are themselves attacked through prompt injection in the data they read.
3. **Inputs for the monitor.** Which signals actually catch problems: the action plus its target origin, a summary of the agent's reasoning, the goal, approval state, new-origin events, vault-fill intents (alias and origin only), data-flow hints (where a typed value came from), and telemetry anomalies. How to represent them compactly and safely, with page text treated as untrusted.
4. **Decisions and authority.** Allow, flag, require a human, or block. How the monitor should compose with our existing deterministic policy (`decideByPolicy` and the approval modes ask, auto and bypass from D44). The deterministic layers must never be weakened.
5. **Evaluation.** How to measure monitor recall and precision against our benchmark and fixtures: red-team scenarios, injection pages, exfiltration attempts.

**Deliverable.** A research report with a recommended architecture for the guard role, with options and trade-offs, citing sources with URLs and marking anything unverified `[unverified]`. Return the full report as your final reply, because the orchestrator persists it. Don't write files and don't dispatch subagents.
