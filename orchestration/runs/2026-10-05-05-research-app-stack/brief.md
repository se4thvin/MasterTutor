---
run_id: 2026-10-05-05-research-app-stack
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
---

# Brief: Webapp stack and UI

Research task (web research, no code changes). Today is 2026-10-05. We are building a deployable web app for an agentic note-taking system: users give the agent a task ("take notes on this course / page / YouTube video"); a backend agent (OpenAI computer-use model) drives a headless Chromium browser in Docker; the UI shows a live view of the agent's browser, a step-by-step activity log (screenshots, actions, reasoning), and a library of generated notes/"artifacts" (rich Markdown with images, diagrams, tables, math, source citations) that users can browse, search, and edit. Users can take over the browser (e.g. for CAPTCHAs). Needs its own database, object storage for images, a job queue for long-running agent runs, Docker Compose for full end-to-end testing, and deployability (the user has Dokploy available). Must have a delightful, clean UI.

Find the best 2026 choices, with sources and current versions:
1. Frontend: Next.js (App Router) vs Vite+React vs SvelteKit; UI kit (shadcn/ui, Radix, Tailwind v4); rich note editor/renderer supporting Markdown, images, tables, KaTeX, code (Tiptap, BlockNote, Milkdown, Plate, Novel).
2. Live browser view in web UI: CDP Page.startScreencast over WebSocket vs noVNC/Xvfb vs WebRTC; takeover input forwarding.
3. Backend: TypeScript (Node/Bun, Hono/Fastify) vs Python (FastAPI) — consider that Playwright, OpenAI Agents SDK, and extraction libs (Docling/Trafilatura/yt-dlp/faster-whisper) may be Python-heavy. Monorepo layout suggestions.
4. DB/ORM: Postgres + Drizzle/Prisma (TS) or SQLAlchemy (Py); full-text + vector search (pgvector, Postgres FTS). Object storage: MinIO / S3-compatible (note MinIO licensing changes; alternatives like Garage, SeaweedFS). Queue: BullMQ+Redis, pg-boss, Celery, Temporal/Inngest/Hatchet for long agent runs. Realtime: SSE vs WebSocket.
5. Auth for the app itself (Better Auth, Auth.js, Lucia successor).
6. E2E testing in Docker: Playwright test against compose stack, mocking the OpenAI API for deterministic runs, fixture websites served locally.
7. Deploying a compose stack to Dokploy.

Return a concise report (<800 words) recommending one coherent stack with justification, and source URLs. Flag anything unverified.
