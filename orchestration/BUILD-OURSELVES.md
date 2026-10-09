# Build-ourselves backlog (D39): OpenAI tools

We use only these OpenAI capabilities:
- the Responses API, with our own function tools and the computer tool;
- embeddings;
- audio transcription.

If work needs any other OpenAI tool or API, do not adopt it. That includes hosted web_search, file_search, code_interpreter, image generation, the Agents SDK, Realtime, and similar. Build the capability ourselves, properly: a top-of-the-line architecture that follows CLAUDE.md, with a full TDD plan and a review. A stub is allowed only as a short bridge inside the same phase. Log the need here. The orchestrator schedules each row as real work before the goal (D32) counts as met.

| # | Need (OpenAI tool it would replace) | Why / where it came up | Plan / phase | Raised by | Status |
|---|-------------------------------------|------------------------|-------------------------------------|-----------|--------|
| 1 | Copilot code search (hosted file_search) | Literal search over a scrubbed build-time code snapshot (`apps/observer/src/code-index.ts`), D39 | Observer C5 | Copilot track | Implemented in C5 |
| 2 | Copilot charts (code_interpreter) | In-house SVG from stored rows (`apps/web/components/observer/result-chart.tsx`), D39 | Observer U3 | Copilot track | Backend chart validation in C5; rendering pending Track U |
