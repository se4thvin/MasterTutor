# Orchestrator State

_Last updated: 2026-10-05_

## Project

Agentic note-taking web app. An AI agent drives its own browser (computer use: sees screenshots, clicks, types) to take notes from websites, PDFs and YouTube/videos. Extracted content must be 1:1 or extremely faithful to the source, including images and diagrams. It handles login/logout through a secure credential layer, so the model never sees passwords. Notes/"artifacts" and agent activity live in a deployable web app with its own database, a delightful clean UI, and Docker end-to-end testing.

## Current phase

**Planning → build (goal D32).** The spec is final and committed (7186eef), with no pending items. The Phase 0 plan is being written (run 19); the other phase plans follow and will reference Phase 0's exact contract names. The 3D hero is finalized (run 16).

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

## Proposals awaiting user answer

- None. The spec and plans are accepted per D32.

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
