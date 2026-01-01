---
run_id: 2026-10-05-15-research-webrtc-live-view
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-13-research-chatgpt-browser-ui]
---

I recommend replacing the CDP screencast with n.eko (WebRTC) as the single live view. Use one n.eko + Chromium container per active run, taken from a fixed pool of slots that the `agent` service leases. Keep CDP only for what the model sees: step screenshots, network capture and WebAuthn. I ran no experiments, so all numbers are from sources or estimates marked [unverified].

## 1. Streaming options

| Option | Latency / fps | Audio | CPU/RAM per session | License | Complexity |
|---|---|---|---|---|---|
| **n.eko** (Xvfb + PulseAudio + GStreamer + Pion) | ~100–200 ms, 25–30 fps [unverified] | Yes | ~0.5–1 core at 25 fps; Chromium ~1–2 GB [unverified]. A third-party build reports ~55% of a core on a static screen, 12–17% with a damage-gated encoder | Apache-2.0 | Low |
| Selkies | Targets 60 fps at 1080p; WebSocket by default, WebRTC opt-in | Yes | Higher; `--shm-size=2g` | MPL-2.0 | Medium |
| KasmVNC | WebSocket/WebCodecs, up to 60 fps | No audio listed in the README | Moderate | GPL-2.0 | Medium |
| noVNC | VNC over WebSocket; choppy on video | No | Low | MPL-2.0 | Low |
| webrtc-streamer | WebRTC via `screen://` capture | Yes | Low–moderate | Unlicense | No input forwarding: view only |
| Custom GStreamer `webrtcbin` | Best you can tune | Yes | Same as n.eko | LGPL | High: rebuilds n.eko |
| CDP screencast (today) | Variable, ~5–15 fps [unverified] | No | Low | n/a | Low, but no native popups |

**n.eko details:**
- It has a REST API: control request, release, take and give; clipboard; upload by drop or through the file dialog; screenshot and a JPEG screencast; sessions; metrics.
- It authenticates by cookie, Bearer token or query token. Per-member permissions include `can_host` and `can_access_clipboard`.
- It embeds in an iframe with `?embed=1`.
- A Vue-free TypeScript client library is on the roadmap but **not built yet**. For a custom UI we either use the iframe or build our own client on its WebSocket/WebRTC protocol.
- For many sessions, **neko-rooms** (Apache-2.0) starts containers through the Docker socket and uses Traefik.

Sources: https://github.com/m1k1o/neko , https://neko.m1k1o.net/docs/v3/api , https://neko.m1k1o.net/docs/v3/roadmap , https://github.com/m1k1o/neko-rooms , https://github.com/selkies-project/selkies , https://github.com/kasmtech/KasmVNC , https://github.com/mpromonet/webrtc-streamer

## 2. Playwright on the same browser

