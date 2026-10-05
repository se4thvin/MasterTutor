---
run_id: 2026-10-05-13-research-chatgpt-browser-ui
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I found very few exact visual measurements for OpenAI's browser UIs. Their help-center pages returned 403 to my fetches, so the OpenAI-specific material below comes from search snippets, reviews and one design teardown. I did not view any screenshots myself. Anything I inferred is marked [unverified].

## 1. ChatGPT agent mode (formerly Operator)

- **Status:** search summaries say ChatGPT agent was removed in early August 2026. The help center now points users to ChatGPT Work and its "cloud browser" [unverified: I saw this only in a search summary; the help page itself was blocked]. https://help.openai.com/en/articles/11752874-chatgpt-agent
- **Layout (Operator teardown):** in the chat, the remote computer appears as a **small thumbnail in the chat history**. Clicking it opens a popup panel or a split view with chat and computer side by side. A **collapsible steps panel** is hidden by default and lists steps in plain English. Clicking a past step shows **that step's screenshot**, which works as replay. Hover tooltips name the action ("Wait", clicking, typing "…"). The remote browser is a stock modern Chrome, so the toolbar is a real one, not a drawn one. https://letters.alfredlua.com/p/alfred-intelligence-3a-openai-operator
- **Take over:** a **"Take control"** button in Operator; in agent mode it moved to "…" → **"Take over browser"**. The agent prompts you to take over for logins, payments and CAPTCHAs. **No screenshots are captured while you are in control.** You then return control and the agent resumes. Search snippets also mention Interrupt and Stop. https://openai.com/index/introducing-operator/ , https://help.openai.com/en/articles/10421097
- **Confirmations:** the agent asks in chat before irreversible actions. Watch mode makes it pause on sensitive sites such as banks until you are watching.
- **Cloud browser (2026):** "inspect screenshots, replay its steps, and approve actions". It has a secure sign-in sheet that keeps credentials away from the model, and per-site permissions: Always ask, Auto approve, Always allow. https://x.com/jxnlco/status/2076511362604540372 , https://learn.chatgpt.com/docs/browser
- **Built-in browser:** "Enter full view" and "Enter split view", Cmd+Shift+B, and an Annotate mode. https://learn.chatgpt.com/docs/browser
- **Not found:** cursor or ripple specs, corner radii, narration typography, or any PiP behaviour beyond the thumbnail [unverified].

## 2. Atlas and Codex

- **Atlas agent mode:** the browser UI **highlights blue**, a **sparkle overlay** covers the page, a visible cursor shows where it clicks, and progress is narrated in the sidebar. Controls are Pause, Take over and Stop. It pauses on sensitive sites. https://simonwillison.net/2025/Oct/21/introducing-chatgpt-atlas/ , https://rogerwong.me/2025/10/chatgpt-atlas-browser-needs-work , https://allthings.how/chatgpt-atlas-agent-mode-macos-setup-controls-workflows/
- **Not OpenAI:** a search result described a "graphite pointer, RGB halo" cursor. That comes from a third-party GitHub project (Omerfaruk-aydn/Atlas-Agent), not from Atlas.
- **Codex computer use (Mac):** this is the most distinctive design. The agent has **its own cursor** that **wiggles while the model thinks**, takes **"playful paths"**, and **takes its colour from the wallpaper**. It came from the Sky team. https://www.macstories.net/notes/openais-new-codex-app-has-the-best-computer-use-feature-ive-ever-tested/

## 3. 2026 updates

- At DevDay (29 Sep 2026), the **Agents API added computer use in an OpenAI-hosted browser**. Sign-in and site policy stay the developer's job. I found **no Apps SDK browser component**. https://techaiwire.com/articles/openai-agents-api-computer-use-managed-runtime/
- DevDay also announced "Dots", always-on agents with their own computer and browser. https://9to5mac.com/2026/09/29/openai-teases-20-announcements-at-devday-watch-live/

## 4. Concrete numbers

None of the dimensions, radii, shadows, cursor sizes, letterboxing or transitions are published. Every value in §6 is my proposal [unverified].

## 5. Patterns worth borrowing

