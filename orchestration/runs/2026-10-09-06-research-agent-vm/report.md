---
run_id: 2026-10-09-06-research-agent-vm
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

# Per-run sandbox VM for MasterTutor (D53c): research and design report

**Recommendation in one paragraph.** Run each desktop slot as a Firecracker microVM inside its own ordinary, unprivileged Compose service. That service gets only `devices: [/dev/kvm, /dev/net/tun]` and `cap_add: NET_ADMIN`, the same pattern dockur and Windows Agent Arena use. No host runtime install, no `daemon.json` change and no privileged container is needed. The guest is a small Debian desktop built from the existing n.eko image: Xorg dummy, openbox with a panel, Chromium, a terminal, a file manager, LibreOffice and Python. n.eko keeps running inside the guest, so live view and takeover stay as they are. A new in-guest helper, `deskd`, works over vsock and does desktop screenshots, XTest input, window and AT-SPI queries, files and exec. Chromium's CDP is still forwarded to the agent, so the browser tools keep working. The VM network boundary is enforced outside the guest, in the slot container: a tap device, nftables set to default drop, and a small allowlisting egress proxy that refuses private ranges. Reset restores the VM from a golden memory snapshot, which leaves no state behind. The most important security conclusion: **a VM where the model can run code cannot keep the vault's guarantees.** In v1, desktop runs get no vault, no sealed sessions and no credential tools. The D44 invariants then hold by structure, not by trusting the guest.

---

## 0. What I read in the repo, and two findings

- **There is no `BrowserProvider` interface by that name.** CLAUDE.md lists "browser provider" as a swappable boundary. In code, that boundary is spread across several pieces:
  - `SlotPool` with `SlotStore` and `BrowserControl` (`apps/agent/src/slots/pool.ts`, `lifecycle.ts`);
  - `cdpBaseUrl(name)`;
  - `LiveView` (`apps/agent/src/live/live-view.ts`);
  - `BrowserSession` (`apps/agent/src/browser/session.ts`, Playwright `connectOverCDP`).

  The plan below formalises these as one `SlotProvider` seam, and keeps the existing `SlotPool` lease, reset and pool logic unchanged.
- **D51 in `orchestration/STATE.md` is truncated.** The row begins mid-sentence ("the model submits again. (d) …"), and it was already like that in commit 1703044. I used the surviving clause (d) and `navigation-scope.ts`. The orchestrator should restore the full text.
- **Relevant current facts:**
  - **Reset.** Slots reset by CDP `Browser.close`, then the container exits and Compose restarts it. `SlotPool` then waits for a new browser id.
  - **Egress filter.** It is iptables written by the slot's own entrypoint (`apps/browser-slot/bin/slot-entrypoint`), so it runs inside the sandboxed container.
  - **Downloads.** They go through a `downloads` volume shared by every slot and the agent.
  - **AppArmor.** Prod slots need the `mastertutor-slot` profile (D45), only so Chromium can create user namespaces.
  - **Click guard.** It is entirely DOM/CDP: `input-guard.ts`, `hit-test.ts`, `computer.ts`.
  - **Masking.** It is CDP box masks plus a local tesseract pixel scan (`pixel-screen.ts`).
  - **Contracts.** `TOOL_NAMES` is explicitly commented "There is no exec_* tool", and `TOOL_PROFILE_TOOLS` has `browser_use` and `computer_use`.

---

## 1. VM technology comparison

