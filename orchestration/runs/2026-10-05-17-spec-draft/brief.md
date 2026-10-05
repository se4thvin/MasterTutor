---
run_id: 2026-10-05-17-spec-draft
date: 2026-10-05
agent_type: general-purpose
phase: spec
status: completed
depends_on: []
---

Draft the written design spec for this project. Return the **entire spec as Markdown as your final reply**. Don't write files: the orchestrator saves it to `docs/superpowers/specs/2026-10-05-agentic-notes-design.md`.

**Sources of truth.** Read all of these. The decisions win over any older detail in the reports.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md`: decisions D1–D30. These are binding.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`: hard constraints and engineering principles.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/INDEX.md`, plus every `orchestration/runs/*/report.md` it links: research runs 01–06, 10, 11, 13, 14 and design run 12.

**Approved design sections, summarized from the conversation (expand them using the reports):**
- **§1 Architecture.**
  - Compose services: `web` (Next.js 16), `agent` (Node worker running Chromium), `postgres` (17 + pgvector; serves as DB, queue and LISTEN/NOTIFY event bus), `garage` (S3), and an optional `docling` profile.
  - `web` and `agent` never call each other. They communicate only through Postgres rows and NOTIFY.
  - The live view connects the user's browser straight to `agent` over a WebSocket, using a short-lived signed token issued by `web`.
  - Monorepo layout: `apps/web`, `apps/agent`, `packages/contracts` (Zod 4, the single source of truth), `packages/db` (Drizzle + drizzle-zod + migrations), `packages/storage`.
  - Agent modules sit behind interfaces: loop, browser, tools, capture, video, vault, notes.
  - Vault: libsodium sealed box. `web` holds only the public key; `agent` holds the private key.
  - No `exec_js`.
- **§2 Runtime.**
  - Run state machine: `queued → running ⇄ waiting(approval|takeover|captcha|otp) → sleeping → running → completed|failed|cancelled`.
  - Sleep and wake: idle for more than 60s → checkpoint, close the browser, sleep. NOTIFY wakes it. One warm Chromium is kept.
  - Checkpoint per step in a single transaction: run_steps, `previous_response_id` plus our own transcript copy, encrypted storageState, URL, scroll position, video time, plan, and note blocks.
  - Restore by re-observing; never blindly replay.
  - Context compaction.
  - Leases with a 10s heartbeat.
  - Guardrails: budgets that pause rather than fail, a domain allowlist, an approval list, loop detection, page content tagged as untrusted, and a kill switch.
  - Persistent sessions per alias+origin.
  - Hand-rolled loop (observe → decide → approve → act) with the `openai` SDK and Zod; no LangGraph, Mastra or Temporal (Temporal is the escape hatch).
  - Default concurrency is 6.
- **§3 Capture.** Covered by D15 and D20, with the tool table: `computer`, `read_page`, `capture`, `fill_credential`, `use_passkey`, `video`, `annotate`. Pipeline: snapshot → Defuddle → assets → verify. The note model has sources, notes and blocks. Add **folders** (nested, `parent_id`) and auto-filing per D23.
- **§4 Vault.** Fields: username, password, totp, pin, otp. OTP arrives via a UI code box or IMAP. Split-PIN inputs are supported. Passkeys go through the CDP WebAuthn virtual authenticator. Checks: origin pinning, frame check, field-type check, first-use approval. Every field is masked in screenshots. There is an append-only audit log.
- **§5 UI.** Mockup D "Cutaway", with amendments D21–D28:
  - background #FAFAFA, glass UI, the existing sidebar kept;
  - an icon system plus folders;
  - a 3D hero on New task (design pending, run 16);
  - takeover by clicking into the preview;
  - delightful animation curves everywhere;
  - responsive breakpoints.
- **§6 Testing and deploy.**
  - Vitest units; Testcontainers integration tests; agent-behaviour tests against fixture sites and a mock OpenAI; full end-to-end via `compose.test.yml` with Playwright.
  - Security tests that fail the build.
  - Dokploy deploy, CI end-to-end with the mock.
  - Also the D22 UI validation swarm and the D28 animation-verification pass.

**Pending research.** For the live-view transport (run 15), specify a `LiveView` transport interface with a CDP-screencast implementation as the default, and mark the WebRTC (n.eko-style) option as "to be finalized from run 15". Do the same for the 3D hero (run 16).

**Spec requirements:**
- **Sections:** Goals & non-goals; Constraints; Architecture; Data model (tables with key columns); Agent runtime; Tools & contracts; Capture; Video; Vault & security; Live view & takeover; UI & design system (tokens summary, screens, motion, responsiveness, icon system, folders); Testing & QA (including the swarm and the animation pass); Deployment; Observability (lean, self-hosted, never logging secrets); Risks & open items; Build phases (an ordered list of independently shippable phases suitable for parallel frontend and backend subagents, D30).
- Every requirement must be unambiguous. No TBDs except the two explicitly pending items above.
- Keep it as concise as precision allows. Target 2500–4000 words.
- Cite run reports by relative path where useful.