- **Claude in Chrome:** an orange glow border on the tab (`.claude-agent-glow-border` with a `claude-pulse` animation). Animating box-shadow cost about 50% CPU on an M1, so **animate opacity or transform instead**. https://github.com/anthropics/claude-code/issues/20070
- **Comet:** a blue outline on the controlled tab, plus animations for clicks, typing and scrolling. https://www.datacamp.com/tutorial/comet-perplexity
- **Manus "computer":** a side panel with a **timeline you can roll back** to replay sessions. https://workos.com/blog/introducing-manus-the-general-ai-agent
- **Browserbase Live View:** a read-only state via `pointer-events:none`, `navbar=false`, one view per tab, and a `browserbase-disconnected` message. https://docs.browserbase.com/platform/browser/observability/session-live-view
- **Dia:** I found nothing relevant [unverified].

## 6. Spec for our mock browser (Apple editorial)

**Anatomy**
- **Frame:** 14px radius, 0.5px hairline border, shadow `0 1px 2px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.08)`.
- **Toolbar:** 44px tall, translucent material. Three neutral dots, not traffic-light colours, so we don't imitate macOS.
- **Origin pill:** centred, SF Pro 13px. Shows the **registrable domain** in bold and the path dimmed. Lock icon for https. A key-shield badge appears when the `fill_credential` tool owns a field ("Password filled securely, not visible to agent").
- **Tabs:** only when there are 2 or more, as compact 28px chips.
- **Viewport:**
  - The CDP stream is fixed at 1280×800 (16:10) and scaled with `object-fit: contain`.
  - Letterbox bars use a neutral surface colour.
  - Pointer coordinates are mapped back through the same scale factor.

**Agent cursor**
- A 20px arrow with a 1.5px white outline and a soft shadow.
- It moves along an eased curve: cubic-bezier(.2,.8,.2,1), 250–450ms depending on distance, with a slight arc.
- **Click pulse:** a 24→44px ring fading from 0.35 to 0, over 400ms.
- While thinking, a slow ±2px idle drift (borrowed from Codex).
- Cursor targets come from **action events**, not frames, so the cursor runs ahead of the stream and frames catch up. Keep the last frame on screen and never blank it.

**Caption**
- One line pinned to the bottom of the frame. SF Pro Text 13/18, medium weight, verb first ("Opening the pricing page").
- Crossfades on each new step.
- The full step list lives in a collapsible "Steps" disclosure, with one thumbnail per step.

**States**

| State | Treatment |
|---|---|
| Live | Small green "Live" dot in the pill |
| Agent acting | Inner accent ring that animates opacity only |
| Awaiting approval | Viewport dims to 40%. A centred sheet shows the action, the origin and Approve/Deny. Focus moves to the sheet |
| User in control | Ring turns your accent colour, banner reads "You're in control · Agent paused · screenshots off". Agent cursor hidden |
| Paused/sleeping | Frame desaturated, "Paused" with Resume |
| Reconnecting | Last frame blurred 8px plus a spinner. Retries with backoff |
| Replaying | Scrubber below the viewport, "Replay · step 4/12", Jump to live |

**Take over and hand back**
- A "Take over" button, plus ⌘⇧T [unverified choice; check for conflicts].
- When you take over: acquire the lock, pause the agent, stop recording screenshots, focus the viewport, and capture keyboard input.
- **Esc must not escape**, because pages need it. Release focus with ⌘⇧T or the "Hand back" button.
- On hand back, offer an optional note to the agent.

**PiP / mini mode**
- A 240px-wide thumbnail docked bottom-right in the notes view, showing the caption and the state dot.
- Click to expand with a 300ms spring scale-up.

**Accessibility**
- Caption region uses `aria-live="polite"`. Approvals use `role="alertdialog"`.
- Buttons are at least 44px.
- The canvas has `aria-label`="Remote browser, <origin>".
- `prefers-reduced-motion`: the cursor jumps instead of travelling, the pulse becomes a static dot, and crossfades replace scaling.
- Navigation transition: a 150ms crossfade, with a thin progress bar in the toolbar between `Page.frameNavigated` and the first new frame.

Two things to confirm in a live ChatGPT session before treating them as fact: the help-center wording (pages returned 403 here) and the August 2026 removal of agent mode.
