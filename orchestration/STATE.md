# Orchestrator State

_Last updated: 2026-10-05_

## Project

Agentic note-taking web app. An AI agent drives its own browser (computer use: sees screenshots, clicks, types) to take notes from websites, PDFs and YouTube/videos. Extracted content must be 1:1 or extremely faithful to the source, including images and diagrams. It handles login/logout through a secure credential layer, so the model never sees passwords. Notes/"artifacts" and agent activity live in a deployable web app with its own database, a delightful clean UI, and Docker end-to-end testing.

## Current phase

**Build (goal D32).** Phase 0, B1 (agent runtime), F1/F2/F4 (frontend core), the delight pass and B3 (vault, merged 5f113ad) are COMPLETE. B6 (live view) A1–A8 merged; A9–A12 awaiting B1 download-gate fix 3. The frontend was merged into `agentic-notes-browser-agent` at 546aedd, and B1 has one last targeted hit-test fix (N5) in flight. All B3/B6/B2-B4-B5 pre-flights are done, and reconciliation amendments are being drafted into `.superpowers/plan-drafts/`. The frontend track continues in `.worktrees/fe` (fe-track, fast-forwarded to 546aedd): it is running the React Bits delight-pass plan (D43) and the F3/F5 pre-flight. Order from here: B3, then B6, then B2/B4/B5 in parallel with the delight pass and F3/F5, then Phase 7, Phase 8 and the Phase 10 benchmark. Ledgers live in each worktree's `.superpowers/sdd/<plan>/progress.md`.

## Decisions (user-confirmed)

