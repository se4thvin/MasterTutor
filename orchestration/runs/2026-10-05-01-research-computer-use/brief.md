---
run_id: 2026-10-05-01-research-computer-use
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
---

# Brief: OpenAI computer use / GPT Astra

Research task (web research, no code changes). Today is 2026-10-05. We are building an agentic note-taking web app whose agent drives its own browser via computer use (screenshots + mouse/keyboard actions) to read websites, click buttons, fill forms, and watch YouTube. The user wants to use an OpenAI API key with a model they call "GPT Astra" and its advanced computer-use capabilities.

Find out, with sources (official OpenAI docs/blog preferred):
1. Does a model called "GPT Astra" (or similar name) exist from OpenAI? What's its exact API model ID, and what is the current recommended OpenAI model + API for computer use as of late 2026 (e.g. Responses API `computer_use_preview` tool, newer agent/operator APIs, Agents SDK)? If "Astra" is not OpenAI's, say so clearly and say what it actually is.
2. Exact API shape: tool definition, action types (click, type, scroll, keypress, drag, wait, screenshot), safety checks / acknowledgement flow, display size limits, pricing, rate limits, whether it supports reasoning and parallel tool calls.
3. Best 2026 harness for executing those actions: Playwright (Chromium) vs Browserbase/Steel/Kernel/Hyperbrowser cloud browsers vs browser-use / Stagehand / OpenAI Agents SDK built-in computer tool. Which works headless in Docker, supports persistent sessions/cookies, and live view streaming of the browser to a web UI (CDP screencast, noVNC, etc.)?
4. Hybrid approach: combining screenshot-based CUA with DOM/accessibility-tree access for reliability and speed. What do leading 2026 agents do?
5. Recommended language/SDK (TypeScript vs Python) for the agent loop.

Return a concise report (<700 words) with a clear recommendation, exact model IDs, and source URLs. Flag anything you could not verify.
