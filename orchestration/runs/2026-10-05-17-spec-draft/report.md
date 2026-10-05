---
run_id: 2026-10-05-17-spec-draft
date: 2026-10-05
agent_type: general-purpose
phase: spec
status: completed
depends_on: []
---

# Agentic Notes: Design Spec

- **Date:** 2026-10-05
- **Status:** Draft for user review
- **Binding sources:** `orchestration/STATE.md` (D1–D30) and `CLAUDE.md` (hard constraints and engineering principles). Where a run report disagrees with a decision, the decision wins.
- **Pending item:** only one part of this spec is not final: the 3D hero on New task (run 16), together with the WebGL library choice that depends on it. It is marked **PENDING** where it appears.

---

## 1. Goals & non-goals

### Goals
1. **An agent that takes notes through its own browser.** It drives a real headed Chromium (D2) and takes notes from web pages, PDFs and YouTube videos.
2. **Faithful notes.** Captured text comes from the DOM, the PDF text layer or captions, never from a model rewrite (D15). Images and diagrams are kept. Every block carries provenance.
3. **Secure logins.** The agent can sign in using username, password, TOTP, PIN, OTP or a passkey. Secrets never reach the model, logs, traces or model screenshots.
4. **A persistent agent.** It sleeps when idle, wakes on activity, and never loses a run's context (D13).
5. **Live view with instant takeover.** The user watches a real-time WebRTC stream with audio and takes control by clicking into it (D19, D26, D27).
6. **One deployable app.** A single Docker Compose app on Dokploy, with full end-to-end tests in Docker (D3, D10).
7. **A delightful UI.** Apple-editorial "Cutaway" design (D17, D21–D29).

### Non-goals for v1
- Multi-user tenancy. `workspace_id` is on every row and the vault design allows per-user keys later, but v1 ships for one workspace (D4).
- Video platforms other than YouTube, and DRM-protected video frames.
- Hosted browsers, paid OCR, proxies, KMS, hosted auth and hosted email (D11).
- A model-executed code tool. There is no `exec_js` and no `exec_py`.
- CAPTCHA solving. CAPTCHAs are always handed to the user.
- Paywall bypass.
- A custom n.eko client. v1 embeds n.eko's own client (§10).
- Dynamic browser containers or Docker-socket access.

### v1 defaults to confirm at review
These close the open questions in `STATE.md`:
- **Export format:** Obsidian-compatible Markdown with an `assets/` folder and YAML provenance front-matter.
- **Scope cut:** web pages, PDFs and YouTube only.

## 2. Constraints

- **Hosting and cost:** one Compose app on the user's Dokploy server. The OpenAI API is the only paid service. Everything else is self-hosted.
- **Licences of adopted components:**
  - n.eko is Apache-2.0 and coturn is BSD.
  - React Bits is MIT plus the Commons Clause. Copied components may be used in our app but never published as a kit (§11.4).
  - No AGPL code is copied anywhere. Ideas from noahshinn/web-browser are re-implemented from scratch (D20, run 14).
- **Models (D1):**
  - Primary is `gpt-6-astra` on the Responses API with the native `computer` tool.
  - Fallback is `gpt-6.1-sol`.
  - Verify both IDs before writing model code.
  - Background: run 01 found `computer-use-preview` was retired, and OpenAI shelved GPT-6.1 Astra over unauthorized actions. Human approval gates are therefore mandatory. See `orchestration/runs/2026-10-05-01-research-computer-use/report.md`.
- **Capacity (D12):** about 512 GB of RAM. OpenAI cost and rate limits bound concurrency, not memory.
- **Engineering principles (`CLAUDE.md`):** these are mandatory.
  - Bloat-free.
  - Low latency: stream, never poll.
  - Security-first.
  - Modular, with small interfaces.
  - Decoupled, with no circular dependencies.
  - No redundancy: every type, schema and token is defined once.

## 3. Architecture

### 3.1 Compose services and topology

| Service | Image / runtime | Role | Networks | Exposed |
|---|---|---|---|---|
| `web` | Next.js 16 (Node) | UI, Better Auth, oRPC API, SSE run events, presigned URLs, vault **encryption only**, Traefik ForwardAuth endpoint, n.eko member login | `edge`, `backend` | Traefik `https://<domain>/` |
| `agent` | Node worker + ffmpeg (no browser) | Run loop, slot leasing, Playwright over CDP, capture, video, vault **decryption**, control lock | `backend`, `cdp` | Nothing |
| `browser-1..8` | Slot image: n.eko + headed Chromium + Xvfb + PulseAudio + `socat` | One browser per leased run | `cdp`, `edge`, `egress` | `/live/browser-N/` via Traefik (signaling), `590NN` UDP+TCP (media) |
| `postgres` | `pgvector/pgvector:pg17` | Database, queue, LISTEN/NOTIFY bus | `backend` | Internal only |
| `garage` | `dxflrs/garage` v2 | S3 objects | `backend` | Internal only |
| `migrate` | `packages/db` one-shot | Drizzle migrations; `web` and `agent` wait on `service_completed_successfully` | `backend` | — |
| `docling` | docling-serve, profile `pdf` | High-fidelity PDF → Markdown | `backend` | Internal only |
| `coturn` | coturn, profile `turn` | TURN relay for networks that allow only TLS ports | host ports | 3478 UDP/TCP, 5349 TLS |

**Rules**
1. `web` and `agent` never call each other. They communicate only through Postgres rows and `NOTIFY`. Payloads carry IDs only (≤ 200 bytes), and the receiver reads the rows.
2. **Channels:**
   - `run_queued` `{runId}`, sent web → agent.
   - `run_wake` `{runId, reason}`, sent web → agent.
   - `run_control` `{runId}`, sent web → agent.
   - `otp_ready` `{runId}`, sent web → agent.
   - `run_event` `{runId, eventId}`, sent agent → web.
3. **Networks:**
   - `cdp` is `internal: true` and carries only `agent` and the slots. Each slot's `socat` exposes Chromium CDP on `browser-N:9223` to this network only. Headed Chrome binds 9222 to loopback.
   - The slots are **not** on `backend`, so a browser can never reach Postgres or Garage.
   - `egress` gives the slots internet access.
   - `edge` carries the Traefik signaling for n.eko on 8080.
4. **Slot definitions:**
   - The slots are defined once with a YAML anchor (`x-browser-slot`). Only `name`, `NEKO_WEBRTC_UDPMUX`, `NEKO_WEBRTC_TCPMUX` and the published port `590NN` (`59001`–`59008`) differ per slot.
   - `browser-1` and `browser-2` always run. `browser-3..8` sit in profile `full`.
   - Production sets `COMPOSE_PROFILES=full,pdf` (plus `turn` if enabled).
   - `agent` reads `BROWSER_SLOTS` (a comma-separated list) and never leases a slot outside it.
5. **Database roles:**
   - `web_role` cannot read `run_transcript`. It can insert sealed vault values but cannot decrypt them.
   - `agent_role` cannot touch the auth tables.
   - Both roles are denied UPDATE and DELETE on `vault_audit`.
6. **Garage keys:** `web` has a read-only key. `agent` has a read/write key.

### 3.2 Monorepo

