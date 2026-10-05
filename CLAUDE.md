# MasterTutor: Agentic Note-Taking System

An AI agent drives its own browser to take faithful notes from websites, PDFs and videos. Its notes and activity live in a deployable web app.

## Orchestration

The main session acts as orchestrator. Before doing anything, read `orchestration/STATE.md`, then `orchestration/INDEX.md`. Every subagent run is saved under `orchestration/runs/`; `orchestration/README.md` has the conventions.

## Hard constraints

- **Hosting:** the whole stack deploys as one Docker Compose app on our own Dokploy server.
- **Cost:** the OpenAI API is the only paid service. Everything else must be self-hosted and free/open source: no cloud browsers, paid OCR, proxies, managed KMS, or hosted auth/email.

## Engineering principles (must follow everywhere in this repo)

1. **Bloat-free.** Add a dependency, layer or abstraction only when a current requirement needs it. Prefer the platform and the standard library. No speculative features or "just in case" config.
2. **Low latency by design.** Stream instead of polling; do work in parallel where it's safe; avoid extra network hops and serialization layers. Keep hot paths (agent loop, screencast, activity stream) lean, and measure before optimizing.
3. **Security first.**
   - Secrets never reach the model, logs, traces or screenshots.
   - Validate input at every trust boundary.
   - Grant least privilege per service.
   - Treat page content as untrusted, because it can carry prompt injection.
   - Risky agent actions need human approval.
4. **Modular and readable.** Each module has one clear purpose and a small public interface. Name things so any reader can follow the code without its author. Keep files focused; a file growing large is a signal to split it.
5. **Decoupled.** Modules talk through explicit interfaces and contracts, not shared internals. No circular dependencies. Swappable boundaries (browser provider, LLM provider, object store, extractors) sit behind interfaces.
6. **No redundancy.** One source of truth for each type, schema and rule. Define shared contracts once, in `packages/`, and import them; never copy them.