Yes, this works, and someone has already built it (https://github.com/frankhommers/neko-chrome-cdp-docker):
- Add `--remote-debugging-port=9222`.
- Replace n.eko's `policies.json`, which sets `DeveloperToolsAvailability: 2` and so blocks DevTools.
- Headed Chrome binds CDP to 127.0.0.1 only, so a `socat` proxy is needed to reach it.
- Then call `connectOverCDP`. The streaming and CDP sides do not conflict.

Things to watch:
- **Viewport:** use the default context with `viewport: null` and size the window to match Xvfb. Otherwise the emulated viewport won't match what the user sees.
- **Masking:** Playwright's `mask` and its default `caret: 'hide'` **inject DOM overlays and styles into the live page** (I checked `screenshotter.ts`), so the user would see pink boxes flash. Use `Page.captureScreenshot` instead and draw the masks on the image afterwards in the agent.
- **What still works unchanged:** the WebAuthn virtual authenticator, `Network.*` capture of timedtext captions, and clean screenshots are all per-target CDP and don't depend on headed vs headless.
- **Background tabs** may not render frames in headed mode [unverified].

## 3. Input and control lock

- n.eko sends mouse and keyboard over a data channel to the X server (XTest).
- **CDP input bypasses X, so n.eko cannot block the agent.** The lock has to live in our code. On a click on the video:
  1. Our API sets `runs.control = 'user'` in Postgres.
  2. It aborts the agent's in-flight action with an `AbortController` (the loop must check this between primitives).
  3. It calls n.eko's "take control" for that user.
  4. The UI starts forwarding input.
- **Shortcuts:** ⌘T/⌘W/⌘N go to the page only in JS-initiated fullscreen, using `navigator.keyboard.lock()` (Chromium only). Outside fullscreen the browser handles them itself. OS keys such as ⌘Q and ⌘Tab can't be captured. Holding Esc exits. https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock
- **IME:** n.eko sends keysyms, so Latin input works. CJK composition is [unverified]; the fallback is pasting through the clipboard.

## 4. Clipboard, upload, download

- **Clipboard:** two-way through the API and xclip. Sync is automatic in Chromium clients using the async Clipboard API; other browsers need manual sync [unverified]. Allow it per member with `can_access_clipboard`.
- **Upload:** use n.eko's `upload/dialog` endpoint for when a native file chooser opens, or `upload/drop` (drop a file at x,y). The native GTK dialog does appear on the stream.
- **Download:** CDP `Browser.setDownloadBehavior` to a per-run folder → agent moves it to the object store → UI shows a signed link. Leave n.eko's file-transfer plugin off; we don't need two paths.

## 5. Networking on Dokploy

WebRTC media can't go through Traefik. Only signaling (HTTP and WebSocket) goes through Traefik. https://neko.m1k1o.net/docs/v3/configuration/webrtc

- Give each slot `NEKO_WEBRTC_UDPMUX=590NN` and `TCPMUX=590NN`, published unremapped as `590NN:590NN/udp` and `/tcp`.
- Set `NAT1TO1=<public IP>`.
- Open the firewall to 59001–59010 on both UDP and TCP.
- The TCP mux covers most networks that block UDP.
- Add **coturn** (BSD license) on 3478 UDP/TCP, plus 5349 TLS, only for networks that allow nothing but port 443. It needs `use-auth-secret` so the API hands out short-lived credentials. TURN on 443 would need Traefik TCP SNI passthrough [unverified on Dokploy].

## 6. Security

- **Exposure:** n.eko is never exposed directly. Route `/live/:runId` through Traefik with ForwardAuth to `web`, which checks that the user owns the run. `web` then logs into n.eko server-side with that slot's random credentials (`object` member provider), so the browser never holds them [unverified detail].
- **CDP:** 9222 stays on an internal network that only `agent` can reach.
- **Model vs user view:** the model only ever gets masked CDP screenshots. The stream is user-only and shows real fields. While the user is in control, no screenshots are captured, the same as Operator.
- **Isolation:** each run gets a fresh `user-data-dir` (the container restarts on release) and its own UDP port. Optionally add a per-slot network.

## 7. Anti-bot

- The gain is modest. New headless is now close to headed.
- Headed on Xvfb gains real popup and window behaviour and audio.
- Both still give away a SwiftShader/llvmpipe WebGL renderer and leave traces of the CDP connection.
- Treat it as a small plus, not a reason to switch.

Sources: https://cside.com/blog/headless-browser-detection , https://webdecoy.com/blog/browser-fingerprinting-2026-what-still-works/

## 8. Recommendation

- **Replace the CDP screencast entirely.** Takeover is just a click (D27), so the passive view must already be the interactive stream. Switching transports on click would cause a visible jump.
- **Put it behind a small `LiveView` interface with one implementation (n.eko).** It covers connect, control and clipboard/upload, which follows principle 5 without a second transport.
- **The PiP thumbnail and step thumbnails** use the step screenshots we already take, or n.eko's JPEG screencast.

**Topology: one browser per container per run, from a static slot pool**
- Declare `browser-1..N` in the Compose file, each running n.eko + Chromium + socat with fixed ports 590NN. Static slots avoid mounting the Docker socket.
- `agent` leases a slot in Postgres, the same lease pattern as D14.
- It runs `connectOverCDP(http://browser-N:9223)` and serves takeover, abort and download.
- On release, it restarts the slot.
- RAM isn't a limit (D12): start with N=4–8. Move to neko-rooms-style dynamic containers (through a docker-socket-proxy) only if concurrency needs it.

Spec §1/§5 need updating for this, and the CDP screencast pieces of the live-view spec should be dropped.