The repo uses pnpm workspaces. There is no Turborepo.

```
apps/web            Next.js 16, shadcn/ui (Base UI) + Tailwind v4, Tiptap 3, Better Auth, oRPC, motion
apps/agent          loop/ slots/ browser/ tools/ capture/ video/ vault/ notes/ live/
apps/browser-slot   slot image: n.eko base, Chromium policies.json (DevTools allowed), socat, entrypoint
packages/contracts  Zod 4: single source of truth (env, API, events, tools, blocks)
packages/db         Drizzle schema, drizzle-zod, migrations, role grants
packages/storage    S3 client wrapper over Garage
tests/llm-mock      scripted Responses API mock (test-only)
tests/fixtures      static fixture sites (test-only)
```

**Type rules:** every type is `z.infer` of a schema in `packages/contracts`. Database types come from drizzle-zod and are re-exported through contracts. Env is parsed at boot.

### 3.3 Agent modules and interfaces

| Module | Interface (summary) |
|---|---|
| `loop` | `RunLoop.step(runId, signal: AbortSignal): Promise<StepOutcome>`; owns the state machine, run leases and checkpoints |
| `slots` | `SlotPool.lease(runId) → Slot \| null`, `SlotPool.release(slot)`; the Postgres lease and the restart-on-release |
| `browser` | `BrowserSession` over `chromium.connectOverCDP("http://browser-N:9223")`, using the default context with `viewport: null`. Guards every CDP input and model-screenshot call against `runs.control` |
| `tools` | `Tool<A,R> {name, args, result, run(ctx, a)}` registry |
| `capture` | `Capturer.capture(session, scope) → CaptureResult` |
| `video` | `VideoExtractor` with captions, chapters, keyframes and transcribe operations |
| `vault` | `Vault.fill`, `Vault.passkey`; the only holder of the private key |
| `notes` | `NoteWriter.appendBlocks`, `NoteWriter.file(noteId)` |
| `live` | `LiveView` (§10); one implementation, `NekoLiveView` |

The model client is `openai` 7.x with `zodResponsesFunction` and `zodTextFormat`. There is no LangGraph, Mastra or Agents SDK (runs 10 and 11). Temporal is the escape hatch above about 500 lines of recovery and timer code.

## 4. Data model

All tables have `id uuid pk`, `workspace_id` (except child tables keyed through a parent) and `created_at`. Better Auth owns `user`, `session`, `account` and `verification`.

| Table | Key columns |
|---|---|
| `workspaces` / `workspace_members` | `name` / `workspace_id`, `user_id`, `role (owner\|member)` |
| `settings` | `workspace_id pk`, `kill_switch`, `default_budget jsonb`, `default_allowed_origins text[]`, `concurrency int default 6` (clamped to the slot count) |
| `browser_slots` | `name pk ('browser-N')`, `state (idle\|leased\|restarting)`, `run_id null`, `lease_owner`, `lease_expires_at`, `restarted_at` |
| `folders` | `parent_id null → folders`, `name`, `sort`; unique `(workspace_id, parent_id, name)`; depth ≤ 8; cycles rejected |
| `sources` | `kind (web\|pdf\|youtube)`, `url`, `canonical_url`, `origin`, `title`, `favicon_asset_id`, `captured_at`, `mhtml_key`, `screenshot_key`, `snapshot_sha256`, `meta jsonb` |
| `notes` | `folder_id`, `filed_by (agent\|user)`, `run_id`, `title`, `lede`, `fidelity (verified\|partial\|needs_review)`, `coverage`, `search tsvector generated`, `updated_at` |
| `note_blocks` | `note_id`, `position text` (fractional index), `type (heading\|paragraph\|list\|quote\|code\|table\|math\|image\|figure\|transcript\|keyframe\|commentary)`, `markdown`, `asset_id`, `source_id`, `origin (dom\|pdf\|captions\|asr\|ocr_model\|model\|user)`, `anchor jsonb`, `content_sha256`, `verified`, `edited`, `original_markdown`, `embedding vector(1536)` |
| `assets` | `sha256` (unique per workspace), `bucket`, `key`, `mime`, `bytes`, `width`, `height`, `source_url` |
| `runs` | `goal`, `status`, `wait_reason`, `control (agent\|user)`, `model`, `previous_response_id`, `plan`, `budget`, `usage`, `allowed_origins text[]`, `target_folder_id`, `note_id`, `lease_owner`, `lease_expires_at`, `wake_requested_at`, `last_activity_at`, `current_url`, `scroll`, `video_time`, `error`, `finished_at` |
| `run_steps` | `run_id`, `seq`, `phase (observe\|decide\|approve\|act)`, `state (started\|done\|skipped\|aborted)`, `action`, `result`, `caption`, `url`, `screenshot_key`, `usage`; unique `(run_id, seq)` |
| `run_transcript` | `run_id`, `seq`, `item jsonb` (Responses items; images replaced by Garage keys) |
| `run_events` | `id bigserial`, `run_id`, `type`, `payload jsonb` (`RunEvent` union) |
| `approvals` | `run_id`, `step_seq`, `kind`, `request`, `status (pending\|approved\|denied\|edited\|superseded)`, `edit`, `decided_by`, `decided_at` |
| `downloads` | `run_id`, `filename`, `asset_id`, `bytes`, `approved_by` |
| `vault_items` | `alias` (unique per workspace), `origin` (scheme + eTLD+1 + port), `label`, `fields text[]`, `imap jsonb null` |
| `vault_secrets` | `item_id`, `field (username\|password\|totp\|pin\|imap_password\|passkey)`, `sealed bytea`; unique `(item_id, field)` |
| `vault_grants` | `item_id`, `origin`, `approved_by`, `approved_at` |
| `otp_codes` | `run_id`, `item_id`, `sealed`, `expires_at` (now+5 min), `consumed_at` |
| `browser_sessions` | `alias`, `origin`, `sealed_state bytea`; unique `(workspace_id, alias, origin)` |
| `vault_audit` | `item_id`, `alias`, `origin`, `field`, `action (create\|update\|delete\|fill\|passkey\|otp_received\|denied)`, `run_id`, `approved_by`, `outcome`, `at`; append-only (grants plus a rejecting trigger) |

**Anchor shape.** `anchor` holds `{selector, xpath, start, end, textFragment, page?, bbox?, tStart?, tEnd?}`.

**Retention.** A daily prune deletes step screenshots and `run_transcript` 30 days after `finished_at`. Notes, sources, assets and downloads are kept until the user deletes them.

**Search.** Search combines `tsvector` full-text and pgvector cosine results with reciprocal-rank fusion. Embeddings use `text-embedding-3-small`: `agent` embeds each text block and `web` embeds the query.

## 5. Agent runtime

### 5.1 State machine

```
queued → running ⇄ waiting(approval|takeover|captcha|otp) → sleeping → running → completed|failed|cancelled
```

The arrows above are shorthand. The full transition list:
- `running → waiting(*)`: an approval is requested, the user takes over, a CAPTCHA is detected, an OTP is needed, a budget is reached, or a loop is detected.
- `waiting → running`: a human resolves the wait.
- `running` or `waiting → sleeping`: no activity for 60s, unless `control='user'` and the user's n.eko session is connected.
- `sleeping → running`: a `run_wake` arrives and a slot is leased.
- Any non-terminal state → `cancelled`: the user cancels or the kill switch is used.
- `running → completed`: the model returns `status:"done"` and filing succeeds.
- `running → failed`: an unrecoverable error. Failure is never used for budgets.