| Option | Isolation | Boot / reset | Snapshot / warm pool | GPU-less desktop | Compose / Dokploy fit on the shared host | Licence | Overhead |
|---|---|---|---|---|---|---|---|
| **Firecracker, direct, inside a container** (recommended) | Hardware (KVM) plus a minimal Rust VMM: only 5 emulated devices (virtio-net, virtio-block, virtio-vsock, serial, minimal keyboard controller), with seccomp built in. The container adds a second layer. | "<125 ms" to user space (official). Restores reported at tens of ms, plus lazy page faults. | Full snapshots are GA. Memory is mapped MAP_PRIVATE and copy-on-write, which suits reset-to-golden. Diff snapshots are still developer preview. | No display device. That doesn't matter, because Xorg dummy/Xvfb run inside the guest, as in E2B and Browserbase. | Good: an ordinary service with `/dev/kvm` and `/dev/net/tun` and NET_ADMIN. No host install. | Apache-2.0 | "<5 MiB" per VM, plus guest RAM |
| Cloud Hypervisor, direct | Hardware, Rust VMM, more devices: virtio-fs, hotplug, Windows guests | ~100 ms class [unverified] | Has snapshot/restore, but "not supported across different versions". A recent release offloads it to a daemon. | No GPU upstream (the virtio-gpu work is an out-of-tree crosvm patchset) | Same container pattern as Firecracker | Apache-2.0 / BSD [unverified] | Small |
| QEMU/KVM (q35 or microvm) | Hardware, but a large C device model, so a bigger VMM attack surface | Seconds for q35. microvm is faster. | Mature savevm/migration-to-file. **Can take host-side screenshots and inject input (QMP, VNC) that the guest cannot fake.** | Best: real virtual display, VNC/SPICE, Windows guests | Same container pattern (dockur, WAA, Cua's QEMU backend) | GPL-2.0 (fine for self-hosting) | Higher |
| Kata Containers (CH, QEMU or FC backend) | Hardware | ~1 s class [unverified] | Not exposed through Docker | Works | **Poor for us.** It needs the Kata runtime installed on the host and registered with dockerd, which is a host change on a shared host. Users also report open docker-compose networking bugs (services can't reach each other, only `lo` present). | Apache-2.0 | Medium |
| firecracker-containerd | Hardware | Fast | Its own snapshotter | Works | Needs its own containerd, devmapper snapshotter and CNI on the host. It isn't Docker-native. | Apache-2.0 | Medium |
| gVisor (runsc) | User-space kernel. Weaker than a VM, much stronger than runc. | Container-speed | Checkpoint works with `runsc` but **not in the containerd shim**, with restore bugs reported | Chromium/Xvfb aren't on the compatibility list ("only real way to know … is to try") | Needs `runsc` installed on the host and registered in daemon.json (a host change) | Apache-2.0 | Low |
| LXD VMs (QEMU under the hood) | Hardware | Seconds | Good | Good | A host daemon (snap) outside Dokploy's model | **AGPL-3.0** (the repo says so). Incus is the Apache-2.0 fork [unverified]. | Medium |
| Plain container desktop (what the Anthropic and OpenAI reference stacks do) | Shared host kernel | Fast | `docker commit` only | Fine | Native | n/a | Lowest |

**How existing agent sandboxes do it:**
- **Anthropic computer-use-demo.** A Docker container with Xvfb, VNC (5900) and noVNC (6080). It recommends a dedicated VM or container, allowlisted egress and human confirmation, and 1024×768 (XGA).
- **OpenAI CUA sample app.** A Docker container: Ubuntu 22.04, Xfce, Xvfb, x11vnc and Firefox ESR.
- **E2B.** A forked Firecracker runtime (Apache-2.0). The desktop template is Xfce with noVNC and X input primitives. Its single-host "Embed" compose is `privileged: true`, `network_mode: host`, `pid: host`, `cgroup: host` and mounts `/` at `/host`, and E2B calls it "an evaluation package, not a production deployment pattern". **That is unacceptable on our shared host.**
- **Browserbase.** One browser per Firecracker VM, destroyed after each session, an isolated subnet, no GPU.
- **Browser Use Cloud.** Firecracker, headless Chromium, restored from a snapshot taken "just before Chromium launches":
  - VM cold start is under 400 ms; browser creation is 825 ms at p50.
  - 2 MB pages cut restore page faults from about 100k to about 1.1k.
  - vsock is used for readiness signalling.
- **Daytona.** Docker by default, with Kata or Sysbox opt-in. AGPL-3.0, and reportedly closed-source since June 2026 [unverified].
- **Scrapybara.** Hosted Ubuntu, browser and Windows instances with pause/resume and CDP access. The internals aren't public.
- **Cua.** Docker images (Xfce, Kasm) by default. QEMU/KVM "when you need true OS isolation … over startup speed and density".
- **OpenHands.** A Docker container per task running an "Action Execution Server" (REST `/execute_action`). Our `deskd` follows the same pattern.
- **Windows Agent Arena.** QEMU/KVM in Docker via dockur, from a 30 GB "golden image". Defaults are 8 GB RAM and 8 cores.

**Why Firecracker:**
- It is the smallest VMM attack surface.
- Its snapshot/restore is production-grade and is exactly our reset model.
- It is proven for this exact workload (Browserbase, Browser Use, E2B).
- It is Apache-2.0.
- It runs in a normal container on Dokploy.

**Fallbacks:**
- **Cloud Hypervisor**, if we later need virtio-fs or Windows guests.
- **QEMU**, if we ever want host-trusted screenshots and input, or Windows desktops. That is the WAA/dockur path.

**A deliberate deviation from Firecracker's production guide.** The guide wants the **jailer** (chroot, cgroups, privilege drop), which needs CAP_SYS_ADMIN. I propose that the container is the jail instead:
- one VM per container;
- the VMM runs as a non-root uid with only `/dev/kvm` and the tap fd;
- docker-default seccomp and AppArmor;
- a read-only root;
- `mem_limit`, `cpus` and `pids_limit`, plus `memswap_limit = mem_limit` so guest memory never swaps;
- Firecracker's own seccomp left on.

The guide also says to disable SMT and KSM. Those are **host-wide** settings on a shared host. Check them read-only and don't change them without the user (§5).

---

## 2. Guest design

**Base.** Build the guest from the current slot image lineage. n.eko publishes a supported `ghcr.io/m1k1o/neko/xfce` image, and our openbox-based `chromium` image is already in use. Steps:
1. `docker build` the guest image.
2. `docker export` it.
3. `mkfs.ext4 -d` to make a read-only rootfs.
4. Add a per-run copy-on-write overlay on a tmpfs-backed sparse file.

This keeps one Dockerfile as the source of truth, in line with principle 6.

**Kernel.** A small Firecracker-config kernel, at least 5.18, so VMGenID reseeds the kernel RNG after a restore. The init mounts `/proc` and `/sys`, configures the network and execs supervisord. No systemd is needed.

**Desktop at 1280×800@30.** This keeps `VIEWPORT` and the computer-tool coordinate bounds unchanged.

| Need | Choice | Why |
|---|---|---|
| WM and panel | openbox (already used) + tint2 | Lightest conventional-looking desktop. Use Xfce if models do measurably better on it (E2B and Cua chose Xfce for familiarity). Decide in the spike by testing. |
| Browser | Chromium with the existing policies.json and `--force-renderer-accessibility` | CDP tools unchanged. Built-in PDF viewer. |
| Terminal | xfce4-terminal (VTE) | Exposes its text through AT-SPI |
| File manager | pcmanfm | Small, GTK, so AT-SPI works |
| Office / PDF | LibreOffice (MPL-2.0) + Evince | Study materials are .docx, .pptx and PDF. Both expose AT-SPI. |
| Text editor | mousepad | Small |
| Python | python3 + venv, numpy, pandas, matplotlib, sympy | Study tasks. No Jupyter in v1 (bloat). |
| Fonts | Noto incl. CJK, plus math fonts | Faithful rendering |
| Accessibility | at-spi2-core | Desktop hit test (§4) |
| Size | about 2.5–3.5 GB rootfs; 4 GiB RAM, 2–4 vCPU per VM [estimate] | |

**In-guest services.** All run under supervisord, the same layout as today.
- **n.eko.** It already streams the whole X display, so the live view simply shows the desktop.
- **Chromium.** CDP on guest loopback 9222, with socat to 9223 on the guest tap address.
- **PulseAudio.** TCP 4713 for `audio-capture`.
- **`deskd` (new, our code).** It listens only on vsock, so it has no network exposure:
  - `screenshot()` (XShm, then PNG);
  - `input(action)` (XTest, mapped from the OpenAI computer actions);
  - `windows()` (EWMH stacking, focus and geometry);
  - `hitTest(x, y)` (AT-SPI role, name and app at a point);
  - `exec(cmd, cwd, timeoutMs, maxBytes)`;
  - `filePut`, `fileGet` (size-capped and streamed);
  - `freeze(on)` (cgroup freezer for the `agent-exec` scope).

  These six or seven methods are its whole public interface.

**Transport.** Firecracker vsock maps host-initiated connections to a Unix socket with a `CONNECT <port>` handshake. The slot container runs a tiny relay from its `cdp`-network IP to that socket, restricted to the agent IP, the same way CDP on 9223 is restricted today.

**Snapshot point.** Take the golden snapshot after kernel, Xorg, openbox and PulseAudio are up, and **before** n.eko, Chromium and `deskd` start. This is the same reason Browser Use snapshots before Chromium launches, plus one more of our own: n.eko generates its DTLS certificate at start. If that were in the snapshot, every run would share it. VMGenID reseeds the kernel RNG. Userspace that holds randomness starts fresh after the restore.

**Live view and takeover.** Unchanged in protocol:
- Traefik routes `/live/<runId>/` to the slot container on 8080, then DNAT to the guest on 8080.
- The WebRTC mux port 5900N is published as today, then DNAT to the guest. `NEKO_WEBRTC_NAT1TO1=PUBLIC_IP` and the pion TCP-mux patch stay.
- `NekoLiveView` keeps working (host, member, clipboard).
- One new desktop-mode item: on takeover, the agent also calls `deskd.freeze(true)`, so background processes the agent started (for example a pyautogui loop) can't act while the user is in control. This is best effort, because the guest is untrusted. The hard stop is host-side: the slot container can pause the whole VM through Firecracker's API.

---

## 3. Security

### 3.1 Threat model change

In browser mode, only Chromium's renderer runs untrusted code. The Chromium browser process, and therefore CDP, is trusted. In desktop mode, **the model can run arbitrary code as the desktop user**: terminal, Python. Prompt injection can steer that code, and a guest root exploit is plausible. So **everything the guest reports is untrusted after the first code execution**: CDP answers, AT-SPI, window lists, `deskd` results. Only controls outside the guest are hard boundaries: the slot container's nftables and proxy, and Firecracker plus KVM.

### 3.2 Egress and SSRF at the VM boundary

- **Network layout.** The guest gets one tap, `tap0`, on a /30. All nftables rules live in the slot container's network namespace, outside the guest. The guest cannot change them.
- **Egress.** Default drop. The only forward path is TCP to an **egress proxy** on the tap gateway, plus IPv6 off.
- **Why a proxy.** D51's allowlist is enforced by CDP `page.route`, and `curl` or `pip` inside the guest ignore it. Today's slot egress is "any public IP". With code execution, the allowlist has to sit at the network boundary.
- **The proxy.** A small explicit HTTP CONNECT proxy, our own code: about 200 lines of Node or Go, with no Squid. Guest apps get `HTTPS_PROXY`, and Chromium gets `--proxy-server`. Tools that don't support a proxy simply fail, which is fail-closed. The proxy:
  1. Checks the CONNECT host against the run's allowed sites, using the **same** `navigation-scope` rules imported from contracts or the agent package (one source of truth).
  2. Resolves the host itself and refuses private, special-use and metadata ranges. These are the same `V4_BLOCKS` as `network-policy.ts`, moved into `packages/` so there is no copy, and the check covers DNS rebinding.
  3. Connects to the IP it checked.
  4. Blocks UDP and QUIC.
- **Approvals.** A denied host raises an event to the agent, which opens the existing `new_origin` approval. On approval the agent pushes the updated allowlist over an agent-only control port.
- **Bypass.** Bypass auto-approves new sites, but the private-range check is hard-coded in the proxy. No API exists to disable it, so the D44 invariant holds by construction.
- **Ingress.** Ingress DNAT (9223/9224 from the agent, 8080 from agent/web/Traefik, 4713 from `audio-capture`, the 5900N mux) moves from the in-slot entrypoint to the container namespace, outside the guest. This is stronger than today.

### 3.3 Vault: the desktop VM breaks fill pinning

`fill_credential` pins on the main frame's origin, the target frame's origin and the field type, all reported by Chromium through CDP. Inside a desktop VM, guest code running as the same user (or root after an exploit) can:
- connect to CDP on guest loopback and read input values;
- read Chromium's memory and profile (cookies, `storageState`);
- replace Chromium altogether and fake CDP answers.

Pinning would still stop the *agent* from filling a wrong origin under an honest Chromium. It cannot stop the secret being read afterwards and printed, encoded, where a screenshot or `exec` output carries it to the model. Base64 or reversed text defeats the OCR scan. In-guest uid separation (Chromium as `browser`, agent code as `desk`, Yama ptrace_scope 2, nftables `skuid` blocking loopback 9222) doesn't fix this. X11 lets any client keylog and inject into any other window, and a guest kernel exploit defeats all of it.

**v1 rule (proposed for the user to confirm):** desktop runs have
- no `fill_credential` or `use_passkey`;
- no sealed `browser_sessions` loaded;
- nothing sealed back from the VM, because cookies from an untrusted guest could also poison our session store.

Desktop runs are for unauthenticated or public material and for working on files. If the user signs in during a takeover, the run view warns them: "anything you type or open in this desktop can be read by the agent's programs". The session dies at reset.

**Later option for credentialed desktop work: a split-trust run.** The run holds a normal browser slot, which is trusted, has the vault and is unchanged, plus a desktop VM. Files cross only through the agent (download gate, then Garage, then `filePut`). This costs a two-tile live view and is a separate decision.

### 3.4 Masking and the secret screen

- With no vault secrets in the VM, `MaskSources.hasSecrets()` is false and nothing needs masking.
- Desktop model screenshots come from `deskd.screenshot()` and still go through the same pipeline: sharp, the `pixel-screen` OCR scan when secrets are registered, and storage of the masked step image.
- If split-trust is ever built, CDP mask boxes only translate to desktop coordinates while Chromium is the top-most, unobscured window at those boxes. Otherwise the frame is dropped: fail closed.
- During takeover the user's stream stays unmasked, as today.

### 3.5 Downloads and file exfiltration

- **Downloads into the VM.** Chromium downloads to a guest path. The network fetch is already governed by the proxy.
- **Shared volume removed.** Desktop slots don't mount the shared `downloads` volume. That removes a host volume shared between untrusted slots and the agent, which is an improvement.
- **Leaving the VM.** Files leave only through `deskd.fileGet`: size-capped and streamed. This needs a new **`file_export`** approval, after which the agent stores the file in Garage, writes `downloads`/`assets` rows and emits `download_ready`.
- **Into the VM.** The agent pushes Garage assets with `filePut`, for example to open a note's PDF in LibreOffice. That needs no approval, because the data is already ours. The user uploads through n.eko as today.
- **Policy choice for the user.** In desktop mode, should a download *into* the VM still need approval? It is no longer an egress risk. I suggest keeping the approval in v1 for parity, and revisiting it later.

### 3.6 Clipboard

- `deskd` has no clipboard-read API, so the model never reads the clipboard directly.
- n.eko clipboard sync stays enabled only while `controller='user'`.
- Warn the user that anything they paste into the VM is visible to the agent afterwards.
- Reset destroys the clipboard. Clearing it on hand-back is best effort, because the guest is untrusted.

### 3.7 Reset with no leftover state

The reset is enforced from outside the guest:
1. The slot container kills the Firecracker process.
2. It deletes the per-run copy-on-write disk (tmpfs-backed, so nothing remains on disk).
3. It restores from the golden snapshot (a MAP_PRIVATE mapping, so the snapshot file is never written).

A compromised guest can't refuse a reset, which differs from today, where Chromium must cooperate with `Browser.close`. Keep `SlotPool`'s new-browser-id check as the readiness signal.

**Where the golden snapshot comes from.** It is produced once per container start: a cold boot of about 3–5 s [estimate], then a snapshot to tmpfs. That avoids baking multi-GB memory files into images and any risk of CPU/kernel mismatch. It costs RAM, about 6 × 4 GiB, which is trivial on a 500 GB host.

### 3.8 Bypass invariants (D44) in desktop mode

| Invariant | How it holds |
|---|---|
| Secrets never reach the model, logs or screenshots | Structurally: the vault is off and no sessions are loaded (§3.3). The OCR scan stays as defence in depth. Telemetry never carries `exec` command or output text. |
| Vault fills only on the exact origin | Trivially (no fills). Browser mode is unchanged. |
| Network policy (no private/SSRF) and sandbox stay on | Enforced outside the guest (nftables plus the proxy resolver check). Bypass has no switch for them. |
| Kill switch and takeover always work | The kill switch pauses or kills the VM host-side through the Firecracker API within 1 s. Takeover uses the agent-side `ControlGuard` on every `deskd` call, plus `freeze`, plus optionally a host-side VM pause. |
| D38 OpenAI data policy | Unchanged. `exec` and `deskd` text going to the model is wrapped as untrusted content, windowed and size-capped. |
| `malicious_instructions` pauses for a human | Unchanged |

---

## 4. Integration

### 4.1 Provider seam

```ts
// apps/agent/src/slots/provider.ts  (formalises today's scattered seam)
interface SlotProvider {
  readonly kind: "browser" | "desktop";
  cdpBaseUrl(name: string): Promise<string>;          // unchanged for both kinds
  readBrowserId(name: string): Promise<string | null>; // readiness, as today
  recycle(name: string): Promise<void>;               // browser: CDP Browser.close; desktop: host-enforced VM restore
  desk?(name: string): DeskClient;                    // desktop only: deskd over the vsock relay
}
```

**What stays the same:**
- `SlotPool`'s lease, reset, reconcile and drain logic. `BrowserControl.closeBrowser` becomes `provider.recycle`.
- `LiveView` and `NekoLiveView`.
- `BrowserSession` and every CDP tool.

**Data changes:**
- `browser_slots` gains `kind`. The slot-name regex becomes `^(browser|desktop)-[1-9][0-9]?$`.
- New env `DESKTOP_SLOTS`, alongside `BROWSER_SLOTS`.
- `pickIdleSlot` filters by the run's kind. The rule 3 warm-slot reserve applies per kind.
- `concurrency` counts both kinds.

**Compose.** A new `x-desktop-slot` anchor with these settings:
- `image: mastertutor/desktop-slot`
- `devices: [/dev/kvm, /dev/net/tun]`
- `cap_add: [NET_ADMIN]`
- `group_add: [<kvm gid>]`
- `read_only: true`
- `tmpfs` for the overlay and snapshot
- `mem_limit`, `memswap_limit`, `cpus`, `pids_limit`
- networks `cdp`, `egress`, `pulse`

It needs no `mastertutor-slot` AppArmor profile, because Chromium's user namespaces are now inside the guest kernel. Default 2 desktop slots (`desktop-1`, `desktop-2`), each with its own 5900N port.

**Long-term simplification.** After parity is proven, browser mode could run in the same VM image with just Chromium. That would drop the container-Chromium path and the userns AppArmor profile, leaving one slot kind (principle 6). Do it only after the measurements in §5.

### 4.2 Run-level choice

- Add `runs.environment: "browser" | "desktop"`, set at creation. Default `browser`.
- Add a tool profile `desktop_use`: `computer` (desktop-level), `read_page` and `capture` (Chromium via CDP, unchanged), `video`, `annotate`, and **a new typed `shell` tool**.
- `fill_credential` and `use_passkey` are not in `desktop_use`.
- **Decision for the user.** `tools.ts` currently says "There is no exec_* tool". The alternative is to let the model type into the terminal with `computer`. I recommend the typed tool:
  - the approval sheet and the Observer Guard see the exact command;
  - output comes back as capped untrusted text instead of OCR;
  - Enter keypresses into terminal windows from `computer` are refused, the same way secret-field typing is refused today.
- **Capture win.** Add `capture {kind:"file", path}`. The agent pulls the file with `fileGet` and sends it through the existing PDF/docling pipeline, which supports DOCX, PPTX and XLSX. Native-app documents are then captured 1:1 from the file, never by screen OCR.

### 4.3 Approvals: govern the boundary, not the pixels

The CDP click guard can't see native apps. Proposed rules:

1. **Clicks inside Chromium's content area while Chromium is top-most at that point.** Translate the desktop coordinates to CSS pixels (window geometry from `deskd.windows()` plus the CDP window bounds), then run **today's DOM hit test, input guard and `risky_click`/`form_submit` logic unchanged**, dispatching through CDP.
2. **Anywhere else.**
   - `deskd.hitTest` (AT-SPI role and name) feeds the same `RISKY_ACTION` matcher: a "Send" or "Delete" button gives `risky_click`.
   - With no accessible name, the action is allowed, because its effects are governed at the boundaries below.
3. **New kinds:**
   - `exec` (every `shell` call in Ask mode; Auto can allowlist none in v1);
   - `file_export`;
   - `desktop_mode` (run creation acknowledgement, like `bypassAcknowledged`).

   `new_origin` now also fires from the proxy.
4. **Taint.** After the first approved `exec`, guest-reported metadata is marked tainted. In Ask mode, rule 2's "allowed when unnamed" becomes "approve".
5. **Bypass and the Guard.** Bypass auto-approves the new kinds (D44 style, `decided_by='bypass'`). The D52 Guard gets triggers for `exec`, `file_export` and the first native-app actuation.

### 4.4 Telemetry (D50)

- **Spans:**
  - `mt.slot.reset` with `slot.kind`;
  - `mt.vm.restore` (restore ms, page faults if cheap);
  - `mt.desk.action`;
  - `mt.desk.exec` (exit code, duration, output bytes, **never the command or output text**);
  - `mt.egress.decision` (allowed/denied/private_blocked, by registrable domain).
- **Metrics:** VM restore p50/p95; proxy denials per run; desktop screenshot latency.
- **Logs:** container logs for the VMM, the proxy and the guest serial console. The serial console is untrusted text, so it goes through the collector's redaction pass.

### 4.5 Cost and latency

- **OpenAI cost.** No change per step: same 1280×800 screenshots. `shell` output is text, so it is cheaper than reading a terminal through screenshots.
- **No new paid service.** Firecracker, the kernel, the Debian packages and the proxy are all free and open source.
- **Host cost** [estimate]: about 4 GiB RAM and 2–4 vCPU per desktop slot while running, plus about 4 GiB tmpfs for the golden snapshot per slot.
- **Latency** [estimate, to be measured in the spike]:
  - restore about 50–300 ms plus page-fault warm-up;
  - n.eko and Chromium start about 0.5–1 s;
  - total reset about 1–2 s, likely faster than today's container restart [unverified, measure];
  - `deskd` over vsock is sub-millisecond per round trip;
  - XShm screenshot plus PNG encode about 10–30 ms;
  - DNAT adds negligible CDP overhead.
- **Hot-path rules (principle 2).** Stream `fileGet`. Don't poll readiness: `deskd` sends a vsock "ready" message, as Browser Use does.

---

## 5. Rollout, effort and approvals

| Phase | Content | Effort (engineer-days) |
|---|---|---|
| **P0 Spike** | Firecracker in an unprivileged container on `coursebite`. Guest from the n.eko image. Measure boot, restore, fps and CPU. n.eko through DNAT and the 5900N mux. CDP from the agent. Openbox vs Xfce model trial. Go/no-go report. | 4–6 |
| **P1 VM slot, browser parity** | `desktop-slot` image and rootfs build. Kernel. Container entrypoint (tap, nftables, VMM, snapshot, restore). `SlotProvider` refactor, `kind` column, env, compose. The existing behaviour suites (CDP, n.eko, takeover, downloads, audio) pass against a Chromium-only VM. | 10–14 |
| **P2 Boundary** | Egress proxy (shared scope and private-range rules moved to `packages/`). Approval wiring. SSRF, rebinding and QUIC tests. Host-enforced reset and kill. | 5–8 |
| **P3 Desktop mode** | `deskd`. Desktop computer executor (Chromium-region rule 1 plus AT-SPI rule 2). `shell` tool and the `desktop_use` profile (contract change). New approval kinds and policy, taint. `capture{kind:file}`. UI: mode picker with warning, desktop badge, exec/export approval sheets, takeover freeze messaging. Guard triggers. Telemetry. | 15–20 |
| **P4 Security and QA** | Security suite: guest tries CDP, proxy bypass, private ranges, reset leftovers, clipboard, exfil via export, takeover freeze. D22 UI swarm. Benchmark a study task (open PDF/PPTX, compute in Python, capture). Runbook. | 8–10 |

**Total: about 42–58 engineer-days (about 8–12 weeks for one engineer).** With subagent-driven development, P2 and the UI half of P3 can run in parallel with P1 and the back end of P3.

**Steps that need the user's approval on the shared `coursebite` host:**
1. **SSH read-only checks.** These change nothing:
   - `uname -r`;
   - `ls -l /dev/kvm` (owner, group, mode) and the kvm GID;
   - `/sys/devices/system/cpu/vulnerabilities/*`;
   - KSM state (`/sys/kernel/mm/ksm/run`);
   - swap;
   - free disk for about 3–4 GB images per tag plus build cache.
2. **Running containers with `/dev/kvm` and `/dev/net/tun`**, first in remote-test (P0/P1), then in prod. It isn't a host config change, but it is a new privilege class on a shared host.
3. **Only if `/dev/kvm` isn't group-accessible:** a udev or permission change. That is a host change.
4. **Host hardening (SMT off, KSM off) is not recommended**, because it affects every tenant. Record the current state and accept the residual side-channel risk, or decide explicitly.
5. **Prod compose changes and Dokploy deploys**: new desktop services and their 5900N ports, which need router forwarding as in run 28. These stay manual, per D42.
6. **The `mastertutor-slot` AppArmor profile is not needed for VM slots.** Keep it for browser slots until they possibly migrate.

**Decisions for the user (to record as D-rows):**
- **(a)** Desktop runs have no vault or sessions in v1 (§3.3).
- **(b)** Add a typed `shell` tool, which reverses the "no exec tool" comment.
- **(c)** New approval kinds `exec`, `file_export` and `desktop_mode`, and whether downloads *into* the VM still need approval.
- **(d)** Openbox vs Xfce, decided by the P0 trial.
- **(e)** Phase approval for P0.

Separately: restore the truncated D51 text in STATE.md.

---

## Sources

**Firecracker**
- Official site (boot, overhead, devices): https://firecracker-microvm.github.io/
- Snapshot support: https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md
- Production host setup: https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md
- vsock: https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md
- firecracker-containerd: https://github.com/firecracker-microvm/firecracker-containerd (its July 2026 release date is [unverified])

**Cloud Hypervisor**
- Repo: https://github.com/cloud-hypervisor/cloud-hypervisor
- v53 snapshot daemon: https://www.phoronix.com/news/Cloud-Hypervisor-53
- virtio-gpu is out of tree: https://spectrum-os.org/software/cloud-hypervisor/

**gVisor**
- Compatibility: https://gvisor.dev/docs/user_guide/compatibility/
- Platforms: https://gvisor.dev/docs/architecture_guide/platforms/
- Networking: https://gvisor.dev/docs/user_guide/networking/
- containerd checkpoint issue: https://github.com/containerd/containerd/issues/12280

**Kata Containers**
- docker-compose networking issue: https://github.com/kata-containers/kata-containers/issues/11767
- containerd how-to: https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/containerd-kata.md
- Docker usage: https://oneuptime.com/blog/post/2026-02-08-how-to-use-kata-containers-with-docker-for-enhanced-isolation/view

**LXD**
- Repo (AGPL-3.0): https://github.com/canonical/lxd

**E2B**
- Infra (Apache-2.0, Embed): https://github.com/e2b-dev/infra
- Embed compose: https://raw.githubusercontent.com/e2b-dev/runtime/main/embed/compose/compose.yaml
- Desktop: https://github.com/e2b-dev/desktop
- Product profile: https://github.com/api-evangelist/e2b-dev

**Browserbase**
- Security: https://docs.browserbase.com/account/enterprise/security
- Build vs buy: https://www.browserbase.com/blog/build-vs-buy-agent-infrastructure

**Browser Use (Firecracker)**
- https://browser-use.com/posts/firecracker-browser-infra

**Anthropic computer-use demo**
- https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo

**OpenAI CUA sample app**
- Docker environment: https://deepwiki.com/openai/openai-cua-sample-app/3.3-docker-environment
- Mirror: https://github.com/RLuf/openai-cua-sample-app

**Cua**
- Ubuntu Docker support: https://cua.ai/blog/ubuntu-docker-support
- Self-hosted sandboxes: https://cua.ai/docs/cua/guide/get-started/self-hosted-sandboxes

**OpenHands**
- Runtime README: https://github.com/gso-bench/OpenHands/blob/main/openhands/runtime/README.md
- Paper: https://arxiv.org/pdf/2407.16741

**Daytona**
- Repo: https://github.com/daytonaio/daytona
- Isolation options: https://pixeljets.com/blog/ai-sandboxes-daytona-vs-microsandbox/
- Closed-source claim: https://gist.github.com/wincent/2752d8d97727577050c043e4ff9e386e [unverified]

**Scrapybara**
- https://github.com/api-evangelist/scrapybara

**Windows Agent Arena and dockur**
- WAA: https://github.com/microsoft/WindowsAgentArena
- dockur compose pattern (`devices /dev/kvm`, `/dev/net/tun`, `NET_ADMIN`, MIT): https://github.com/dockur/windows

**n.eko**
- Desktop images: https://neko.m1k1o.net/docs/v3/installation/docker-images

The web-search budget ran out (200 calls) before I could check these claims: LXD vs Incus licensing, the Firecracker VMGenID version, the Cloud Hypervisor licence and boot numbers, and today's container-restart timing. They are marked [unverified] and are cheap to confirm in P0.
