---
run_id: 2026-10-09-02-research-observer-copilot
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

You are a research agent for MasterTutor, an agentic browser app. The repo is at `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`.

**Read first**
- `CLAUDE.md`
- `orchestration/STATE.md`, especially D36–D39 (OpenAI data policy, no hosted OpenAI tools, build-it-ourselves) and D50 (observability with OpenTelemetry and OpenObserve)
- the observability spec: `docs/superpowers/specs/2026-10-08-observability-design.md`
- `orchestration/briefs/openai-data-policy.md`

**What the user wants.** An Observer agent that lives in the observability dashboard as a **copilot**. It answers any question about the system, its queries and its metrics: "why did run X fail", "what did we spend today", "which step is slowest", "show errors in the last hour". It has **read-only access to the whole system**.

**Research the best approach, using web search for primary sources:**

1. **Prior art.** Look at observability copilots and AI SRE assistants: Grafana Assistant/Sift, Datadog Bits AI, Honeycomb Query Assistant, New Relic AI, OpenObserve's own AI features, SigNoz AI, Elastic AI Assistant, plus open-source text-to-SQL and text-to-PromQL agents. What works, and where do they fail (hallucinated queries, cost, latency)?
2. **Tooling design.**
   - Tools over OpenObserve's SQL and PromQL APIs (read-only, with row and time limits).
   - Read-only DB views of run, step, approval and event metadata: a dedicated Postgres role with SELECT on specific views only, never the vault, sessions, `.env` or keys.
   - Code search over the repo, read-only, for "how does X work".
   - Run-replay pointers.
   - Answers must cite the query and data they used. Charts in answers would be a bonus.
3. **Safety.**
   - The copilot reads untrusted page-derived text, including run captions and reasoning summaries, so assess prompt-injection risk inside telemetry.
   - Output rendering must be safe.
   - Rate limits and cost caps.
   - Owner-only access, matching the existing `/observability` owner gate.
   - D38: `store:false`, one wrapper, data minimisation.
4. **Integration.** How a chat panel fits inside or alongside the OpenObserve UI on `obs.<DOMAIN>` versus inside the MasterTutor app. Cover streaming, conversation memory (stateless replay per D37), and grounding in our metric names. Our product attribute names are defined once in `packages/contracts`.
5. **Shared core.** How the copilot and the guard role (researched in parallel by another agent) should share one Observer core (prompting, tools, data access, telemetry) without coupling the latency-critical guard to the conversational copilot.

**Deliverable.** A research report with a recommended architecture, options and trade-offs. Cite source URLs and mark anything unverified as `[unverified]`. Return the full report as your final reply. Don't write files and don't dispatch subagents.