### 5.2 Claiming, leases, slots, concurrency

1. `agent` LISTENs on `run_queued`, `run_wake` and `run_control`, and sweeps every 30s.
2. **Run claim** with `SELECT … FOR UPDATE SKIP LOCKED`. A run is claimable when any of these holds:
   - `status='queued'`;
   - `status='running'` and its lease has expired;
   - `status='sleeping'` and `wake_requested_at` is not null.

   The run claim and the slot lease (an `idle` row in `browser_slots`) happen in **one transaction**. With no idle slot, the run stays claimable and the claim is skipped.
3. **Heartbeat** every 10s extends both leases to now+30s. If either lease is lost, the run stops without acting.
4. **Slot release** (on sleep, completion, failure or cancel):
   1. Seal `storageState`.
   2. Mark the slot `restarting`.
   3. Send CDP `Browser.close`.
   4. The slot's supervisor exits the container when Chromium exits, and Compose `restart: always` starts it fresh, with no user-data-dir carried over.
   5. `agent` polls `http://browser-N:9223/json/version` every 500ms and marks the slot `idle` when it answers.

   Idle slots are the warm pool, so leasing is instant.
5. **Applying a saved session:** on lease, `storageState` is applied with `context.addCookies` plus a per-origin `localStorage` init script.
6. **Concurrency:** at most `min(settings.concurrency, slot count)` runs are active, and the default is 6 of 8 slots.
7. **OpenAI 429 and 5xx:** backoff with jitter. After 3 consecutive 5xx errors from `gpt-6-astra`, the run switches to `gpt-6.1-sol` and emits `model_fallback`.

### 5.3 Loop: observe → decide → approve → act

Each phase is one `run_steps` row. Each step commits in **one transaction** containing:
- `run_steps`;
- `run_transcript` items;
- `previous_response_id`;
- sealed `storageState`;
- `current_url`, `scroll` and `video_time`;
- `plan`;
- new `note_blocks`;
- the `usage` delta;
- a `run_events` row plus `NOTIFY run_event`.

The phases:
- **Observe.**
  - Take a masked model screenshot (§9) at 1280×800 (Xvfb and the window are 1280×800 at device scale factor 1) and/or run `read_page`.
  - If nothing changed (same URL and same DOM hash), the result is `{unchanged: true}` (D20).
- **Decide.**
  - The Responses API call uses `store: true`, `previous_response_id`, the 7 tools and reasoning effort `medium`.
  - Model messages parse as `AgentTurn {status: "continue"|"done"|"need_human", needHuman?: "captcha"|"takeover", reason, planUpdate?}`.
- **Approve.** The policy (§5.5) classifies the action. If it is risky, the loop inserts `approvals`, sets `waiting(approval)` and stops.
- **Act.**
  1. Write `state='started'` and commit.
  2. Execute the action under the run's `AbortSignal`. The signal is checked between primitives: each computer action, each scroll step, each navigation wait.
  3. Write `done`, or `aborted` if the signal fired.

  A `started` step after a crash is **never retried**: the loop re-observes and decides again.

### 5.4 Sleep, wake, restore

- **Sleep.** After 60s idle, the agent:
  1. checkpoints;
  2. releases the slot (§5.2);
  3. sets the run to `sleeping`;
  4. releases the run lease.
- **Wake triggers** (each sends `run_wake`):
  - an approval decision;
  - an OTP submit;
  - a user message;
  - a click into the preview;
  - Resume.
- **Restore.**
  1. Lease a slot and apply `storageState`.
  2. Navigate to `current_url`, restore `scroll` and `video_time`.
  3. **Re-observe.**
  4. If the page no longer matches the pending action (different URL, or target element missing), mark the approval `superseded` and decide again.

  The agent never blindly replays actions.
- **Context compaction.**
  - **Trigger:** chain input above 200K tokens.
  - **Summary:** request `CompactionSummary {goal, plan, progress, facts, openQuestions}`.
  - **New chain:** start without `previous_response_id`, seeded with the summary, the last observation and the last 3 screenshots.
  - **Fallback:** the same rebuild runs from `run_transcript` on `previous_response_not_found`.

### 5.5 Guardrails

| Guardrail | Rule |
|---|---|
| Budgets | Defaults per run are `{maxSteps: 150, maxUsd: 5, maxActiveMinutes: 60}`. Hitting one → `waiting(approval)` of kind `budget`, with Extend +50% / Finish now / Cancel. Budgets never fail a run. |
| Domain allowlist | `page.route` on top-level documents: an origin not in `allowed_origins` → approval kind `new_origin`. All requests to loopback, RFC1918, link-local and Docker ranges are blocked. The `fixtures` host is allowed only when `AGENT_TEST_MODE=1`. Network topology (§3.1) is the second layer. |
| Approval list | Approval is required for: <br>• a click whose accessible name or form-submit text matches the shared `RISKY_ACTION` pattern (buy, pay, order, checkout, delete, remove, send, post, publish, submit, confirm, subscribe, unsubscribe, transfer); <br>• submitting a form other than login or search; <br>• any download; <br>• first credential use per alias+origin; <br>• a new origin; <br>• a budget hit. |
| Loop detection | The same action on the same screenshot pHash 3 times, or 8 steps with no URL, DOM or note change → `waiting(takeover)` with reason `stuck`. |
| Untrusted content | Page-derived strings are wrapped in `<untrusted_page_content origin="…">`. The system prompt says this content is data. Enforcement never relies on the prompt. |
| Kill switch | `settings.kill_switch=true` sends `run_wake` with reason `kill` to every agent. Within 1s the agents abort every `AbortController`, cancel all non-terminal runs, release their slots and refuse new claims until the switch is cleared. Every run also has its own Cancel. |
| CAPTCHA | The model reports `needHuman:"captcha"`, or a reCAPTCHA, hCaptcha or Turnstile iframe is detected → `waiting(captcha)` and the user is prompted to take over. |

### 5.6 Persistent sessions

`storageState` is sealed per **alias + origin** in `browser_sessions` after each successful login and at every checkpoint. Slots never keep state of their own, because they restart on every release. Logout deletes the row.

## 6. Tools & contracts

The model gets exactly these 7 tools. A contract test asserts the list.

