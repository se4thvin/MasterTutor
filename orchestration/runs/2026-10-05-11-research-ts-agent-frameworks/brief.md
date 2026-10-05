---
run_id: 2026-10-05-11-research-ts-agent-frameworks
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-10-research-langgraph]
---

This is a research task. Do web research and npm checks, write no files, and return the report as your final reply. Today is 2026-10-05.

Start by reading these for context:
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md`
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-10-research-langgraph/report.md`

The user knows Python, where they use Pydantic AI. They want TypeScript with end-to-end type safety. They are also asking about Mastra and Temporal for the agent runtime. The runtime is self-hosted on a 512GB Dokploy server, so server runtime cost is low, and OpenAI is the only paid service allowed. The agent uses `gpt-6-astra` with the Responses API `computer` tool, plus custom typed tools, and needs durable, checkpointed runs with human-in-the-loop pauses.

Answer each question with sources (npm versions, official docs):
1. **Pydantic AI equivalents in TypeScript.**
   - Zod v4 for schemas, inferred types and validation.
   - The OpenAI Node SDK's zod helpers (`zodResponseFormat`, `zodFunction`, `zodTextFormat`, `runTools`).
   - Vercel AI SDK (current major): typed tools and `generateObject`.
   - Mastra agents.
   - OpenAI Agents SDK JS.
   - Any library that explicitly positions itself as "Pydantic AI for TS".
   For each, say whether it supports the OpenAI Responses `computer` tool with gpt-6-astra or newer models, and whether it supports raw passthrough of provider-defined tools.
2. **Temporal TypeScript SDK and self-hosted server, 2026.**
   - License; the services a self-hosted deployment needs (server, Postgres persistence, UI); memory footprint.
   - Determinism constraints for workflows.
   - How a computer-use loop maps to it: activities for browser actions; signals or updates for approvals and takeover; retries.
   - How it handles long-running, human-paused workflows (durable timers; continue-as-new for histories with hundreds of steps).
   - Payload size limits (screenshots must go in object storage).
   - Is it a good fit for a sticky browser session pinned to one worker (worker-specific task queues and sessions)?
   - Run it on Docker Compose with Dokploy.
3. **Mastra (current version), honestly.**
   - Workflows with suspend/resume, storage on Postgres, and how heavy its dependencies are.
   - Its type safety.
   - Does it support Temporal or another durable backend?
   - Does it support the OpenAI computer tool?
4. **A recommendation for this project.** Weigh the options against the CLAUDE.md principles (bloat-free, decoupled, readable, low latency, security). Candidate combinations:
   - (a) hand-rolled state machine + Zod + OpenAI SDK
   - (b) Temporal + Zod + OpenAI SDK
   - (c) Mastra
   - (d) AI SDK + hand-rolled
   Also describe how to get end-to-end type safety across the whole stack: a single Zod contracts package covering env, DB (drizzle-zod), API (Next route handlers or server actions, or tRPC/oRPC), SSE events, tool arguments and outputs, and model structured outputs.

Your final reply should be a report under 900 words with a clear recommendation, source URLs, and [unverified] flags.
