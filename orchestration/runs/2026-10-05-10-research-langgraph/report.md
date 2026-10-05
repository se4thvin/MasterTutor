---
run_id: 2026-10-05-10-research-langgraph
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I recommend a small hand-rolled state machine for the agent loop, not LangGraph. It would keep each run's steps, events and leases in our own Postgres tables, with OpenAI's Responses API called directly. LangGraph.js works with that setup, but it doesn't supply the things we would otherwise build: locking across workers, idempotent browser actions, and cleanup. In return it adds @langchain/core and LangGraph's own update rules for state. If you still want a framework, use the LangGraph Graph API in the shape described under question 6.

I checked versions against the npm registry, measured an install in a scratch folder, and read the shipped package source. The behaviour claims come from the official docs.

**1. Versions, licenses, dependencies**
- `@langchain/langgraph` 1.4.19 (MIT, published 2026-10-03). It depends on `langgraph-checkpoint` 1.1.5, `langgraph-sdk` 1.12.1 (the client for LangGraph's paid hosted server, installed even when unused), `@langchain/protocol` and `@standard-schema/spec`. It requires `@langchain/core` ^1.1.48 and `zod` as peer dependencies.
- `@langchain/langgraph-checkpoint-postgres` 1.0.5 (MIT). Its only direct dependency is `pg`.
- `@langchain/core` 1.2.14 (MIT) is unavoidable. LangGraph imports about 20 of its modules (runnables, messages, callbacks, tools).
- Core itself pulls in `langsmith` (5.3 MB), `js-tiktoken` (21 MB), `mustache` and `p-queue`.
- Measured install for langgraph + checkpoint-postgres + core + zod: 34 packages, 63 MB. Of that, core is 13 MB, langgraph 5.7 MB and the sdk 6.8 MB.
- LangSmith tracing appears to stay off unless its environment variables are set. I saw this in the source but didn't test it at runtime [unverified].

**2. Postgres checkpointer**
- `setup()` runs built-in migrations that create four tables: `checkpoint_migrations`, `checkpoints` (JSONB), `checkpoint_blobs` (BYTEA, one row per changed state field and version) and `checkpoint_writes` (one row per node's output).
- `put()` runs one INSERT per changed field inside a single transaction, with no batching.
- History is never pruned. The only cleanup method is `deleteThread()`. There is no TTL in the open-source version; TTL exists only on the paid platform. The docs' only fix for unbounded growth is "prune periodically", and a prune feature request is still open (langgraph#8531).
- Large state can be avoided: keep only Garage object keys, URLs and hashes in state. Never put base64 screenshots there, because every changed value is saved again as a new blob version.

**3. `interrupt()` and `Command({ resume })`**
- The docs say plainly that on resume "the runtime restarts the entire node from the beginning". Resume values are matched to `interrupt()` calls by position. A try/catch around `interrupt()` swallows the interrupt.
- For browser actions, any click or keystroke that runs before an `interrupt()` in the same node runs again on resume.
- The recommended pattern is: a `decide` node that calls the model, then an `approve` node that only calls `interrupt()`, then an `act` node with one browser action.
- The docs say a task or node that started but didn't finish "may run again", so the docs say to use idempotency keys or check results first. For a browser, that means re-observing the page before acting.
- Use `durability: "sync"`. The default `"async"` can lose the last checkpoint if the process crashes.

**4. Resuming on another process after a crash**
- Any process can resume a thread from Postgres.
- LangGraph open source has no locking, leases or rules for concurrent runs on the same thread. I found no `FOR UPDATE` or advisory-lock code in the packages; the concurrent-run strategy setting exists only in the paid platform's SDK.
- So we build that ourselves: a `runs` table with lease columns and `SELECT … FOR UPDATE SKIP LOCKED`, which fits our Postgres-based queue anyway.
- The Playwright browser session is lost on a crash and has to be rebuilt from the encrypted saved login state. No framework handles that.

**5. Calling the OpenAI SDK directly**
- This works cleanly. Nodes are plain async functions.
- LangGraph's token streaming mode only covers LangChain model wrappers. With the raw SDK you call `config.writer(...)` and stream in `custom` mode, then forward that to our SSE. Calling our own event emitter directly is equally easy.
- Gotcha: state must be serializable. Pass the Playwright `Page` and the OpenAI client through closures or the run config, never in state.
- Gotcha: with `previous_response_id`, OpenAI holds the conversation history, so local state stays small but depends on OpenAI's retention [unverified].

**6. Functional API or Graph API**
- Use the Graph API.
- On resume, the Functional API replays from the start of the entrypoint and restores every finished task result. A computer-use loop with hundreds of steps makes those replays grow each time [unverified as a measured cost].
- The Graph API's observe → decide → approve → act loop with conditional edges maps directly onto that cycle and the approval gate.

**7. Alternatives**

| Option | Fit | Cost |
|---|---|---|
| **Hand-rolled state machine (recommended)** | We need leases, idempotency and pruning anyway; the loop is about 300–500 lines over tables we already planned | We own the code and its tests |
| LangGraph.js | Gives checkpoints, interrupts and graph structure | 63 MB / 34 packages, core and sdk we won't use, no locks or TTL, node re-runs on resume |
| OpenAI Agents SDK JS 0.19.0 (MIT) | Closest feature match: a native `computer` tool, per-action `needsApproval`, and run state saved with `RunState.toString()`/`fromString()` | Still pre-1.0. It owns the loop. Tracing is sent to OpenAI by default and must be turned off so screenshots stay out of traces [verify]. Install was 62 MB, including an MCP client |
| Mastra 1.74 (Apache-2.0) | Workflows that can suspend and resume | Heaviest option: hono, posthog-node, A2A packages, three versions of the AI SDK |
| Inngest self-hosted | Durable steps | Server is licensed SSPL (source-available, not open source) and adds another service; ruled out |
| Hatchet self-hosted | MIT, runs on Postgres, good durability | A whole extra engine container just for one loop; overkill for now |

Sources:
- npm registry (`npm view`) and the installed package source (checkpoint-postgres `migrations.js` and `index.js`, langgraph `pregel/types.d.ts`)
- https://docs.langchain.com/oss/javascript/langgraph/interrupts
- https://docs.langchain.com/oss/javascript/langgraph/checkpointers (durability modes)
- https://docs.langchain.com/oss/javascript/langgraph/persistence (troubleshooting and pruning)
- https://docs.langchain.com/oss/javascript/langgraph/functional-api (determinism and idempotency)
- https://docs.langchain.com/oss/javascript/langgraph/streaming ("Use with any LLM")
- https://docs.langchain.com/oss/javascript/langgraph/choosing-apis
- https://github.com/langchain-ai/langgraph/issues/8531 (prune request, open)
- https://github.com/langchain-ai/langgraphjs/issues/2040 (cross-thread contamination with concurrent runs, closed 2026-06)
- https://github.com/openai/openai-agents-js/blob/main/docs/src/content/docs/guides/human-in-the-loop.mdx
- https://github.com/inngest/inngest
- https://github.com/hatchet-dev/hatchet
