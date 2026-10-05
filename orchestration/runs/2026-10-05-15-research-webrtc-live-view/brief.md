---
run_id: 2026-10-05-15-research-webrtc-live-view
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-13-research-chatgpt-browser-ui]
---

This is a research task: web research, plus optional quick experiments in your scratchpad. Return the report as your final reply and don't write files in the repo. Today's date is 2026-10-05.

**Read first for context:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md`, especially decisions D19, D26 and D27
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-13-research-chatgpt-browser-ui/report.md`

**Goal.** The user wants to use the agent's live browser from our web UI "like any other browser". Takeover happens just by clicking into the preview. Our current design streams the browser with a CDP `Page.startScreencast` (JPEG frames) and forwards input via `Input.dispatch*`. That gives no audio, choppy video, no native popups (`<select>`, date pickers, context menus, file dialogs) and some lag.

The proposed alternative is a **headed Chromium on a virtual display**, streamed over **WebRTC**. The agent still controls the browser through Playwright/CDP on the same browser. Everything is self-hosted on Dokploy with Docker Compose, free, and the server has 512 GB of RAM.

**Research these, with sources:**

1. **Streaming options compared:**
   - n.eko (m1k1o/neko): license, its architecture (Xvfb, PulseAudio, GStreamer, Pion WebRTC), whether it can embed in our own UI without its stock client, its API, and multi-session management
   - Selkies-GStreamer
   - Kasm/KasmVNC
   - noVNC
   - webrtc-streamer
   - a custom GStreamer `webrtcbin` pipeline
   - CDP screencast

   For each, give latency, fps, audio support, CPU/RAM per session, licensing and complexity.
2. **Can Playwright attach** over CDP to the headed Chromium running inside a neko-style container (`--remote-debugging-port`, `connectOverCDP`) while neko streams the same display? Any conflicts? Can we still take clean CDP screenshots, use the WebAuthn virtual authenticator, run network capture for timedtext captions, and use screenshot masking?
3. **Input forwarding and control lock.** Click-to-takeover: how input works when the user clicks the stream; how to pause the agent instantly; whether browser-reserved shortcuts (⌘T/⌘W) can be captured, using the Keyboard Lock API in fullscreen; IME/composition support.
4. **Clipboard bridging** in both directions, **file upload** (user picks a local file and it lands in the remote file chooser) and **download** (remote file comes to the user).
5. **Networking on Dokploy and Traefik:** WebRTC needs UDP or a TURN server. Cover self-hosted coturn, using a single UDP port range versus TCP/ICE-TCP fallback, and what has to be exposed on the server.
6. **Security:** per-session auth tokens on the stream; making sure screenshots and the stream to the *model* stay masked while the *user* stream shows real fields during takeover; isolating sessions from each other.
7. **Anti-bot benefit** of headed versus headless Chromium in 2026.
8. **Recommendation** for our design. Options: replace the CDP screencast entirely; use WebRTC only for takeover and CDP screencast for passive watching; or put both behind a `LiveView` transport interface. Give the exact container topology: one browser container per run, or many browsers per container. Explain how it plugs into the `agent` service.

**Final reply:** a report under 900 words, with source URLs and [unverified] flags.