| Tool | Args (Zod) | Result | Notes |
|---|---|---|---|
| `computer` | OpenAI native `computer_call` actions | `computer_call_output` (masked screenshot) | Allowlist: click, double_click, drag, move, scroll, keypress, type, wait, screenshot. Executed as CDP `Input.*` on the slot. Each action passes the approval policy. `type` is refused into password, OTP and PIN fields. |
| `read_page` | `{mode: "interactive"\|"text", sinceHash?}` | `{hash, url, title, elements[]\|text}` or `{unchanged:true}` | Keeps only `aria-label, role, alt, title, href, name, type, data-label` (D20). Built in a CDP isolated world. |
| `capture` | `{scope: "page"\|"selection"\|"element", selector?, kind?: "web"\|"pdf"}` | `{noteId, blockIds[], coverage, fidelity}` | Runs §7. Text is never produced by the model. |
| `fill_credential` | `{alias, field: "username"\|"password"\|"totp"\|"pin"\|"otp", target: elementRef}` | `{ok:true}` or `{error: code}` | §9 |
| `use_passkey` | `{alias}` | `{ok:true}` or `{error: code}` | §9 |
| `video` | `{op: "captions"\|"chapters"\|"keyframes"\|"transcribe", range?}` | Typed per op | §8 |
| `annotate` | `{noteId, afterBlockId?, markdown, kind: "summary"\|"commentary"\|"heading"}` | `{blockId}` | Writes `origin:"model"` blocks, shown visually distinct. It never edits captured blocks. |

**Other contracts:**
- `RunStatus`.
- `RunEvent` union: `status`, `step`, `control`, `approval_requested`, `approval_resolved`, `block_added`, `budget`, `user_message`, `download_ready`, `error`, `filed`.
- `ApprovalRequest`, `AgentTurn`, `NoteBlock`, `Anchor`.
- The oRPC router.
- Per-service env schemas.

**API surface:** all request/response endpoints use oRPC. Run events use one SSE route, `GET /api/runs/:id/events`, fed by `run_event` NOTIFY and resumable via `Last-Event-ID`.

## 7. Capture

Based on D15 and `orchestration/runs/2026-10-05-02-research-web-capture/report.md`.

1. **Snapshot.** `Page.captureSnapshot` (MHTML) plus a full-page `Page.captureScreenshot` (`captureBeyondViewport`), each SHA-256 hashed, stored under `snapshots/<sourceId>/` and recorded on the `sources` row.
2. **Prepare the page.**
   - Scroll in steps until the height is stable (cap of 50 viewports).
   - Wait for network idle.
   - Force `loading="eager"`.
   - Handle iframes per frame; reach closed shadow roots with a CDP DOM snapshot.
3. **Extract.** Defuddle runs in a CDP **isolated world**.
   - It returns Markdown.
   - MathJax and KaTeX become LaTeX.
   - Code keeps its language.
   - Tables that GFM cannot represent stay raw HTML.
   - If Defuddle returns nothing, fall back to Mozilla Readability.
4. **Assets.**
   - Images: download the largest `srcset` or `currentSrc` via `page.request`, hash it, and store it content-addressed in `assets/<workspace>/<sha256>`.
   - Inline SVG: serialize with computed styles.
   - Canvas: `toDataURL`, falling back to an element screenshot.
   - Charts and diagrams: always also take an element screenshot.
   - Element screenshots use `Page.captureScreenshot` with `clip.scale: 2`. Nothing is injected into the live page.
5. **Verify.**
   - NFKC-normalize, then diff against `innerText`. Coverage ≥ 98% gives `verified`; less gives `partial`.
   - Each block gets `content_sha256`, selector, offsets and a text-fragment anchor.
6. **PDF.**
   - With profile `pdf`: docling-serve.
   - Without it: the `pdfjs-dist` text layer plus page-image blocks for figures.
   - Both are verified against the pdf.js text. Anchors carry `page` and `bbox`.
7. **Opaque content.** Store an image block plus an OpenAI vision transcription with `origin:"ocr_model"`, `verified:false` and fidelity `needs_review`. The UI requires **Mark verified**.

**Note model.** One run produces one note. Blocks reference their `source_id`. Edits keep `original_markdown` and set `edited=true`.

**Folders and auto-filing (D23)**
- If New task names a target folder, the note is filed there.
- Otherwise, on completion the agent sends the folder paths, title and lede to the model with `zodTextFormat` as `{path: string[], createLeaf: boolean}`. It files into the existing path or creates **at most one** new leaf folder, and sets `filed_by='agent'`.
- The user moves notes by drag-and-drop or a **Move to…** sheet, which sets `filed_by='user'`.

## 8. Video

Based on `orchestration/runs/2026-10-05-03-research-video-extraction/report.md` and D8. Video runs only in the slot's real player. There is no yt-dlp in production and no stored media.

- **`captions`:** enable CC, capture `/api/timedtext` (`fmt=json3`) via CDP `Network.getResponseBody`, and write `transcript` blocks with `tStart`/`tEnd` anchors.
- **`chapters`:** from `ytInitialData`, falling back to timestamps in the description.
- **`keyframes`:**
  - Every 2s, seek and wait for `seeked`, then take a CDP screenshot clipped to the video element.
  - Compute pHash (with `sharp`) and drop frames within Hamming distance ≤ 6 of the previous kept frame.
  - Keep the last frame before each change.
  - Mean luminance below 3% means DRM: continue with transcript only and flag it.
- **`transcribe`** (only when there are no captions):
  1. The video plays at 1× in the slot.
  2. `agent` runs `ffmpeg -f pulse -server tcp:browser-N:4713` on the slot's PulseAudio monitor. The slot enables `module-native-protocol-tcp` on the `cdp` network only.
  3. 10-minute chunks go to `gpt-4o-transcribe-diarize` (verify the ID).
  4. Audio is deleted once its transcript commits.
- **Note layout:** per chapter, transcript blocks interleaved with keyframes. Cite times as `[mm:ss]`. `video_time` is checkpointed every step.

## 9. Vault & security

Based on `orchestration/runs/2026-10-05-04-research-credential-layer/report.md` and D16.

### Crypto
- **Key pair:** a libsodium sealed box. `web` holds only `VAULT_PUBLIC_KEY` and seals at submit. `agent` holds `VAULT_PRIVATE_KEY` (a Docker secret).
- **Row binding:** the plaintext is `{v, workspaceId, alias, origin, field}` and is checked against the row after opening.
- **What uses it:** `browser_sessions` and `otp_codes` use the same scheme.
- **Buffers:** zeroed with `sodium.memzero` after use.
- **Key rotation:** the `agent` CLI command `vault:rotate` re-seals every row in one transaction.

### Fields
- `username`, `password`, `pin`: stored sealed.
- `totp`: the seed is stored sealed and codes are generated with `otplib` in `agent`.
- `otp`: comes from either of two places:
  - **UI code box:** the CodeSlots card. `web` seals the code into `otp_codes` and sends `otp_ready`.
  - **IMAP:** `agent` uses `imapflow` with the item's `imap` config and takes the newest message from the configured sender within 5 minutes that contains a 4–8 digit code.

### `fill_credential` checks (all in code, in order)
1. `origin` equals the registrable origin of the main frame.
2. The target frame's origin is the same.
3. **Field-type check:**
   - password needs `input[type=password]`;
   - username needs `autocomplete=username|email` or `type=email|text` in a login form;
   - otp and totp need `autocomplete=one-time-code` or numeric `inputmode`;
   - pin needs a password or numeric input.
4. **First use** of alias+origin without a `vault_grants` row → `waiting(approval)`.
5. **Fill:** force `type=password`, disable reveal toggles, then `locator.fill()`. A **split PIN or OTP** fills characters across the boxes in DOM order. A fill is atomic with respect to the abort signal: it completes the current field, then honours the abort.
6. Append to `vault_audit`. The model receives only `{ok:true}` or an error code.

