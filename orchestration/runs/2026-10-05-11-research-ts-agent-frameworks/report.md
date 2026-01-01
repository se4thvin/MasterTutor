---
run_id: 2026-10-05-11-research-ts-agent-frameworks
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-10-research-langgraph]
---

I recommend **(a): a hand-rolled Postgres state machine with Zod 4 and the `openai` SDK**, which keeps decision D14. Temporal is a strong second choice and the right escape hatch. Mastra is ruled out on weight. No TypeScript framework handles the `computer` loop better than plain SDK calls, so the closest thing to Pydantic AI in TypeScript is Zod plus the OpenAI SDK's Zod helpers.

Versions come from `npm view` on 2026-10-05. Install sizes were measured in a scratch folder. I also grepped the installed type definitions to check `computer` tool support.

## 1. Pydantic AI equivalents in TypeScript

| Library | Version / license | Typed tools and output | `computer` tool (GA type) | Raw provider-tool passthrough |
|---|---|---|---|---|
| `zod` | 4.6.5, MIT | `z.infer`, parse at boundaries, `z.toJSONSchema` | n/a | n/a |
| `openai` | 7.28.0, Apache-2.0 | `zodTextFormat`, `zodResponsesFunction`, `responses.parse()`; `zodResponseFormat` and `zodFunction` are for Chat Completions. Its peer dependency accepts Zod `^3.25 \|\| ^4.0` | **Yes.** `ComputerTool { type: 'computer' }`, `computer_call`, and the legacy `computer_use_preview` | Yes: every tool type, unwrapped |
| `ai` + `@ai-sdk/openai` | 7.0.128 + 4.0.84, Apache-2.0 | `tool({inputSchema})`. `generateObject` is **deprecated** in favour of `generateText({ output })` | **Yes:** `openai.tools.computer()`, typed batched actions and safety checks | Yes, as provider-defined tools |
| `@mastra/core` | 1.74.0, Apache-2.0 | Zod schemas for tools, steps, suspend and resume | Through AI SDK provider tools; computer use specifically **[unverified]** | Same AI SDK passthrough **[unverified]** |
| `@openai/agents` | 0.19.0, MIT | `tool({parameters: zod})`, typed `outputType` | **Yes:** `computerTool` with GA `type: 'computer'`. `gpt-6-astra` is in its model table | Yes: hosted tools. Still pre-1.0, owns the loop, and traces go to OpenAI by default |

- **No "Pydantic AI for TS" exists.** Pydantic AI is Python-only (pydantic.dev/docs/ai/overview). I found no maintained TypeScript port **[unverified: absence]**.
- **`runTools` covers Chat Completions only.** There is no tool runner for the Responses API, so the computer-use loop is hand-written whichever library you pick.

## 2. Temporal (TypeScript SDK 1.24.0, server 1.32.0, both MIT)

**Services.**
- The official compose files moved: the old `temporalio/docker-compose` repo is archived, and they now live in `temporalio/samples-server/compose` (`docker-compose-postgres.yml`).
- That file runs these containers:
  - `postgres`
  - `admin-tools`, a one-off job that sets up the schema
  - `temporalio/server`
  - `create-namespace`, a one-off job
  - `temporal-ui`
- Search over runs works on Postgres alone, with no Elasticsearch **[unverified for 1.32]**.
- Memory is a few hundred MB for the server and UI **[unverified]**, which is irrelevant on 512 GB.
- The worker install is **253 MB** because it bundles a Rust core and a workflow bundler.
- It deploys on Dokploy as a Compose app. Point it at a separate database inside our Postgres 17 and keep port 7233 internal.

**Determinism.**
- Workflow code runs in a V8 sandbox where `Date` and `Math.random` are made deterministic.
- Workflow code may do no I/O and import no Node modules. All side effects belong in activities.

**How the computer-use loop maps onto it.**
- The workflow holds the observe → decide → act loop.
- `callModel` is an activity that calls the Responses API with `previous_response_id`.
- `executeComputerActions` is another activity, which drives Playwright and uploads the screenshot to Garage.
- Approvals and human takeover use `defineUpdate` (validated and acknowledged) or a signal, combined with `condition()`.
- Retry policies go on each activity. Browser actions should get `maximumAttempts: 1` plus a re-observe step, because a blind retry could click twice.

**Long pauses and long runs.**
- Durable timers (`sleep` and `condition` with a timeout) survive restarts.
- History hits a warning at 10,240 events and is terminated at 51,200 events or 50 MB.
- Use `workflowInfo().continueAsNewSuggested` to call continue-as-new every N steps.

**Payload limits.**
- 256 KB warning and 2 MB hard error per payload; 4 MB per gRPC message.
- So screenshots must go to Garage, and only object keys pass through Temporal.

