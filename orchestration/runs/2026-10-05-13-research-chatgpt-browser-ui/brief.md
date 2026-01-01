---
run_id: 2026-10-05-13-research-chatgpt-browser-ui
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

This is a web research task. Return your report as your final reply and do not write any files. Today is 2026-10-05.

**Context.** We're designing an agentic note-taking web app with an Apple-like editorial design language (see `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md`, D17). Its agent drives a real headless Chromium. We stream that browser to our UI over a CDP screencast, and the user can take over: mouse and keyboard are forwarded through CDP `Input.dispatch*`, with a control lock that pauses the agent.

The user says ChatGPT's computer-use and browser-use UI, which shows a **mock browser**, is very delightful and wants us to match it. Research how OpenAI presents these, as of late 2026:

1. **ChatGPT agent mode (formerly Operator)**, the "virtual computer"/browser panel inside a chat:
   - frame and chrome design: the fake browser toolbar, URL bar, tabs;
   - how the screenshot or live stream is shown, and any cursor animation or click ripples;
   - narration and progress text above or beside the browser, plus collapsed vs. expanded states and the picture-in-picture thumbnail in the chat;
   - the "Take over" flow: its button, how the UI changes when the user is in control, "Return control"/"Hand back", and pausing screenshots for sensitive input;
   - confirmation prompts, watch mode, the end-of-task summary, and replay of steps.
2. **ChatGPT Atlas browser agent mode**, and the **Codex / ChatGPT desktop app computer-use UI** if it's visually distinct: overlays on the real page, the agent cursor, the "agent is working" glow or border, and the stop button.
3. **Any 2026 updates**, e.g. DevDay 2026 (Agents API hosted browser) or an Apps SDK browser component.
4. **Concrete, reproducible design details:**
   - dimensions and aspect ratio handling;
   - corner radius and shadows;
   - how the stream scales and letterboxes;
   - cursor design (size, trail, click pulse);
   - loading and skeleton states between frames;
   - transitions when the agent navigates;
   - typography of narration;
   - how thinking and actions are interleaved.
   Cite screenshots, OpenAI help-center articles, launch videos and blog posts, and design teardowns. Mark anything you inferred rather than saw as [unverified].
5. **Comparable delightful patterns** worth borrowing: Claude for Chrome, Perplexity Comet, Manus "computer", Browserbase live view, Dia.
6. **A concrete spec for OUR "mock browser" component**, staying within the Apple editorial direction:
   - anatomy: frame, toolbar, URL/origin pill with a lock and a credential-safe indicator, tab strip (if any), and viewport;
   - agent cursor with an animated move path and click pulse;
   - per-step narration caption;
   - states: live, agent acting, waiting for approval, user in control, sleeping/paused, reconnecting, replaying history;
   - the take-over/hand-back interaction, including the keyboard shortcut and focus capture;
   - mini/PiP mode;
   - accessibility, reduced motion, and latency tricks such as interpolating the cursor between frames.

Your final reply should be a report of no more than 1000 words, with source URLs and [unverified] flags.