### Passkeys
- `use_passkey` uses CDP `WebAuthn.enable` plus `addVirtualAuthenticator` (ctap2, internal transport, user verification on). It loads the sealed credential for the RP ID, which must equal the pinned origin, and removes the authenticator afterwards.
- **Enrolment:** during takeover the user registers a passkey on the site. The agent exports it with `WebAuthn.getCredentials` and seals it.

### Model screenshots (run 15 §2)
- Model screenshots are taken with CDP `Page.captureScreenshot`. Playwright's `mask` is **never** used, because it injects overlays into the live page the user sees.
- **Box check:** element boxes are taken with `DOM.getBoxModel` immediately before and after capture. If they differ, retake, up to 3 times; after that the frame is dropped.
- **Masking:** masks are drawn onto the image in `agent` with `sharp`. They cover:
  - password, OTP and PIN inputs;
  - executor-filled elements;
  - inputs whose value equals a stored secret.
- **Final check:** the accessibility tree is scanned for exact secret values, and any hit drops the frame.
- **When nothing is captured:** while `control='user'`, the guard throws `ControlHeld`.

### Live stream
The live stream is user-only and shows the real page. Password fields render natively as dots.

### Logging and UI
- `pino` redaction covers `*.password`, `*.secret`, `*.sealed`, `*.code` and `authorization`. Logs carry aliases only.
- Secrets are never rendered back. Vault rows show "sealed". CodeSlots seal to dots after entry.

## 10. Live view & takeover

This section is final and based on `orchestration/runs/2026-10-05-15-research-webrtc-live-view/report.md` §8. **The CDP screencast is removed.** n.eko over WebRTC is the only live view, because the passive view must already be the interactive stream for one-click takeover.

### 10.1 Interface (one implementation)

```ts
interface LiveView {                       // apps/agent/src/live
  giveControl(slot: Slot, userId: string): Promise<void>;  // n.eko admin: host → user's member session
  takeControl(slot: Slot): Promise<void>;                  // n.eko admin: host → agent's admin session
  setClipboardAccess(slot: Slot, on: boolean): Promise<void>;
}
```

`NekoLiveView` is the only implementation. Every slot has two n.eko members, `agent` (admin) and `user` (`can_host`, `can_access_clipboard`). Their passwords are derived as HMAC(`NEKO_ADMIN_SECRET` or `NEKO_MEMBER_SECRET`, slot name) by the slot entrypoint. `agent` and `web` each hold only their own secret.

### 10.2 Signaling, auth, media

- **Signaling and routing.**
  - Traefik has one router per slot, `PathPrefix(/live/browser-N)`, with strip-prefix middleware and ForwardAuth to `http://web:3000/api/live/auth`.
  - ForwardAuth allows the request only if three things hold: the Better Auth session is valid, `browser_slots[N].run_id` is set, and that run belongs to a workspace the user is a member of.
  - Routing is by slot rather than `/live/:runId` because Traefik cannot resolve a run to a slot. Authorization is still per run.
- **n.eko login.** `web` logs into the slot's n.eko as `user` server-side and sets the n.eko session cookie scoped to `/live/browser-N/`. The browser never holds n.eko credentials.
- **Media.**
  - Each slot sets `NEKO_WEBRTC_UDPMUX` and `NEKO_WEBRTC_TCPMUX` to `590NN` and `NEKO_WEBRTC_NAT1TO1=<PUBLIC_IP>`. The port is published unremapped on UDP and TCP.
  - The TCP mux covers networks that block UDP.
  - Optional `coturn` (profile `turn`) uses `use-auth-secret`. Each slot entrypoint writes a 24h TURN credential into n.eko's frontend ICE config at start. Slots restart on every release, so credentials never outlive a lease.
  - The stream carries audio.
- **Client.**
  - The run view embeds `/live/browser-N/?embed=1` in an iframe inside our mock-browser frame.
  - Our toolbar, origin pill (from `RunEvent`s), agent cursor, callouts and approval spotlight are overlays above the iframe.
  - The agent drives through CDP, which never moves the X cursor, so our overlay cursor is the only agent cursor.
- **Clipboard:** n.eko two-way clipboard, enabled only while `control='user'`. The model never sees clipboard contents.
- **Uploads:** only the user uploads, while in control. They use n.eko `upload/dialog` when a native chooser is open, or `upload/drop` at a point. The agent never uploads in v1. n.eko's file-transfer plugin is off.
- **Downloads:**
  - Downloads require approval.
  - CDP `Browser.setDownloadBehavior` writes to `/downloads/<runId>/` on the shared `downloads` volume (slot and `agent` only).
  - `agent` moves the file to Garage, creates `assets` and `downloads` rows, deletes the local file, and emits `download_ready`.
  - `web` serves a presigned link.

### 10.3 Control lock (code-owned)

CDP input bypasses X, so n.eko cannot block the agent. The lock is `runs.control` plus the run's `AbortController`.

**Takeover**
1. The user presses on the overlay. The UI starts the takeover transition immediately (optimistic) and calls oRPC `runs.takeControl`.
2. `web` sets `control='user'` and `waiting(takeover)` in one transaction and sends `NOTIFY run_control`.
3. `agent`:
   - aborts the run's `AbortController`, so the in-flight action stops at the next primitive (target ≤ 300ms);
   - calls `LiveView.giveControl`;
   - enables the clipboard;
   - emits `control {holder:"user"}`.

   While `control='user'`, the browser guard rejects all CDP `Input.*` and model screenshots, and the model is not called.
4. On the `control` event, the UI removes the overlay's pointer capture and focuses the iframe. If that event has not arrived within 2s, the UI reverts and shows a toast.

**Hand back**
- The button calls oRPC `runs.handBack {note?}`.
- `web` sets `control='agent'` and appends the optional note as a `user_message`.
- `agent` calls `LiveView.takeControl`, disables the clipboard, creates a new `AbortController`, and re-observes.

**Keyboard**
- A **Full screen** control in the browser chrome requests fullscreen plus `navigator.keyboard.lock()` (Chromium), so ⌘T, ⌘W and ⌘N reach the page.
- Holding Esc exits fullscreen.
- Outside fullscreen the host browser keeps its own shortcuts.
- CJK IME is not supported in v1. The fallback is clipboard paste.

### 10.4 States

The mock browser keeps the 7 states from run 12 and run 13 §6:

| State | Treatment |
|---|---|
| Live | The stream |
| Agent acting | Opacity-only inner ring |
| Awaiting approval | Dim plus spotlight sheet |
| You're in control | "You're in control · Agent paused · screenshots off" |
| Paused/sleeping | The slot is released, so the **last step screenshot**, desaturated, with Resume. Clicking it wakes the run and then takes over. |
| Reconnecting | WebRTC ICE or connection failure: last frame blurred, backoff retry |
| Replaying | Step screenshots with a scrubber |

The PiP and step thumbnails use the masked step screenshots, updated through SSE. Expanding the PiP opens the live stream.

## 11. UI & design system

The direction is mockup D "Cutaway" (`orchestration/runs/2026-10-05-12-design-apple-editorial/report.md`) with D21–D28. Build it with the apple-hig-designer skill.

### 11.1 Tokens