**Pinning a browser to one worker.**
- Workflow-level sticky execution is automatic, but browser activities need the **worker-specific task queue** pattern, which has an official TypeScript sample.
- Worker "sessions" are a Go/Java feature **[unverified for TS]**.
- If the worker dies, the browser still has to be rebuilt from the encrypted saved login state, exactly as in (a).

## 3. Mastra, honestly

- **Workflows.** `createWorkflow` and `createStep` take Zod `inputSchema`, `outputSchema`, `suspendSchema` and `resumeSchema`. Snapshots persist to Postgres through `@mastra/pg` 1.29.0. Type inference across `.then()` chains is good.
- **Weight.** The install is **136 MB and about 205 packages**. It pulls in hono, posthog-node, two A2A SDK versions and three AI SDK provider versions, so it fails the bloat-free principle.
- **Durable backends.**
  - Inngest is production-ready, but its server is SSPL-licensed, which run 10 already ruled out.
  - `@mastra/temporal` 0.4.12 is "experimental and not ready for production use".
  - Suspend and resume are not yet mapped to Temporal signals (issue #24024 is open).
- **Computer tool.** Only indirect, through AI SDK provider tools **[unverified]**.

## 4. Recommendation

| Option | Bloat-free | Decoupled and readable | Latency | Security | Verdict |
|---|---|---|---|---|---|
| **(a) Hand-rolled + Zod + `openai`** | Best: one SDK and Zod | Explicit tables | No extra hop | Full control of what gets logged | **Pick** |
| (b) Temporal + Zod + `openai` | Adds 4–5 containers and a 253 MB worker | Clean activity boundaries, but a determinism rule set to learn | gRPC hop per step (ms) | Payloads visible in the UI unless encrypted with a codec | Escape hatch, ahead of Hatchet |
| (c) Mastra | Heaviest | Framework owns the loop | Fine | Telemetry deps to audit | No |
| (d) AI SDK + hand-rolled | ~20 MB extra | Abstraction over one provider | Fine | Fine | Only if a second provider becomes real |

Why (a):
- With one provider, AI SDK's provider abstraction adds nothing.
- Temporal's advantages (durable timers, update handlers, history) mostly duplicate the leases and steps tables that D14 already has.
- Move to (b) if hand-rolled recovery and timer code grows past about 500 lines, or if bugs appear in it.

**End-to-end type safety with one `packages/contracts` package**, Zod only:
- **Env:** `env.ts` with `z.object({...}).parse(process.env)` at boot. `@t3-oss/env-core` 0.13.11 is optional.
- **Database:** Drizzle schemas (`drizzle-orm` 0.45.3) live in `packages/db`. `drizzle-zod` 0.8.3 generates the insert and select schemas, and contracts re-export them.
- **API:**
  - Use oRPC 1.15.4 (MIT) contract-first. It works natively with Zod and Standard Schema, and has typed event iterators that can carry our SSE stream **[unverified detail]**.
  - Alternatives are tRPC 11.19.0, or plain Next route handlers that call `.parse` on input.
  - Server actions are fine for UI mutations.
- **SSE events:** one `z.discriminatedUnion('type', [...])` for run events. The worker validates before it emits and the client parses on receipt.
- **Tools:** each custom tool has a Zod `args` schema and a Zod `result` schema, sent to the model with `zodResponsesFunction` and validated again on return.
- **Computer actions:** use the SDK's `ComputerAction` type, narrowed by a Zod allowlist.
- **Model structured outputs:** `zodTextFormat` plus `responses.parse()`.
- **No redundancy:** schemas are written once in contracts and types are always `z.infer`, never hand-written interfaces.

Sources:
- https://www.npmjs.com/package/ (zod, openai, ai, @ai-sdk/openai, @mastra/core, @mastra/pg, @mastra/temporal, @openai/agents, @temporalio/worker, drizzle-zod, @orpc/server, @trpc/server)
- https://pydantic.dev/docs/ai/overview/
- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://docs.temporal.io/self-hosted-guide/defaults
- https://docs.temporal.io/self-hosted-guide/deployment
- https://github.com/temporalio/samples-server/tree/main/compose
- https://github.com/temporalio/temporal/releases (v1.32.0, 2026-09-11)
- https://docs.temporal.io/design-patterns/worker-specific-taskqueue
- https://docs.temporal.io/guides/worker-execution-affinity
- https://github.com/temporalio/samples-typescript/tree/main/worker-specific-task-queues
- https://docs.temporal.io/task-routing
- https://mastra.ai/docs/deployment/workflow-runners
- https://mastra.ai/blog/introducing-temporal-workflows
- https://github.com/mastra-ai/mastra/issues/24024
