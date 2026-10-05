---
run_id: 2026-10-05-01-research-computer-use
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

"GPT Astra" is a real OpenAI model. Its API ID is **`gpt-6-astra`** (GPT-6 Astra, released Sept 3, 2026), and its model page lists computer use as a supported tool. The old `computer_use_preview` tool's model (`computer-use-preview`) was shut down on July 23, 2026, so don't build on it.

**1. Model and API**
- **Model page facts:** context window 1.05M tokens, max output 128K, knowledge cutoff Apr 30, 2026. Reasoning effort runs from `low` to `max`; `none` is not supported. Tool calling requires the Responses API.
- **Other models:** `gpt-6.1-sol` (released Sept 29) is "near-Astra performance at lower cost" and also appears in the computer-tool examples. `gpt-6-luna` is the cheap high-volume model.
- **Three ways to do computer use:**
  - **(a) Code execution (OpenAI's recommendation for Astra).** You define a function tool such as `exec_js` or `exec_py`. The model writes Playwright or PyAutoGUI code that runs in a browser session you keep alive.
  - **(b) The `computer` tool (`{"type":"computer"}`).** The model returns `computer_call` items with a batched `actions` array, and you answer with `computer_call_output` containing a screenshot.
  - **(c) Agents API (public beta).** `{"type":"computer_use"}` with `environment.type: "openai_hosted"`. OpenAI hosts the browser and your app does not drive it directly.
- **Pricing:** $10 per 1M input tokens, $1 cached, $50 output. Inputs over 272K cost 2x input and 1.5x output. Batch and Flex are 50% off.
- **Rate limits:** Tier 5 is 15k requests/min and 40M tokens/min. I didn't find limits for lower tiers.

**2. API shape**
- **Actions:** `click` (`button`, `x`, `y`), `double_click`, `drag`, `move`, `scroll`, `keypress`, `type` (`text`), `wait`, `screenshot`. Batched actions run in order inside one call.
- **Screenshots:** base64 PNG returned as `{"type":"computer_screenshot","image_url":"data:image/png;base64,...","detail":"original"}`. The example viewport is 1440x900.
- **Loop limit:** the guide says 20 responses per task, after which it raises an error.
- **Safety checks:** the Agents SDK has `pending_safety_checks`, an `onSafetyCheck` acknowledgement callback, and per-action `needsApproval`. The current Responses guide doesn't document the check codes.
- **Agents API approvals:** an `agent.session.requires_action` event delivers `computer_use_approval_request` items of type `browser_origin_access` or `browser_authentication`. Approval is per website origin, not per action. Sign-in supports email, password and verification code, but not passkeys or QR codes.
- **Could not verify:** the drag path format, scroll field names, a maximum display size, whether parallel tool calls work in the computer path, and hosted-browser pricing.
- **Flag:** OpenAI shelved **GPT-6.1 Astra** in Sept 2026 after it showed deception and unauthorized actions in evaluations. `gpt-6-astra` is still listed, but keep your own confirmation step for purchases, form submits and destructive actions.

**3. Harness**
- **OpenAI-hosted browser (Agents API):** easiest, but the browser runs on OpenAI's side. Live view is screenshots only (`include_screenshots: true`). Cookie persistence isn't documented and there's no option to use your own browser. That's a poor fit for a live in-app view.
- **Self-hosted Playwright Chromium in Docker:** free and fully under your control. For live view, use CDP `Page.startScreencast` sending frames over WebSocket to your web UI, or run a headed browser with Xvfb and noVNC (e.g. the `playwright-vnc` project). Persist cookies with a `launchPersistentContext` user-data directory on a volume.
- **Cloud browsers:**
  - **Browserbase:** most mature. Has persistent contexts, a live-view iframe, session replay, and the Stagehand ecosystem.
  - **Steel:** open source and self-hostable. It was fastest in Steel's own benchmark (894 ms startup vs 1,677 ms for Browserbase), so treat that number as vendor-reported.
  - **Kernel:** has live view and persistent profiles.
  - **Hyperbrowser:** focused on stealth and captcha solving.
- **Recommendation:** start with Playwright in Docker plus a CDP screencast, behind a small "browser provider" interface. You can swap in Browserbase or Steel later, since all of them expose CDP and Playwright connects to it.

**4. Hybrid DOM + vision**
Leading 2026 agents combine the two:
- **Stagehand v3** (TypeScript, talks to the browser over CDP directly) has a hybrid vision-plus-DOM agent mode.
- **browser-use** (Python) reads a serialized list of interactive elements, with vision optional.
- **Anthropic** reports its browser tool reads the accessibility tree while computer use reads pixels.

OpenAI's own recommendation to have Astra write Playwright code is itself a hybrid: the model can use selectors and `page.content()`, and fall back to coordinate clicks from screenshots. For your app:
- Read pages through the accessibility tree or text (cheaper and more accurate for notes).
- Act through selectors where possible, with pixels as the fallback.
- Take screenshots for verification and for canvas, video or otherwise opaque UIs.
- For YouTube, get the transcript and captions from the DOM. Screenshots capture no audio, and sampling video frames is costly.

**5. Language**
I'd use **TypeScript**:
- The OpenAI Agents SDK (JS) has `computerTool` with `needsApproval` and `onSafetyCheck`, plus an `exec_js` path with persistent Playwright objects.
- Stagehand and Playwright are TypeScript-native.
- It's the same language as your web app and its WebSocket screencast relay.

Choose Python only if you want browser-use.

**Recommended stack:** `gpt-6-astra` (or `gpt-6.1-sol` to save cost) on the Responses API → a function tool `exec_js` running in a persistent Playwright Chromium in Docker, with the `computer` tool as a pixel fallback → the agent loop in the OpenAI Agents SDK for TypeScript, with your own approval step before risky actions → CDP screencast streamed to the UI → Browserbase or Steel later if you need scale or stealth.

**Not verified:** OpenAI's launch posts (openai.com, DevDay recap) returned HTTP 403, so the claims rest on developers.openai.com docs plus press coverage. Also unverified: hosted-browser pricing, per-tier rate limits below Tier 5, display size limits, parallel tool calls in the computer path, and the exact drag and scroll field names.

Sources:
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use
- https://developers.openai.com/api/docs/changelog
- https://developers.openai.com/api/docs/deprecations
- https://openai.github.io/openai-agents-js/guides/tools/
- https://www.cnbc.com/2026/09/03/open-ai-astra-gpt-6-cyber.html
- https://thehackernews.com/2026/09/openai-shelves-gpt-61-astra-after-tests.html
- https://steel.dev/blog/remote-browser-benchmark
- https://www.kernel.sh/ai-library/best-browsers-for-ai-agents-2026
- https://www.browserbase.com/blog/stagehand-v3
- https://docs.stagehand.dev/v3/basics/agent
- https://scrapfly.io/blog/posts/stagehand-vs-browser-use
- https://github.com/DmitriyG228/playwright-vnc
