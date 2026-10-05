---
run_id: 2026-10-05-10-research-langgraph
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

Research task (web research; return the report as your final reply, don't write files). Today is 2026-10-05.

Context: read `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` and `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`. We plan to use the **open-source LangGraph.js** (TypeScript) as the agent loop in a Node worker. Nothing paid: no LangGraph Platform, LangSmith or Studio. The worker drives Playwright Chromium and calls the OpenAI Responses API directly (model `gpt-6-astra`, the `computer` tool), without LangChain model wrappers.

Verify with sources (official docs and GitHub preferred), as of late 2026:
1. Current versions of `@langchain/langgraph` and `@langchain/langgraph-checkpoint-postgres`, their licenses, and their transitive dependencies. Does it pull in `@langchain/core`, and how heavy is that?
2. The Postgres checkpointer in TS: its schema, setup(), and how it performs with frequent checkpoints. Can large state be avoided by storing references only? Is there checkpoint TTL or cleanup?
3. `interrupt()` and `Command({ resume })` semantics in TS. A node re-executes from its start on resume, so what are the side-effect/idempotency implications for browser actions? What are the recommended patterns (split side effects into separate nodes, use tasks/`@task`/functional API, durability modes)?
4. Durable execution: resuming a thread on a different process after a crash. Does LangGraph handle leases/locking across multiple workers, or must we build that?
5. Can nodes call the raw OpenAI SDK, with no LangChain model, cleanly? Any gotchas with streaming events to our own SSE?
6. Is the Functional API (`entrypoint`/`task`) or the Graph API a better fit for an observe→decide→act computer-use loop with human-in-the-loop?
7. Lighter alternatives worth considering under the bloat-free rule: OpenAI Agents SDK JS with its own sessions/HITL, Mastra workflows, Inngest/Hatchet self-hosted, or a hand-rolled state machine. Give a brief honest comparison.

Final reply: a report under 800 words with a clear recommendation, source URLs, and [unverified] flags where applicable.