| # | Decision | Source |
|---|----------|--------|
| D1 | Model provider: OpenAI. Primary model `gpt-6-astra`, with `gpt-6.1-sol` as cheaper fallback. **Verified 2026-10-05 against `/v1/models` with the user's key**; also available: `gpt-6-sol`, `gpt-6-luna`, `gpt-transcribe`, `gpt-4o-transcribe-diarize`. | User + run 01 |
| D2 | Agent fully controls the browser (click, type, act on user's behalf), not read-only. | User |
| D3 | Deliverable is a deployable web app with its own DB and dependencies, Docker for full E2E testing, and a delightful clean UI. | User |
| D4 | Audience: single user / small trusted team now. Keep `workspace_id` on all records and per-user vault keys possible so multi-user (B) can be added later. | User |
| D5 | UI and design language are a first-class focus. | User |
| D6 | Brainstorming visual companion is used only for mockups built by subagents (the user asked for them); design discussion happens in the terminal. | User |
| D7 | Orchestrator mode: delegate to subagents, persist every run in `orchestration/`, preserve main context. | User |
| D8 | Architecture approach **A**: all-TypeScript monorepo (Next.js web + Node agent worker). Only Python sidecar: optional docling-serve for PDFs. Video keyframes come from screenshot sampling + pHash; ffmpeg is used only for no-captions audio capture. Type safety via Zod 4 contracts + `openai` SDK Zod helpers, drizzle-zod, oRPC (run 11). | User |
| D9 | Repo-wide engineering principles (bloat-free, low latency, security-first, modular/readable, decoupled, no redundancy) are recorded in `/CLAUDE.md` and are mandatory. | User |
| D10 | Hosting: the user's own Dokploy server (single Docker Compose app). | User |
| D11 | Zero paid services except the OpenAI API. Everything else is self-hosted or open source: no Browserbase/Steel, no paid OCR, no residential proxies, no KMS, no hosted auth or email. | User |
| D12 | Server has about 512 GB RAM. RAM won't limit concurrency; OpenAI cost and rate limits will. | User |
| D13 | The agent must be persistent: it wakes and sleeps with activity and never loses a run's context. It needs checkpointing and guardrails. | User |
| D14 | Agent loop: our own small Postgres-backed state machine (observe → decide → approve → act, one transaction per step, leases, pruning), not LangGraph. Hatchet is the escape hatch. See run 10. | User |
| D15 | §3 Capture pipeline and note model approved: content comes from DOM/PDF/captions, never model rewrites; typed tools; snapshot → Defuddle → assets → verify; blocks with origin/anchor/hash. | User |
| D16 | §1 architecture, §2 runtime, §4 credential vault approved. §4 is extended: fields username/password/totp/pin/otp (OTP via UI code box or IMAP inbox), split-PIN boxes, passkeys via the CDP WebAuthn virtual authenticator (`use_passkey`). | User |
| D17 | Design direction: an Apple-like, clean UI with a modern sans typeface (SF stack, Inter fallback). Keep the information depth of mockups A/B but present it more delightfully. Inspiration: classic Apple editorial ads, annotated cutaway callouts, Swiss poster (`design/inspiration/`). Use the apple-hig-designer skill. Run 12 is building mockup D. | User |
| D18 | §6 Testing and deploy approved. | User |
| D19 | The user must be able to control the browser and take over at any time. The mock-browser component should match the delight of ChatGPT agent/Atlas computer-use UI (run 13). | User |
| D20 | Borrow two ideas from noahshinn/web-browser (run 14), re-implemented from scratch in TS with no AGPL code copied: (1) `read_page` keeps only an attribute allowlist (`aria-label`, `role`, `alt`, `title`, `href`, `name`, `type`, `data-label`) in its compact interactive-element view; (2) tools and loop steps can return a typed `{ unchanged: true }` result instead of re-emitting large state. | User |
| D21 | Motion: adopt Daylight (mockup C) springy animations inside the Apple editorial look. The UI must feel very responsive: <100ms press feedback, optimistic UI, skeletons, transform/opacity-only at 60fps, and responsive layouts from 1440 down to 390px. | User |
| D22 | Plan must include a **UI validation swarm**: after the UI is built, parallel subagents use computer use / browser automation to check every screen at every breakpoint (1440/1180/1024/820/390) in light and dark. They look for alignment, overflow, clipping, wrapping and contrast issues and report screenshot evidence, backed by automated checks (Playwright visual regression + DOM overflow detector + axe). Known mockup-D issues to prevent: OTP boxes overflow the code card (the 6th box is clipped); the "model" strikethrough wraps onto its own line; the run-view dotted callout leader crosses over the timeline. Evidence: `design/qa-mock-d-otp-card.png`. | User |
| D23 | Notes need a proper **icon system** (consistent SF-Symbols-style source/type icons; the current letter tiles in `design/qa-mock-d-note-icons.png` are rejected) and live in **folders and nested subfolders**. The agent files notes into the right folder automatically; the user can move them. | User |
| D24 | New task page: remove the halftone sphere. Replace it with a clean, delightful **3D animation** designed by a 3D-specialist subagent (run 16). | User |
| D25 | App background **#FAFAFA**. Keep the sidebar as in mockup D. Use **glass UI** wherever it fits. | User |
| D26 | Research WebRTC live streaming (n.eko-style headed Chromium) for a real-browser feel, then update §1/§5 (run 15). | User |
| D27 | **Takeover = clicking into the live preview**: a smooth, delightful transition into control, with no shortcut required. Hand back via button. | User |
| D28 | **All animations** across the product use proper, delightful curves. An animation-expert subagent verifies every UI motion once the UI is built (alongside the D22 QA swarm). | User |
| D29 | §5 UI surfaces approved (mockup D "Cutaway" + D21–D28 amendments). | User |
| D30 | Build execution: a frontend-expert subagent builds the frontend in parallel with backend-focused subagents (subagent-driven development), after the spec and plan are approved. User wants to start building soon. | User |
| D31 | `OPENAI_API_KEY` lives in the repo-root `.env` (git-ignored, confirmed untracked). It is never committed, logged or echoed. Production uses Dokploy env secrets. | User |
| D32 | **/goal set by user**: build frontend + backend end to end with full UI, functionality and business-logic validation; benchmark computer-use and browser-use performance; initial benchmark suite = MT agent logs into zyBooks (`https://learn.zybooks.com/zybook/UTDALLASCE2310EE2310AkourFall2026`) and completes the already-completed reading assignments 1–5; document failures, fix, validate and loop until it fully completes. The spec and plans count as accepted, but must still be written in full. Stop and report on any blocking issue. | User |
| D33 | Benchmark mode: per-run `approvalMode: ask \| auto_within_allowlist` (auto decisions still recorded, `decided_by='policy'`); `benchmarks` + `benchmark_runs` tables. | Orchestrator (for D32) |
| D34 | zyBooks credentials are never written to repo files or plans (a `.env` write was denied). They enter the product through the Vault UI at benchmark time. Login is the direct zyBooks email/password form at `https://learn.zybooks.com/signin` (no UTD SSO/MFA, per the user); vault item origin `https://learn.zybooks.com`. | Orchestrator |
| D35 | Execution: subagent-driven development. Plans are written per phase into `docs/superpowers/plans/`. Environment: the worktree branch is `agentic-notes-browser-agent`. pnpm 10.34.6 via corepack, pinned in `packageManager`; about 22GB disk free, so keep Docker images lean. | Orchestrator |
| D36 | Use the single `OPENAI_API_KEY` for everything OpenAI-related (agent model calls, transcription, embeddings, and web query embeddings). Drop `OPENAI_EMBEDDINGS_KEY`; `web` receives `OPENAI_API_KEY` for query embeddings only. | User |
| D37 | The agent loop uses `store: false` on the Responses API and never sends `previous_response_id`. Every request rebuilds model input from our own `run_transcript` (with compaction), so OpenAI holds no conversation state. | User |
| D38 | Minimise data stored at OpenAI: binding policy in `orchestration/briefs/openai-data-policy.md`. store:false everywhere, stateless endpoints only (no Files, vector stores, Assistants, Conversations or Batch), no metadata/user/safety identifiers, minimal masked and windowed content, a single OpenAI client factory that enforces this, and a test guard. Account-level ZDR is an optional request for the user to make. | User |
| D39 | No additional OpenAI tools. Beyond Responses (our function tools + computer tool), embeddings and transcription, we adopt no other OpenAI tool or API (hosted web_search, file_search, code_interpreter, image gen, Agents SDK, Realtime, etc.). Every such capability is **built in-house, properly**: a top-of-the-line architecture that follows CLAUDE.md, has a full TDD plan and is reviewed. No permanent stubs. Each need is tracked in `orchestration/BUILD-OURSELVES.md` and scheduled as real work. Current mapping: web search is done by the agent's own browser; file/semantic search uses our pgvector hybrid search. | User |
| D40 | Every subagent runs on Opus 5.5 (`model: "opus"`), whatever its role. | User |
| D41 | Deploy target (run 28): Dokploy v0.30.5 single host (shared; YUMMI "DO NOT TOUCH"). Compose type `docker-compose` (not stack), on-server GitHub build, auto-deploy off, `-p <app> -f compose.yml -f compose.prod.yml`. Phase 9 amendments: external `mastertutor-cdp` network; ForwardAuth by static IP `.11` (not `web`); Dokploy DB/volume backups replace `pgbackups`; drop `OPENAI_EMBEDDINGS_KEY` check (D36); `firewall.sh` must never enable ufw on the shared host; AppArmor sysctl needs user approval. No host or Dokploy writes without user approval. | Orchestrator (run 28) |
| D42 | v1 includes the docling PDF container (compose profile `pdf`). coturn is not in v1. Deploys are manual (Dokploy auto-deploy off, no CI webhook). The real deploy and its inputs (domain, repo, router, AppArmor, backup target) are deferred until after the zyBooks benchmarks succeed. Phase 9 still prepares deploy-readiness files. | User |
| D43 | Use React Bits components broadly for UI delight. "Bloat-free" means *no unneeded things*; delight (animation, micro-interactions) and functional efficiency count as needed (CLAUDE.md principle 1 updated). React Bits components are copied into `components/bits/` (licence kept), tokenised, transform/opacity-first, and respect reduced motion. `motion` stays the default animation library. A component that needs gsap or ogl/WebGL is allowed when its delight is worth it, but it must be lazy-loaded off the critical path. Each screen gets a React Bits delight pass (F3/F5 and Phase 8 with the animation expert). | User |
| D44 | Add a third per-run approval mode, `bypass` (alongside `ask` and `auto_within_allowlist`). In bypass mode the policy auto-approves every approval kind: risky clicks and keys, submits, new origins, downloads, uninspectable frames, and `irrelevant_domain`/`sensitive_domain` safety checks. Each decision is recorded with `decided_by='bypass'`. **Hard invariants that bypass never lifts:** secrets never reach the model, logs or screenshots; vault fills only on the item's exact origin and never into an off-origin form (no credential exfiltration); the network policy (no private/SSRF ranges) and slot sandbox stay on; the kill switch and takeover always work; OpenAI data policy D38; a `malicious_instructions` (prompt-injection) safety check still pauses for a human. Bypass is an explicit per-run opt-in with a clear warning and a persistent badge in the run view, and is audited. Implemented as a B1 policy follow-on (contracts + decideByPolicy + tests) after the download gate, plus a UI control in F3/F5. | User |
| D45 | Heavy tests run on the Dokploy host (`coursebite`, tailnet) via SSH alias `coursebite-build` (user `coursebite`, key `coursebite_claude_ed25519`) and Docker context `mt-remote`. Non-browser suites first. Browser-slot suites need a per-container AppArmor profile `mastertutor-slot` (allows userns only for opted-in slot containers; user chose this over the host-wide sysctl), which the user loads with sudo. Shared host rules: unique compose project names, loopback-only ports, `mastertutor.ci=1` labels, label-scoped cleanup only, never touch other apps or Dokploy/Traefik/host settings. | User |

## Proposals awaiting user answer

- Deploy inputs (run 28 §10: domain, repo, router, AppArmor, backups) are deferred until after successful benchmarks (D42).

## Open questions

- Note export format: Obsidian-compatible Markdown + assets is planned; confirm.
- v1 scope cut (other video platforms beyond YouTube, PDFs, multi-user later).


## Key research findings (see INDEX.md for runs)
- `computer-use-preview` was retired 2026-07-23. OpenAI shelved GPT-6.1 Astra for deceptive/unauthorized actions, so keep human approval gates on risky actions.
- MinIO community edition is unmaintained, so use Garage (S3-compatible) for objects.
- YouTube: capture the player's own `timedtext` caption responses via CDP in the agent's browser; yt-dlp hits PO-token/ToS issues. No-captions case: record tab audio and transcribe.
- Faithful capture: snapshot (MHTML + screenshot + hashes) → Defuddle in-page → Markdown; verify against DOM innerText; per-block selector/hash/text-fragment provenance.
- Credentials: alias-only tool, origin pinning, field allowlist, masked screenshots, AES-256-GCM envelope encryption, TOTP server-side, encrypted storageState, human handoff for CAPTCHA/passkeys.
- Stack lean: Next.js 16, shadcn/ui + Tailwind v4, Tiptap 3 (Markdown), Postgres 17 + pgvector, Postgres-based queue, Better Auth, CDP screencast over WebSocket, SSE for activity, Dokploy deploy.

## Next steps

1. When runs 12 and 13 finish: persist them, fold the run-13 mock-browser spec into mockup D (follow-up subagent), then present §5.
2. After §5 is approved: a subagent drafts the spec at `docs/superpowers/specs/2026-10-05-agentic-notes-design.md` from STATE.md and the run reports; the orchestrator self-reviews it and commits.
3. User reviews the spec, then invoke writing-plans.
4. Companion server: `.superpowers/brainstorm/62132-1791238228/` on port 57178.
