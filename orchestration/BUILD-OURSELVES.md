# Build-ourselves backlog (D39): OpenAI tools

We use only these OpenAI capabilities:
- the Responses API, with our own function tools and the computer tool;
- embeddings;
- audio transcription.

If work needs any other OpenAI tool or API, do not adopt it. That includes hosted web_search, file_search, code_interpreter, image generation, the Agents SDK, Realtime, and similar. Build the capability ourselves, properly: a top-of-the-line architecture that follows CLAUDE.md, with a full TDD plan and a review. A stub is allowed only as a short bridge inside the same phase. Log the need here. The orchestrator schedules each row as real work before the goal (D32) counts as met.

| # | Need (OpenAI tool it would replace) | Why / where it came up | Plan / phase | Raised by | Status |
|---|-------------------------------------|------------------------|-------------------------------------|-----------|--------|
