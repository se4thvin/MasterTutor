---
run_id: 2026-10-05-05-research-app-stack
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I recommend one stack: **Next.js 16 for the web app, a Python worker for the agent, Postgres for data and job queueing, Garage for image storage, and a single Docker Compose file deployed to Dokploy.** The biggest risk is splitting the codebase into two languages. The biggest finding is that MinIO's free edition is no longer maintained, so it should not be used.

## Recommended stack

**1. Frontend: Next.js 16 (App Router), shadcn/ui on Tailwind v4, Tiptap 3 as the editor.**
- **Next.js:** the current stable release is 16.3.8 and Next 16 is a long-term-support line. Vite+React or SvelteKit would also work. Next.js wins because Better Auth, shadcn and Tiptap all fit it most directly, and it gives you server actions for the notes library.
- **shadcn/ui:** it now defaults to Base UI as its component layer, with Radix still fully supported. New projects start on Tailwind v4.
- **Editor:** Tiptap 3 with the official `@tiptap/markdown` extension (v3.31.x), which reads and writes Markdown in both directions. Add Tiptap's Mathematics extension for KaTeX, plus its table, code-block (lowlight) and image extensions.
  - Store notes as Markdown so the agent can write them and they can be searched.
  - Render read-only notes with `react-markdown`, `remark-gfm`, `rehype-katex` and Mermaid.
  - BlockNote looks more Notion-like out of the box, but it saves Markdown with losses. Milkdown is Markdown-native but harder to build a polished UI on.

**2. Live browser view: CDP `Page.startScreencast` over a WebSocket.**
- The worker sends JPEG frames to the browser and acknowledges each one. The user's mouse and keys go back as CDP `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` and `Input.insertText`, with coordinates scaled to the frame.
- It uses no extra bandwidth on an idle page, and needs no Xvfb (virtual display) or VNC inside the headless Chromium container.
- For takeover, use a "control lock": while the user holds it, the agent loop pauses and its browser calls are blocked. Several open-source agent projects use exactly this pattern.
- noVNC or WebRTC only make sense if you later need audio or video playback for YouTube. For transcripts, use yt-dlp to pull subtitles instead.

**3. Backend: two languages in one monorepo.**
- **`apps/web` (Next.js, TypeScript):** the UI, Better Auth, the notes API, and the Server-Sent Events stream for the activity log.
- **`apps/agent` (Python 3.12+):** Playwright, the OpenAI Agents SDK (its `ComputerTool`/`AsyncComputer` with a Playwright example), the extraction libraries (Docling, Trafilatura, yt-dlp, faster-whisper), and the screencast WebSocket.
- **`packages/contracts`:** the job and event types, defined once in JSON Schema and generated for both TypeScript (zod) and Python (pydantic).
- **Why not all-TypeScript:** OpenAI's Agents SDK and Playwright do exist for TypeScript, but Docling, faster-whisper and Trafilatura are Python-only.
- Use FastAPI only for the worker's small control endpoints: start, cancel, and taking or releasing control.

**4. Data, storage, queue and realtime**
- **Database:** Postgres 17 with pgvector. Use Drizzle ORM on the TypeScript side, which supports pgvector and full-text search with generated `tsvector` columns. For search, combine full-text and vector results with reciprocal-rank fusion. On the Python side use SQLAlchemy 2 or plain `psycopg` against the same schema, with Drizzle owning migrations.
- **Object storage: Garage v2.x** (`dxflrs/garage`), with SeaweedFS as the fallback. Avoid MinIO:
  - Its community edition went into maintenance mode in December 2025, Docker images stopped in October 2025, and the repository is now archived.
  - It is still AGPL-licensed, but there are no new releases or patches.
  - Hide the store behind a generic S3 client so it can be swapped later.
