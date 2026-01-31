# Build-ourselves backlog (D39): OpenAI tools

We use only these OpenAI capabilities:
- the Responses API, with our own function tools and the computer tool;
- embeddings;
- audio transcription.

If work needs any other OpenAI tool or API, do not adopt it. That includes hosted web_search, file_search, code_interpreter, image generation, the Agents SDK, Realtime, and similar. Build the capability ourselves, or stub it behind an interface for now, then log it here. The orchestrator triages.

| # | Need (OpenAI tool it would replace) | Why / where it came up | Interim (stub / minimal / blocked) | Raised by | Status |
|---|-------------------------------------|------------------------|-------------------------------------|-----------|--------|