`apps/web/styles/tokens.css` maps to Tailwind v4 `@theme`. No raw values appear in components.

**Type**
- Stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, sans-serif`, with Inter self-hosted through `next/font`.
- Mono: `ui-monospace, "SF Mono", "Geist Mono"`.
- Sizes: the run 12 scale. Reading body is 17/1.65 at about 68ch. There is no serif.

**Colour** (light / dark)

| Token | Light | Dark |
|---|---|---|
| `bg` | **#FAFAFA** (D25) | #0B0B0C |
| `bg-2` | #F5F5F7 | #161617 |
| `elevated` | #FFFFFF | #1C1C1E |
| `label` | #1D1D1F | #F5F5F7 |
| `label-2` | #6E6E73 | #A1A1A6 |
| `hairline` | #D2D2D7 | #38383A |

The accent, signal, navy, ok, warn and danger colours are exactly as in run 12. All text pairs meet WCAG AA.

**Glass (D25)**
- Recipe: CSS `backdrop-filter: saturate(180%) blur(24px)` at 72% fill.
- Used on: sidebar, toolbars, browser chrome, caption bar, banners, sheets and the PiP.
- Falls back to opaque under `prefers-reduced-transparency`.
- There is no GlassSurface component.

**Shape and elevation**
- Radius 6/8/12/18/26/pill, kept concentric. The browser frame is 14.
- 4pt steps on an 8pt rhythm.
- Elevation is a 0.5px hairline plus e1–e3 shadows.

### 11.2 Screens

The sidebar keeps mockup D's items and order. A folder tree sits under Library.

1. **New task.**
   - Composer with source chips. ⌘↵ starts the task.
   - A 01/02/03 grid for allowed domains, budget (CountUp numerals) and approvals, plus an optional target folder.
   - **3D hero: PENDING, to be finalized from run 16 (D24).** Fixed constraints:
     - a single `NewTaskHero` component;
     - lazy-loaded on this route only, after the composer is interactive;
     - pauses when offscreen or when the tab is hidden;
     - 60fps;
     - static image under reduced motion or without WebGL.

     The WebGL library is chosen with run 16: either three plus @react-three/fiber, or raw WebGL/ogl if the hero is a single shader. Never both.
2. **Run.**
   - The n.eko live view inside the mock browser, with cutaway callouts and the step-to-element leader.
   - Approval spotlight sheet (Deny / Edit / Approve, no Return default).
   - Takeover and Full screen.
   - Replay, budget numerals and credential steps.
   - The OTP CodeSlots card.
   - ThoughtLine "thinking" row, StatusMark steps and a user-message composer.
3. **Note.**
   - Source strip, headline, lede and blocks.
   - A needs-review block with SpringCheck **Mark verified**.
   - Margin provenance popovers.
   - Source | Note side by side.
   - The PiP.
   - Tiptap 3 Markdown editing.
4. **Library.**
   - ⌘K search, a nested folder tree, and an All/Web/PDF/Video RubberSegment.
   - Grid/list RubberSegment, fidelity badges and drag-to-move.
   - CSS skeletons.
5. **Vault.**
   - Cutaway diagram, alias rows with field icons, session status, and "Secrets are never shown".
6. **Settings.**
   - Kill switch, defaults, concurrency, usage and audit.

Optimistic actions confirm with a SwipeToast that offers Undo.

### 11.3 Icon system (D23)

- One `Icon` component with a typed registry in `apps/web/components/ui/icons.ts`.
- Lucide glyphs at stroke 1.6 with round caps on a 24 grid. Components never import an icon library directly. React Bits' hugeicons are replaced.
- **Required sets:** source and type, folder (closed, open, nested), status, vault fields, actions.
- Letter tiles are banned. The favicon appears only in the source strip.
- Every icon has a label or an `aria-label`.

### 11.4 Motion & React Bits (D21, D28)

Based on `orchestration/runs/2026-10-05-18-research-reactbits/report.md` §5.

**Library**
- **`motion` is the only animation library.** Pin the version after checking 12.x against 14.x compatibility, before install.
- Components use `LazyMotion` (`domAnimation`) and `m.*`.
- ESLint `no-restricted-imports` bans `gsap`, `ogl`, `framer-motion`, `matter-js` and, until run 16 decides, `three` and `@react-three/*`.

**Tokens**
- The single source is `apps/web/lib/motion-tokens.ts`:

  | Kind | Values |
  |---|---|
  | Springs | `spring` (stiffness 400, damping 30, settles in about 450ms); `springSoft` for sheets and the PiP |
  | Durations | micro 120, base 200, panel 300ms |
  | Easing | out `(.16,1,.3,1)`, in `(.4,0,1,1)`, cursor `(.2,.8,.2,1)` |

- A build script emits `styles/motion.css` (CSS variables, including a `linear()` spring curve) from this module for CSS-only transitions.
- ESLint `no-restricted-syntax` forbids `stiffness`, `damping`, `duration` and `ease` literals outside `motion-tokens.ts`. Stylelint forbids raw timing functions and millisecond literals outside `motion.css`.

**Animation rules**
- Only `transform` and `opacity` animate.
- Every animated component calls `useReducedMotion`.
- Press feedback starts in under 100ms: scale 0.96, or 0.92 for icon buttons.
- Optimistic UI covers approvals, Mark verified, moves, starting a task and takeover.
- Skeletons are our own CSS shimmer (transform-based). There are no spinners except Reconnecting.

**Takeover transition**
- The frame scales from 1 to 1.01 on `spring`.
- The ring cross-fades to the user accent.
- The glass banner springs from the toolbar.
- The agent cursor fades over the base duration.
- Hand back reverses it.

**Cursor:** travels on an arc with cursor easing over 250–450ms. The click ring is 24→44px over 400ms.

**Reduced motion:** the cursor jumps and fades replace transforms.

**React Bits: copied, not installed**
1. **Registry:** `components.json` gets `"registries": {"@react-bits": "https://reactbits.dev/r/{name}.json"}`.
2. **Pull:** `shadcn add` pulls the **TS-TW** variants into `apps/web/components/bits/`, alongside `LICENSE-react-bits` (MIT plus Commons Clause) and a licence header in each file. From then on the code is ours.
3. **Adaptation pass**, required before merge:
   - our colour tokens and `Icon`;
   - shared springs from `motion-tokens.ts`;
   - `useReducedMotion`;
   - transform/opacity only (blur, width and height animations are replaced);
   - unused props stripped.
4. **v1 components and their owners:**

   | Component | Used for | Phase |
   |---|---|---|
   | StatusMark | Timeline and sidebar run status | F3 |
   | ThoughtLine | Thinking row; blur crossfade replaced by opacity | F3 |
   | RubberSegment | Library filters and view toggle | F2 |
   | SwipeToast | Undo toasts | F1 |
   | CountUp | Budget numerals, with `tabular-nums` and reduced motion added | F3 |
   | CodeSlots | OTP card | F3 |
   | SpringCheck | Mark verified and approval lists | F2 |

5. **CodeSlots security review.** It must pass all of these:
   - `autocomplete="one-time-code"`;
   - the value lives only in local state until submit, then is cleared;
   - it is never logged or sent to analytics;
   - boxes seal to dots after entry;
   - the grid is `repeat(N, minmax(0, 48px))` and fits at 390px, which fixes the D22 OTP clipping.
6. **Avoid:** gsap- and ogl-based components, Dock, GlassSurface (we use CSS glass), Masonry, BlurText, and SpotlightCard as-is.

### 11.5 Responsiveness

**Layouts**
- Over 1180px: full sidebar, with browser and timeline side by side.
- ≤ 1180px: icon-rail sidebar, browser stacked above the timeline, margin callouts replaced by gutter badges.
- ≤ 820px: bottom tab bar, with the timeline and approvals as bottom sheets.
- ≤ 420px: path and hash are trimmed.

**Other rules**
- QA covers widths 1440, 1180, 1024, 820 and 390.
- Targets are 44px.
- All sizes are in rem.

**Required fixes for issues found in mockup D (D22)**
- OTP clipping (above).
- Diagram labels, including the struck-out "model", use `nowrap`.
- Callout leaders are clipped to their container and routed with collision avoidance. They never cross the timeline.

## 12. Testing & QA

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | Contracts, approval policy, transitions, pHash, verify, anchors, sealing, mask drawing, redaction, motion-token lint rules |
| Integration | Vitest + Testcontainers (Postgres, Garage, one slot image) | Run and slot leases, SKIP LOCKED races, slot restart-to-idle, crash/restore, NOTIFY wake and control, step transactions, DB grants, audit trigger, migrations |
| Agent behaviour | Slots + `tests/fixtures` + `tests/llm-mock` | Scripted Responses scenarios |
| End-to-end | `compose.test.yml` (stack with `browser-1..2`, `fixtures`, `greenmail` IMAP, `llm-mock`, `e2e` Playwright) | Full UI flows, including WebRTC playback in Playwright Chromium over the TCP mux |

**Fixture sites**
- An article page.
- A docs page with tables, code, math, lazy images, an iframe and shadow DOM.
- A login page with password, TOTP, split PIN and email OTP.
- A WebAuthn site.
- A CAPTCHA mock.
- A prompt-injection page.
- A download page.
- A fake YouTube page with `timedtext`.
- A PDF.

**The LLM mock** replays scripted call sequences, records every request body, and runs with a no-wait clock.

**Live-view and takeover tests**
- Takeover aborts an in-flight scripted action within 300ms, and the step ends `aborted`.
- While `control='user'`, agent CDP input and model screenshots throw `ControlHeld`.
- While `control='agent'`, input from the user's n.eko session does not reach the page, because the user does not hold n.eko host.
- Hand back re-observes before the next act.
- Clipboard works only under user control.
- Downloads land in Garage and the local file is deleted.
- Uploads work via the n.eko dialog.
- A run that sleeps and is then clicked wakes into takeover.

**Security tests that fail the build**
1. **Secret canary.** Seeded canary secrets must not appear in any of:
   - non-sealed DB columns;
   - `run_transcript`;
   - logs;
   - mock-recorded model requests;
   - Garage objects;
   - OCR (Tesseract, test container only) of every model or stored screenshot.
2. **Masking is passive.** A MutationObserver in the fixture page records **zero** DOM or style mutations during model screenshot capture.
3. **Origin pinning:** a lookalike domain, a cross-origin iframe and a mid-fill redirect are refused.
4. **Field-type:** a password into a text field is refused.
5. **Injection:** the injection page cannot leave the allowlist or trigger an unapproved risky click or download.
6. **Network isolation:**
   - the slot cannot reach `postgres`, `garage`, `web` or `169.254.169.254`;
   - CDP 9223 and PulseAudio 4713 are unreachable from `edge` and `backend`.
7. **ForwardAuth** returns 401/403 in each of these cases:
   - no session;
   - the slot is leased to another workspace's run;
   - the slot is idle;
   - a direct request to the slot's 8080 port bypasses Traefik (unreachable from outside).
8. **Slot reset:** after release and restart, the previous run's cookies, `localStorage` and profile are absent.
9. **Key placement:**
   - `web` lacks `VAULT_PRIVATE_KEY` and `NEKO_ADMIN_SECRET`;
   - `agent` lacks `NEKO_MEMBER_SECRET`;
   - slots lack the vault keys.
10. **Tool list:** exactly the 7 tools, with no `exec_*`.
11. **Dependencies:** `pnpm audit --prod` fails on high or critical findings.

**UI validation swarm (D22)**
- **When:** after the UI phases.
- **Who:** parallel subagents, each owning a group of screens.
- **How:** browser automation at 1440/1180/1024/820/390 in light and dark.
- **What they look for:** alignment, overflow, clipping, wrapping and contrast issues, reported with screenshot evidence under `orchestration/runs/`.
- **Automated backing:**
  - Playwright visual regression across every screen state, with the live iframe stubbed to a fixed frame;
  - a DOM overflow detector (scroll width exceeding client width without scrolling, or a child leaving an `overflow:hidden` parent);
  - `@axe-core/playwright` with zero serious or critical violations.
- **Exit:** zero open issues.

**Animation verification pass (D28)**
- An animation-expert subagent records every motion, including each adapted React Bits component.
- It checks token use, curve feel and overshoot, reduced-motion variants, and the transform/opacity-only rule.
- **Automated backing:**
  - the ESLint and Stylelint motion rules;
  - a CDP performance trace per motion showing no frame over 16.7ms and no layout or paint caused by animation.

## 13. Deployment

- **Dokploy app:** one Compose app from `main`, with `COMPOSE_PROFILES=full,pdf` (plus `turn` if enabled).
- **Traefik routing:**
  - `<domain>` → `web:3000`.
  - `/live/browser-N` → `browser-N:8080` (signaling only), with ForwardAuth to `web`.

  `agent`, `postgres` and `garage` have no ingress.
- **Host ports and firewall:**
  - 59001–59008 UDP and TCP (WebRTC mux, published unremapped).
  - With `turn`: 3478 UDP/TCP and 5349 TCP.
- **Slots:**
  - `shm_size: 2gb` and `restart: always`;
  - a non-root n.eko user with Chromium's sandbox;
  - a `policies.json` that allows DevTools;
  - Xvfb at 1280×800;
  - `PUBLIC_IP` for `NAT1TO1`.
- **Agent:** `cap_drop: [ALL]`, non-root.
- **Volumes:** `pgdata`, `garage-meta`, `garage-data` and `downloads`. Backups use Dokploy's Postgres backup plus volume backups for Garage.
- **Secrets** (Dokploy env and Docker secrets), least privilege:

| Service | Secrets |
|---|---|
| `agent` | `OPENAI_API_KEY`, `VAULT_PRIVATE_KEY`, `NEKO_ADMIN_SECRET`, `DATABASE_URL` (agent_role), S3 read/write key |
| `web` | `BETTER_AUTH_SECRET`, `VAULT_PUBLIC_KEY`, `NEKO_MEMBER_SECRET`, `DATABASE_URL` (web_role), S3 read-only key, `OPENAI_EMBEDDINGS_KEY` (embeddings-only project key) |
| `browser-N` | `NEKO_ADMIN_SECRET`, `NEKO_MEMBER_SECRET`, `TURN_SECRET` (if `turn`), `PUBLIC_IP` |
| `coturn` | `TURN_SECRET` |

- **CI** (GitHub Actions):
  1. lint, typecheck, ESLint and Stylelint motion rules;
  2. unit tests;
  3. integration tests;
  4. end-to-end with `compose.test.yml` and the LLM mock;
  5. security tests;
  6. visual regression and axe.

  Merging to `main` after green CI triggers the Dokploy webhook. The `migrate` service runs the migrations.

## 14. Observability

Observability is lean and self-hosted. Secrets are never logged.

- **Logs:** `pino` JSON to stdout, viewed in Dokploy's log viewer.
  - One shared logger factory sets the redaction paths (§9).
  - Logs carry IDs only, never page text or images.
  - n.eko and Chromium logs are left at warn level.
- **Health:**
  - `web` exposes `/healthz`.
  - `agent` exposes `/healthz` internally, reporting DB, Garage, the lease loop and slot states.
  - Each slot's health check is CDP `/json/version`.
- **Metrics:** stored as data and computed with SQL. There is no Prometheus, Grafana, Sentry or OTel in v1.
  - `runs.usage` holds steps, tokens and USD.
  - `run_steps` holds phase latency.
  - Takeover latency is the gap between the `takeControl` call and the `control` event.
  - Slot utilisation comes from `browser_slots`.
- **Audit:** `vault_audit`, `approvals` and `downloads`.

## 15. Risks & open items

| Risk | Mitigation |
|---|---|
| The model takes unauthorized actions | Code-enforced approvals, allowlist, control lock, kill switch |
| Model IDs or the `computer` API shape change | Verify IDs; Zod allowlist of actions; model chosen per run |
| WebRTC blocked by the user's network | TCP mux on 590NN; optional coturn |
| The n.eko embed UI limits our custom chrome | Overlays above the iframe; a custom client is a later upgrade behind `LiveView` |
| A box moves between capture and masking | Before/after box check, retake, drop the frame |
| Background tabs may not render in headed mode | The agent works in the foreground tab and brings it to front before capture |
| YouTube player changes or ToS grey area | `transcribe` fallback; in-browser only; no stored media |
| OpenAI cost and rate limits | Budgets, slot-clamped concurrency, `{unchanged:true}`, compaction |
| The hand-rolled loop's recovery code grows | Temporal escape hatch |
| The motion 12 → 14 pin | Check compatibility before install (F1) |

**Pending:** the 3D hero and the WebGL library choice (run 16).

## 16. Build phases (D30)

The approach is contracts first. After phase 0, the backend (B) and frontend (F) tracks run as parallel subagents. F phases use `packages/contracts`, seeded data, recorded `RunEvent`s and a static stub frame for the live iframe. Each phase ships behind green CI.

| # | Phase | Track | Depends on | Done when |
|---|---|---|---|---|
| 0 | **Foundations:** monorepo, contracts, db + roles, storage, Compose with networks, `browser-slot` image, CI, Better Auth | shared | — | Stack boots; a slot answers CDP on the `cdp` network only |
| B1 | **Runtime core:** slot pool and leases, restart-on-release, loop, run leases, checkpoints, sleep/wake, AbortController, guardrails, kill switch, `computer` + `read_page`, masked screenshots, `llm-mock`, fixtures | backend | 0 | Agent-behaviour tests pass, including crash/restore and slot reset |
| B2 | **Capture + notes:** §7 pipeline, `capture`, `annotate`, folders, auto-filing, embeddings, search | backend | B1 | ≥ 98% coverage on fixtures |
| B3 | **Vault:** sealing, all fields, split PIN, OTP via UI and IMAP, passkeys, audit, sessions | backend | B1 | §12 security tests pass |
| B4 | **Video:** captions, chapters, keyframes, remote-Pulse transcribe | backend | B2 | YouTube fixture produces a chaptered note |
| B5 | **PDF:** pdf.js path + docling profile | backend | B2 | PDF fixture is verified on both paths |
| B6 | **Live view:** `NekoLiveView`, ForwardAuth endpoint, server-side n.eko login, control lock, clipboard, uploads, downloads, mux ports, coturn profile | backend | B1 | §12 live-view and takeover tests pass |
| F1 | **Design system:** tokens, `motion` + LazyMotion + motion-tokens + lint rules, glass, icons, CSS skeletons, SwipeToast, app shell, auth | frontend | 0 | Token page clean at all breakpoints |
| F2 | **Library, folders, note reader/editor:** RubberSegment, SpringCheck, provenance, export | frontend | F1 | Works on seeded DB |
| F3 | **New task + Run view:** mock browser with overlays and an iframe stub, 7 states, takeover transition, Full screen, StatusMark, ThoughtLine, CountUp, CodeSlots (with security review), PiP | frontend | F1 | Works on a recorded event stream |
| F4 | **Vault UI, Settings/Usage/Audit** | frontend | F1 | Works on seeded DB |
| F5 | **3D hero** (+ WebGL library) | frontend | F3, run 16 | Meets the §11.2 constraints |
| 7 | **Integration:** wire F to B over oRPC, SSE and the live iframe; full E2E | both | B1–B6, F2–F4 | `compose.test.yml` is green |
| 8 | **QA:** D22 swarm + D28 animation pass; fix all findings | both | 7, F5 | Zero open issues |
| 9 | **Deploy:** domain, firewall ports, secrets, backups, smoke run | shared | 8 | Production smoke run completes a real note, including a takeover |

---

The spec above is the full replacement for the earlier draft and includes both of your mid-task inputs:

- **Run 15:** the live view is now final. n.eko over WebRTC replaces the CDP screencast in §1, §3, §10, §12, §13 and the build phases.
- **Run 18:** React Bits and `motion` are in §11.4, with the components assigned to build phases.

Only the 3D hero and its WebGL library remain pending (run 16).

Decisions for you to check at review:

1. **Live path is per slot, not per run.** The route is `/live/browser-N/`, not `/live/:runId`. Traefik can't look up which slot a run is using, so ForwardAuth checks that the user owns the run currently holding slot N.
2. **Slots restart without the Docker socket.** On release the agent closes Chromium over CDP, the slot container exits, and Compose `restart: always` starts it clean.
3. **n.eko credentials.** Each slot's two n.eko passwords are derived from one secret per role (HMAC with the slot name). `web` holds only the user-member secret and `agent` only the admin secret. `web` logs into n.eko server-side, so the user's browser only ever gets a session cookie.
4. **Audio for transcription.** `agent` records the slot's audio over PulseAudio TCP on the internal `cdp` network, so `ffmpeg` stays in `agent`.
5. **Slots and concurrency.** 8 slots in production (`browser-3..8` under profile `full`), 2 in tests. Concurrency is clamped to the slot count, default 6.
6. **3D hero size cap removed.** I dropped the 150 KB cap I had set earlier, because three plus @react-three/fiber would exceed it. The hero's size budget is now left to run 16.
7. **No View Transitions API.** `motion` is the only animation library, so I removed it from the takeover and route transitions.
8. **Open questions closed as defaults.** Obsidian Markdown export and a v1 scope of web, PDF and YouTube are written in as defaults to confirm at review.

The spec runs about 6,000 words, over the 2,500–4,000 target, because both new inputs added detail.