- **Queue:** start with a Postgres-based queue and no Redis. The web app enqueues jobs with pg-boss, and the Python worker claims them with `SELECT … FOR UPDATE SKIP LOCKED` on the same table, or uses a small shared `jobs` table.
  - Save each step to a `run_steps` table so you get the activity log, can resume after a crash, and can audit runs.
  - If you outgrow that, Hatchet is also built on Postgres and has both TypeScript and Python SDKs. Temporal is more than you need here.
- **Realtime:** use Server-Sent Events for the activity log and run status, fed by Postgres `LISTEN/NOTIFY`. Use WebSocket only for the screencast and input, because that needs two-way traffic.

**5. Login for the app: Better Auth (v1.6.x).**
- The Auth.js team joined Better Auth in September 2025. Auth.js now gets security patches only.
- Lucia was deprecated in March 2025.

**6. End-to-end testing in Docker**
- Add a `compose.test.yml` overlay with three extra services:
  - `fixtures`: nginx serving static course pages, a fake YouTube page and a CAPTCHA mock.
  - `llm-mock`: a fake OpenAI server, for example `aimock` or `llmock`, both of which replay the Responses API deterministically.
  - `e2e`: the Playwright image, running tests against the `web` container.
- Point `OPENAI_BASE_URL` at the mock. Record real runs once against the fixtures and replay them in CI.
- Add contract tests for the worker with pytest and recorded responses.
- Give the agent a fake-clock or no-wait mode so runs are fast.

**7. Deploying with Dokploy**
- Deploy as a Docker Compose app. Add domains in the Dokploy UI and Dokploy adds the Traefik labels at deploy time; "Preview Compose" shows the final file.
- Domain changes only apply after a redeploy.
- Use named volumes for Postgres and Garage, and Dokploy's backup feature for Postgres.
- Route the screencast WebSocket through the `web` domain on a path, or give it its own subdomain.
- Give the Chromium worker `shm_size: 2gb` and a concurrency limit.

## Not verified
- **OpenAI model IDs.** OpenAI's computer-use guide reportedly lists `gpt-6-astra` (which it recommends with a "code execution" mode, `exec_py`/`exec_js`) and `gpt-6.1-sol` with the structured `"computer"` tool. These came through a summarizing fetch tool, so check the exact IDs before coding against them.
- **Agents SDK example.** The `ComputerTool` example I found still uses `computer-use-preview`, so the SDK may lag behind the newer models.
- **Smaller details:** the Tiptap Math extension's Markdown round-trip, Drizzle 1.0's stable status, and Garage's exact latest patch version.
- **Third-party sources.** The MinIO timeline comes from third-party blogs (dates differ slightly), so read GitHub issue #21714 directly. The live-view pattern comes from community GitHub issues, not official docs.

## Sources
- https://nextjs.org/blog/next-16-3
- https://endoflife.date/nextjs
- https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- https://tiptap.dev/docs/editor/markdown/getting-started/installation
- https://www.npmjs.com/package/@tiptap/markdown
- https://github.com/activeagents/activeagent/issues/542
- https://betterwright.com/docs/live-view
- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://github.com/openai/openai-agents-python/blob/main/examples/tools/computer_use.py
- https://openai.github.io/openai-agents-python/tools/
- https://github.com/openai/openai-cua-sample-app
- https://orm.drizzle.team/docs/guides/vector-similarity-search
- https://orm.drizzle.team/docs/guides/full-text-search-with-generated-columns
- https://github.com/minio/minio/issues/21714
- https://www.glukhov.org/data-infrastructure/object-storage/minio-dead/
- https://akmatori.com/blog/minio-alternatives-2026-comparison
- https://hub.docker.com/r/dxflrs/garage
- https://www.vibereference.com/backend-and-data/background-jobs-providers
- https://imqueue.org/blog/bullmq-alternatives/
- https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth
- https://dev.to/pipipi-dev/nextauthjs-to-better-auth-why-i-switched-auth-libraries-31h3
- https://aimock.copilotkit.dev/
- https://github.com/larsakerlund/llmock
- https://docs.dokploy.com/docs/core/docker-compose/domains
