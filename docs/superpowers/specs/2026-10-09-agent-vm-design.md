# Agent Sandbox VM (D53c): Design Spec

_Date: 2026-10-09. Status: draft for user review. Decision: D53c in `orchestration/STATE.md`._

**Inputs.** The main input is the research report `orchestration/runs/2026-10-09-06-research-agent-vm/report.md`, cited below as [R §N]. Decisions D44, D45, D48, D50, D51, D52 and D53 in `orchestration/STATE.md` bind this spec, and so does `CLAUDE.md`. The Guard sections (§6) of `docs/superpowers/specs/2026-10-09-observer-design.md` are cited as [OBS §N].

**Plan.** `docs/superpowers/plans/2026-10-09-agent-vm.md`.

---

## 1. Goal and scope

Give the agent a per-run **desktop**: a Linux micro-VM with Chromium, a terminal, a file manager, LibreOffice, a PDF viewer, a text editor and Python. The agent can then open study files, compute and capture documents faithfully, which a browser alone cannot do. The browser product keeps working exactly as it does today.

**In scope**

- A new slot kind, `desktop`. Each desktop slot is a Firecracker microVM inside its own unprivileged Compose service (§5).
- The guest is built from the existing slot image lineage, with a golden snapshot and a reset enforced on the host (§6).
- `deskd`, an in-guest helper on vsock with a minimal interface (§7).
- Egress at the VM boundary: nftables plus our own small CONNECT proxy, with navigation-scope and private-range rules moved into a shared package (§8).
- The `SlotProvider` seam, which formalises today's scattered seam (§9).
- The run-level choice `runs.environment`, the `desktop_use` tool profile, a typed `shell` tool, `capture{kind:"file"}` (§10), new approval kinds (§11), UI (§17), telemetry (§15) and migrations (§16).
- A phased rollout, P0 to P4. P0 is a go/no-go gate (§19).

**Out of scope (v1)**

- Vault, sealed sessions and credential tools in desktop runs (decision (a), §21).
- The split-trust run, where a browser slot and a desktop VM are held together [R §3.3]. That needs its own decision.
- Windows guests, GPUs, QEMU and Cloud Hypervisor. These are fallbacks only [R §1].
- Host-wide SMT or KSM changes, and any other host setting (§20).
- Moving browser runs onto the VM image. That is possible after the P4 measurements, and it needs a separate decision [R §4.1].

## 2. Binding requirements

| # | Requirement | Source |
|---|---|---|
| V1 | Firecracker runs inside an ordinary, unprivileged Compose service. The service gets only the devices `/dev/kvm` and `/dev/net/tun`. Its only added capability is `NET_ADMIN`. It has a read-only root and `mem_limit`, `cpus` and `pids_limit`, with `memswap_limit` equal to `mem_limit`. | brief, [R §1] |
| V2 | No jailer, no host install, no `daemon.json` change, no privileged container and no AppArmor profile change. | brief, [R §1, §4.1] |
| V3 | The guest is built from the existing slot image lineage. One Dockerfile is the source of truth. | brief, CLAUDE.md principle 6 |
| V4 | `deskd` listens only on vsock and has a minimal interface. | brief, [R §2] |
| V5 | The golden snapshot is taken before n.eko, Chromium and `deskd` start. The reset is enforced from the host. A guest cannot refuse it. | brief, [R §2, §3.7] |
| V6 | Egress is enforced outside the guest, by nftables plus our own CONNECT proxy. The proxy imports the navigation-scope and private-range rules from one module in `packages/`. Those rules are moved there, never copied. | brief, [R §3.2] |
| V7 | `SlotProvider` formalises `SlotPool` + `BrowserControl`, `cdpBaseUrl` and `LiveView`. `SlotPool`'s lease, reset, reconcile and drain logic is unchanged. | brief, [R §4.1] |
| V8 | Add `runs.environment`, the `desktop_use` tool profile, a typed `shell` tool and `capture{kind:"file"}`. | brief, [R §4.2] |
| V9 | P0 is a hard gate. No P1-or-later task starts until the P0 report says **go**. P1 proves browser parity before any desktop feature. | brief |
| V10 | The D44 hard invariants hold in desktop mode, and they hold by structure, not by trusting the guest (§14). | D44, [R §3.8] |
| V11 | Only OpenAI is paid. Firecracker (Apache-2.0), the Linux kernel (GPL-2.0), the Debian packages and our proxy are free and self-hosted. | CLAUDE.md, D11 |
| V12 | Telemetry follows D50. Names are defined once in `packages/contracts/src/telemetry.ts`. No command text, output text, file contents or page text appears in telemetry. | D50 |
| V13 | Every test suite runs on the Dokploy host through `scripts/remote-test.sh` (D48). Containers that use `/dev/kvm` run there only after the user approves (§20). | D45, D48 |
| V14 | Migrations use the placeholder names `00NN_desktop_slots` and `00NN_desktop_mode`. The numbers are assigned at merge time: Observer owns 0015, and the notes plan takes 0016 and later. | brief |

## 3. What already exists and is reused

| Piece | Where | How this spec uses it |
|---|---|---|
| Slot pool: leases, recycle, reconcile, drain | `apps/agent/src/slots/pool.ts` (`SlotPool`, `SlotStore`) | Unchanged logic. Its `control` and `cdpBaseUrl` options become one `providers` option (§9). |
| CDP lifecycle | `apps/agent/src/slots/lifecycle.ts` (`BrowserControl`, `cdpBrowserControl`) | Wrapped by `browserSlotProvider`. `closeBrowser` becomes `provider.recycle`. |
| Slot addressing | `apps/agent/src/slots/probe.ts` (`slotCdpBaseUrl`, which resolves by IP because of Chrome's Host-header rule) | Used by both providers. The desktop container DNATs 9223 to the guest. |
| Leases and claims | `apps/agent/src/slots/leases.ts` (`pickIdleSlot`, rule 3 warm reserve), `apps/agent/src/loop/claim.ts` (`claimNextRun`) | `pickIdleSlot` is unchanged. It receives only the slots of the run's kind. `claimNextRun` skips runs whose kind has no idle slot (§9.3). |
| Live view | `apps/agent/src/live/live-view.ts` (`LiveView`), `neko-live-view.ts`, `neko-admin.ts` (`http://<slot>:8080`), `idle-probe.ts` (`http://<slot>:9224`) | Unchanged. Slot names resolve on `cdp` to the desktop container, which DNATs to the guest. |
| Browser session | `apps/agent/src/browser/session.ts` (`BrowserSession.connect`, Playwright `connectOverCDP`) | Unchanged for Chromium inside the guest. |
| Network policy | `apps/agent/src/browser/network-policy.ts` (`V4_BLOCKS`, `isPrivateAddress`, `PrivateHostCheck`, `installNetworkPolicy`) | The pure range rules move to `packages/net-policy`. `installNetworkPolicy` (Playwright routing) stays in the agent and imports them. |
| Navigation scope (D51) | `apps/agent/src/browser/navigation-scope.ts` (`registrableDomain`, `sameSite`, `inRunScope`, `allowsTopLevel`) | Moves to `packages/net-policy` unchanged. Agent and proxy both import it. |
| Slot image | `apps/browser-slot/Dockerfile` (n.eko v3.1.6 server rebuilt with the pion patch, on `ghcr.io/m1k1o/neko/chromium:3.1.6`), `supervisord/chromium.conf`, `policies.json`, `bin/slot-entrypoint` | The browser slot stays as it is. New stages `guest`, `kernel`, `rootfs`, `desktop-host-deps` and `desktop-slot` extend the same file (§6.1). `slot-entrypoint`'s CIDR check, HMAC and n.eko member helpers move into `bin/slot-lib.sh`, which both entrypoints source. |
| Downloads | `apps/agent/src/browser/download-gate.ts` (`DownloadFolder`), `apps/agent/src/live/downloads.ts` (`createDownloadIngestor`), the shared `downloads` volume | Desktop slots do not mount the shared volume. The gate's saved file is pulled through `deskd.fileGet` (§12.4). |
| Contracts | `packages/contracts/src/tools.ts` (`TOOL_NAMES`, "There is no exec_* tool", `TOOL_PROFILE_TOOLS`), `approval.ts` (`AUTO_MODE_DECISIONS`, `BYPASS_DECISIONS`, `decideByPolicy`), `enums.ts`, `constants.ts`, `primitives.ts` (`SLOT_NAME_PATTERN`), `api/dto.ts` (`CreateRunInput`) | Extended (§10, §11). |
| Approval classifier | `apps/agent/src/guardrails/policy.ts` (`needsApproval`, `isRiskyLabel` from contracts) | Reused unchanged for Chromium-region actions. Its risky-label rule is reused for AT-SPI names (§11.2). |
| PDF and office capture | `apps/agent/src/pdf/pdf-capture.ts` (`buildPdfCapture`), `apps/agent/src/pdf/docling.ts` (`DoclingClient.convert(bytes, filename)`) | `capture{kind:"file"}` feeds them bytes from the VM (§10.4). |
| Telemetry | `packages/contracts/src/telemetry.ts` (`SPAN.slotReset`, `ATTR.slotName`), `instrument()` | New names are added there (§15). |
| Behaviour suites | `tests/behaviour/` (`constants.ts` `BEHAVIOUR_SLOTS`, `compose.yml`, `global-setup.ts`) | Run a second time against desktop slots for the P1 parity gate. |

## 4. Architecture

```
                         agent (cdp .10)                                  web / Traefik
                              │  CDP 9223, idle 9224, deskd 9225,               │ /live/<run>/ → 8080
                              │  control 9226 (agent IP only)                   │ WebRTC mux 591NN
┌─────────────────────────────▼─────────────────────────────────────────────────▼───────────┐
│ desktop-N  (Compose service; ro root; /dev/kvm,/dev/net/tun; NET_ADMIN; mem=swap limit)    │
│                                                                                            │
│  nftables (container netns):  ingress DNAT → guest · guest forward DROP · proxy uid egress │
│                                                                                            │
│  uid fc:    desktop-host controller ── Firecracker API (unix socket) ── firecracker VMM    │
│             • golden snapshot on tmpfs  • recycle = SIGKILL + restore  • vsock relay 9225  │
│  uid proxy: egress proxy :3128 on tap gateway  (net-policy: scope + private ranges)        │
│                                                                                            │
│      tap0 192.168.127.1/30 ◀────────────────▶ guest eth0 192.168.127.2/30                  │
│  ┌──────────────────────────────── microVM (KVM) ──────────────────────────────────────┐  │
│  │ vm-init (PID 1) → Xorg dummy 1280×800@30, WM + panel, PulseAudio      [snapshot]     │  │
│  │ after "start": n.eko :8080, Chromium (CDP 127.0.0.1:9222 → socat :9223), deskd vsock │  │
│  │ terminal, pcmanfm, LibreOffice, Evince, mousepad, python3   (desktop_use only)       │  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Module dependency map (no cycles)

```
packages/net-policy        (tldts, node:dns, node:net; no workspace deps)
   ▲            ▲
   │            └──────────── apps/desktop-host  (egress proxy, controller, relay)
   │                              └── @mastertutor/contracts  (desk wire, ports)
apps/agent ──▶ packages/contracts, packages/net-policy, packages/db, packages/telemetry
apps/web   ──▶ packages/contracts, packages/db
```

- `packages/net-policy` depends on no workspace package. That lets the proxy import it without pulling in zod contracts, pino or OpenTelemetry.
- `apps/desktop-host` never imports `apps/agent`. The agent reaches it only over HTTP and TCP, whose shapes are defined in `packages/contracts/src/desk.ts`.
- Inside the agent, the new `src/desk/` directory depends on `browser/` and `tools/`, never the reverse. The architecture test (`apps/agent/src/architecture.test.ts`) gains that rule.

## 5. The desktop slot container

### 5.1 Compose

The new anchor `x-desktop-slot` in `compose.yml`:

| Setting | Value | Why |
|---|---|---|
| `image` / `build` | `mastertutor/desktop-slot:local`, built from `apps/browser-slot/Dockerfile` with `target: desktop-slot` and `additional_contexts: { repo: . }` | One Dockerfile (V3). `repo` supplies `apps/desktop-host` and `packages/net-policy`. |
| `profiles` | `["desktop"]` | Desktop slots start only where the user approved `/dev/kvm` use (§20). |
| `devices` | `/dev/kvm`, `/dev/net/tun` | V1 |
| `cap_drop` / `cap_add` | `ALL` / `NET_ADMIN`, `SETUID`, `SETGID` | `NET_ADMIN` is the only capability **added** beyond Docker's default set (V1). `SETUID`/`SETGID` are kept from the default set so the entrypoint can drop to the `fc` and `proxy` uids. Every other default capability is dropped. |
| `group_add` | `${KVM_GID:?set KVM_GID}` | `/dev/kvm` is usually `root:kvm 0660`. The host's kvm GID is read during P0 (§20). |
| `read_only` | `true` | V1 |
| `tmpfs` | `/run/vm:size=6g,mode=0700,uid=10001`, `/tmp:size=64m` | Snapshot, API and vsock sockets. Nothing reaches disk. |
| `mem_limit` / `memswap_limit` | `10g` / `10g` | Guest RAM is 4 GiB. The snapshot memory file on tmpfs (≤ 4 GiB) is charged to the same cgroup. Guest memory never swaps (V1). |
| `cpus` / `pids_limit` | `4` / `256` | |
| `init` | `true` | `docker-init` reaps children and forwards signals. |
| `security_opt` | `no-new-privileges:true` | The docker-default seccomp and AppArmor profiles stay. Firecracker's own seccomp filters stay on. |
| `sysctls` | `net.ipv6.conf.all.disable_ipv6: 1`, `net.ipv6.conf.default.disable_ipv6: 1`, `net.ipv4.ip_forward: 1` | IPv6 is off. Forwarding is needed only for the ingress DNAT. Guest-originated forwarding is dropped by nftables. |
| `networks` | `cdp`, `egress`, `pulse` | The same networks as browser slots. |
| `restart` | `always` | |

**Services.** `desktop-1` and `desktop-2`. Each sets `SLOT_NAME`, `NEKO_WEBRTC_UDPMUX`/`TCPMUX` to `59101`/`59102` and publishes that port (`DESKTOP_MEDIA_PORT_BASE = 59100`). `compose.prod.yml` adds `x-desktop-prod` (image tag `prod`, log driver as for slots, no AppArmor profile) and the `/live` Traefik routers for `desktop-N`, copied from the `browser-N` router pattern with the slot name changed. `NEKO_ALLOWED_IPS`, `CDP_ALLOWED_IP` and `PULSE_ALLOWED_IP` come from `x-slot-env` unchanged.

**No AppArmor profile.** Desktop slots do not need `mastertutor-slot` (D45), because Chromium's user namespaces are created by the guest kernel.

### 5.2 Users and processes

| uid | Name | Process | Access |
|---|---|---|---|
| 0 | root | `desktop-entrypoint` (bash) | Validates env, creates `tap0` owned by `fc`, loads nftables, then execs the two programs below with `setpriv`. Nothing else runs as root. |
| 10001 | fc | `node apps/desktop-host/src/main.ts`, which spawns `firecracker` | `/dev/kvm` (through the supplementary kvm GID), `tap0`, `/run/vm`. |
| 10002 | proxy | `node apps/desktop-host/src/egress/main.ts` | Listens on `192.168.127.1:3128` for the guest, and on loopback `127.0.0.1:3129` for its control API (`PUT /state`, `POST /reset`, `GET /events`), whose only client is the controller. nftables lets only this uid open outbound connections, and lets it reach Docker's DNS on `127.0.0.11`. |

The entrypoint runs both with `setpriv --reuid=<uid> --regid=<uid> --init-groups|--groups=<gid> --inh-caps=-all --bounding-set=-all --no-new-privs`. It waits with `wait -n`, so if either process exits the container exits and Compose restarts it. A container restart rebuilds the golden snapshot (about 3–5 s, [R §3.7]).

### 5.3 Network inside the container

`apps/desktop-host/nft/desktop.nft` is a template the entrypoint renders with validated env.

- **Ingress DNAT to the guest** `192.168.127.2`:
  - from `CDP_ALLOWED_IP` only: 9223 (CDP) and 9224 (idle probe);
  - from `NEKO_ALLOWED_IPS`: 8080 (n.eko);
  - from `PULSE_ALLOWED_IP`: 4713;
  - from anyone: the WebRTC mux port, UDP and TCP.

  Everything else to the container is dropped.
- **Agent-only ports served in the container itself:**
  - 9225: the deskd relay to vsock;
  - 9226: the controller's HTTP control API.

  Both accept only from `CDP_ALLOWED_IP`.
- **Guest egress:**
  - The `forward` chain drops every packet from `tap0`, except replies to the DNATed ingress connections (`ct status dnat`).
  - The guest may reach only `192.168.127.1:3128` (the proxy) in the `input` chain.
  - UDP from the guest is dropped, which blocks QUIC and DNS.
- **Container egress.** In the `output` chain, only `meta skuid "proxy"` may open new connections to non-private addresses. Private and special-use ranges are rejected with the same CIDR list as `apps/browser-slot/bin/slot-entrypoint`, which gives defence in depth. The `fc` uid has no network access except loopback and the relay sockets.
- **Test fixtures.** `SLOT_EGRESS_ALLOW_CIDRS` keeps its meaning (private CIDRs ≥ /16, validated as in `slot-entrypoint`). The proxy reads it too (§8.3).

**No forwarding path in any phase.** From P1 on, the guest's only way out is the proxy (§8). In P1 the proxy runs untainted (any public host, private ranges refused), which is the same reach as today's browser slots. P2 adds the scope switch, the control API and the approvals.

### 5.4 Firecracker, snapshot and reset

- **VM shape.**
  - 2 vCPUs and 4096 MiB (`DESKTOP_VM_VCPUS`, `DESKTOP_VM_MEM_MIB`);
  - one read-only root drive `/opt/vm/rootfs.ext4`;
  - no writable drive: the guest's overlay upper directory is a guest tmpfs, so it is part of guest RAM and the snapshot;
  - one virtio-net device on `tap0`;
  - one vsock device (guest CID 3, `uds_path /run/vm/vsock.sock`);
  - no other devices;
  - kernel `/opt/vm/vmlinux`, boot args `console=ttyS0 reboot=k panic=1 pci=off ro init=/sbin/vm-init`.
- **Golden snapshot**, at container start:
  1. Cold boot.
  2. `vm-init` brings up Xorg and the window manager (in P3 also the session bus and AT-SPI).
  3. It connects to host vsock port 1025 and writes `golden\n`.
  4. The controller pauses the VM, then `PUT /snapshot/create` with `snapshot_type: Full` to `/run/vm/golden.{vmstate,mem}`.
  5. It kills that VMM.

  The snapshot point is before n.eko, Chromium, PulseAudio and `deskd` start (V5). The reason: n.eko generates its DTLS certificate at start, and in-process randomness must not be shared across runs. VMGenID reseeds the kernel RNG on restore. PulseAudio starts after the snapshot because its ACL comes with the start line.
- **Restore (`recycle`)**:
  1. SIGKILL the running VMM if any.
  2. Remove its API socket.
  3. Spawn a new `firecracker --api-sock /run/vm/fc.sock`.
  4. `PUT /snapshot/load` with `mem_backend: {backend_type: "File", backend_path: golden.mem}` (MAP_PRIVATE) and `resume_vm: true`.
  5. Connect to guest vsock port 51 and send `start <epoch_ms> <base64url JSON>\n`. The JSON carries only the allowlisted guest settings: the n.eko member object (passwords derived as in `slot-entrypoint`), the WebRTC NAT and mux settings, and the PulseAudio ACL. `vm-init` validates every key, sets the clock (TLS needs it), then starts supervisord for n.eko, Chromium, the CDP socat, the idle probe, PulseAudio and `deskd`.
  6. Give the restored VM a fresh random `vmId`.

  `recycle` resolves after step 5. **Readiness** is the desktop provider's browser id: the controller's `vmId`, returned only once the guest's CDP answers (§9.1). The `vmId` changes only on a host-side restore. So a guest that restarts Chromium by itself can never make `SlotPool` skip a restore, which keeps `SlotPool`'s no-leftover rule (V7). If Chromium exits, the guest halts (`reboot -f` with `reboot=k`), and the controller restores at once.
- **No leftover state.** The memory file is mapped MAP_PRIVATE, so it is never written. The root drive is read-only. Everything a run wrote lived in guest RAM, which is discarded by the SIGKILL. A compromised guest cannot refuse or survive a recycle (V5).
- **Kill switch and cancel.** Today's path is `RunWorker.stop("kill")` → `#onStop` → `#release` → `releaseSlot` → `SlotPool.reset` → `provider.recycle`. The recycle's SIGKILL is the hard stop. P4 verifies that the VM process is gone within 1 s of the kill switch.
- **Unverified items P0 must pin:**
  - the exact Firecracker release and its sha256;
  - whether guest vsock listeners survive a restore (the fallback is for `vm-init` to dial the host instead);
  - VMGenID support in the pinned Firecracker and kernel;
  - restore p50/p95;
  - whether `memswap_limit = mem_limit` is honoured on the host (the cgroup v2 `memory.swap.max`).

## 6. Guest

### 6.1 One Dockerfile, five targets

`apps/browser-slot/Dockerfile` gains stages after the existing ones. The existing final stage is renamed `slot-image`, and the file ends with `FROM slot-image AS slot`, so the browser-slot image and its build commands do not change.

| Stage | FROM | Content |
|---|---|---|
| `neko-server` | (existing) | unchanged |
| `slot-image` | (the existing final stage, renamed) | unchanged |
| `guest` | `slot-image` | `guest/vm-init`, `guest/supervisord.conf` and `guest/programs/*.conf` (Chromium with the slot's flags plus `--proxy-server`, and in P3 `--force-renderer-accessibility`), n.eko's own `[program:neko]` extracted from the image, `deskd`, python3. P3 adds the desktop packages (§6.3). |
| `kernel` | `debian:trixie-slim` (pinned digest) | Builds Linux 6.1 LTS (pinned tarball sha256) with Firecracker's `microvm-kernel-ci-x86_64-6.1.config` plus `guest/kernel/mt.config` (vsock, VMGenID, overlayfs, no modules). Produces `vmlinux`. |
| `rootfs` | `debian:trixie-slim` | `COPY --from=guest / /tree`, then `mkfs.ext4 -d /tree -L mtguest rootfs.ext4` sized to content plus 10%. |
| `desktop-host-deps` | `node:24-slim` (the repo's pinned digest) | `pnpm install --prod --filter @mastertutor/desktop-host...` over the `repo` build context. Workspace packages stay symlinked outside `node_modules`, which Node type stripping requires (the same recipe as the root Dockerfile). |
| `desktop-slot` | `debian:trixie-slim` | `firecracker` (pinned release and sha256 from the P0 report), `nftables`, `iproute2`, `util-linux` (setpriv), the `node` binary from the same pinned image, the `desktop-host-deps` tree, `/opt/vm/{vmlinux,rootfs.ext4}`, `slot-lib.sh`, users `fc` (10001) and `proxy` (10002). |
| `slot` | `slot-image` | The last line of the file, so the default target and every existing `docker build apps/browser-slot` caller still produce the browser slot unchanged. |

The `guest` stage is the only place guest content is defined (V3). There is no `docker export` step outside the build.

### 6.2 `vm-init`

`vm-init` is a POSIX shell script that runs as PID 1 in the guest. It:

1. mounts `/proc`, `/sys`, `/dev`, `/dev/pts` and `/run`;
2. mounts a tmpfs (1536 MiB) as the overlay upper over the read-only root, and pivots into it;
3. brings up `eth0` as `192.168.127.2/30` with gateway `.1` and no DNS;
4. starts Xorg (n.eko's `xorg.conf` with the 1280×800@30 modeline from the slot image) and the window manager (in P3, first the session D-Bus and AT-SPI, and the panel);
5. writes `golden\n` to host vsock 1025;
6. listens on vsock 51 (`socat VSOCK-LISTEN:51`) for the start line (§5.4). When it arrives, it sets the clock, writes the validated settings to `/run/guest.env`, writes the PulseAudio config with the TCP module and the same `auth-ip-acl` that `slot-entrypoint` writes, and starts supervisord;
7. reaps children forever.

The start line must match `start <13 digits> <base64url>`, and its JSON must have exactly the allowlisted keys, each matching its pattern. Anything else halts the guest, and the controller restores it.

### 6.3 Desktop content (P3, `desktop_use`)

| Need | Package |
|---|---|
| Window manager and panel | openbox (already in the lineage) + tint2, **or** Xfce, decided by the P0 trial (decision (d)) |
| Terminal | xfce4-terminal (VTE, which exposes text through AT-SPI) |
| Files | pcmanfm |
| Office and PDF | LibreOffice (writer, calc, impress), Evince. Macros are disabled by a system registry policy (`MacroSecurityLevel = 3`, locked). |
| Editor | mousepad |
| Python | python3, python3-venv, numpy, pandas, matplotlib, sympy. No Jupyter. |
| Fonts | fonts-noto-core, fonts-noto-cjk, fonts-noto-mono, fonts-stix |
| Accessibility | at-spi2-core, python3-pyatspi, python3-xlib |

The environment sets `HTTPS_PROXY`, `HTTP_PROXY` and `ALL_PROXY` to `http://192.168.127.1:3128`, and `NO_PROXY` to an empty string. The image is about 2.5–3.5 GB [R §2].

## 7. `deskd`

### 7.1 Interface

`deskd` is the whole public surface the agent sees inside the guest (V4). It runs as the desktop user, never root:

| Method | Params | Result | Notes |
|---|---|---|---|
| `hello` | — | `{ methods: string[], version }` | The contract test compares `methods` with `DESK_METHODS`. |
| `screenshot` | — | raw BGRX pixels (1280×800×4) | X `GetImage` of the root window. The agent encodes the PNG with sharp, which it already uses. |
| `input` | `{ action: ComputerAction }` (existing contract) | `{ ok: true }` | XTest through `xdotool` (argv lists, no shell). OpenAI key names map to keysyms; unknown keys are refused. Coordinates are bounded by `VIEWPORT`. |
| `windows` | — | `{ windows: [{ id, app, title, x, y, w, h, focused }] }` ≤ 64 | EWMH `_NET_CLIENT_LIST_STACKING`, top-most last. |
| `hitTest` | `{ x, y }` | `{ app, role, name, editable } \| null` | AT-SPI `getAccessibleAtPoint` on the top-most window at the point. `name` ≤ 500 chars. |
| `exec` | `{ command, cwd, timeoutMs ≤ 120000, maxBytes ≤ 65536 }` | `{ exitCode, stdout, stderr, truncated, timedOut, ms }` | `bash -lc` as user `neko`, in its own session, inside the cgroup `agent-exec`. On timeout the whole process group is killed. |
| `filePut` | `{ path }` + bytes | `{ size }` | Paths must be under `/home/neko` after `realpath`. Opened with `O_NOFOLLOW`. ≤ 64 MiB. |
| `fileGet` | `{ path, maxBytes }` | `{ size }` + bytes | Same path rule. Regular files only. ≤ 64 MiB. |
| `freeze` | `{ on }` | `{ ok: true }` | Writes `cgroup.freeze` for `agent-exec`. Best effort, because the guest is untrusted. |

There is no clipboard method (§12.5) and no network method.

### 7.2 Wire

The transport is a byte stream: vsock port 52 in the guest, relayed by the controller to TCP 9225 (agent IP only).

- **Frames.** One UTF-8 JSON header line `{"id":n,"method":…,"params":…,"bytes":k}\n`, followed by exactly `k` raw bytes (`k` ≤ 64 MiB).
- **Responses** mirror that: `{"id":n,"ok":true,"result":…,"bytes":k}\n` plus the bytes, or `{"id":n,"ok":false,"error":{"code","message"}}`.
- **Validation.** The header schemas are zod objects in `packages/contracts/src/desk.ts` (`DeskRequest`, `DeskResponse`, `DESK_METHODS`, `DESK_LIMITS`). The agent validates every response with them, and treats every result as untrusted (§3.1 of [R]).
- **Implementation.** `deskd` is Python 3 (stdlib, plus `python3-xlib` and `pyatspi` from Debian). AT-SPI's maintained bindings are GI and Python, and the guest ships Python anyway (§6.3). `deskd` has its own `unittest` tests, run in the `guest` build stage.

The method list and limits are defined once, in `desk.ts`. A behaviour test calls `hello` and checks `deskd`'s answer against them, so the Python side cannot drift.

### 7.3 P1 subset

In P1, `deskd` implements only `hello` and `fileGet`, which download parity needs (§12.4). P3 adds the rest. The guest stage installs it in both phases.

## 8. Egress

### 8.1 Shared rules: `packages/net-policy`

A new workspace package, `@mastertutor/net-policy`. Its only runtime dependency is `tldts`. These modules **move** there (V6):

- `src/scope.ts` takes `registrableDomain`, `sameSite`, `inRunScope` and `allowsTopLevel` from `apps/agent/src/browser/navigation-scope.ts`, with its test file. The agent file is deleted.
- `src/private-range.ts` takes `V4_BLOCKS`, `isPrivateAddress`, `PrivateHostCheck`, `HostResolver`, `dnsResolver` and `isFixtureHost` from `apps/agent/src/browser/network-policy.ts`, with their tests.

`network-policy.ts` keeps only the Playwright parts (`installNetworkPolicy`, `isAllowedNavigationScheme`, `BlockedNavigation`) and imports the rest. `apps/agent/src/vault/runtime.ts`, `loop/run-loop.ts`, `browser/session.ts` and `testing/fake-loop-browser.ts` update their imports. `tests/security/inventory.test.ts` updates the moved test path. The architecture test asserts that nothing under `apps/` defines `V4_BLOCKS` or `registrableDomain`.

### 8.2 The proxy (`apps/desktop-host/src/egress/`)

It is a small HTTP proxy that handles both `CONNECT host:port` and absolute-form `GET http://…`. It is our own code, about 300 lines, with no Squid.

For each request it:

1. Parses the target and builds its origin (`https://host[:port]` for CONNECT; `http://host[:port]` for absolute-form).
2. **Private-range check, always.** It resolves the host itself (`PrivateHostCheck`). It refuses if the host or any resolved address is private (`isPrivateAddress`), except fixture CIDRs listed in `SLOT_EGRESS_ALLOW_CIDRS`. No API, mode or flag can disable this.
3. **Scope check** (§8.3), through `decideEgress()`.
4. Connects to **the exact address it checked**, never re-resolving, which defeats DNS rebinding. It streams bytes both ways. For absolute-form requests it forwards the head with `Connection: close`.
5. Reports the decision on the event stream (§8.4).

Ports 1–1023 other than 80 and 443 are refused. UDP is not proxied. Request heads are capped at 16 KiB, and the proxy enforces idle and connect timeouts.

### 8.3 Scope: taint switches the allowlist on

Chromium's subresources (CDNs, fonts, APIs) come from many sites that are not the run's allowed origins. Enforcing the run scope on every connection would break ordinary pages. Enforcing nothing would let guest code reach any host. The rule ties egress strictness to whether untrusted code can run (decision (e)):

| Run state | Allowed |
|---|---|
| **Untainted**: no `shell` call and no native-app actuation has been approved or executed yet | Every public host, the same as browser slots today. Top-level navigations are still governed by CDP `installNetworkPolicy` and D51, unchanged. While untainted, only Chromium's browser process (trusted) and its sandboxed renderers make connections. |
| **Tainted** | `inRunScope(origin, allowedOrigins)` (D51 rules 1–2), plus `allowsTopLevel(..., signInFlowOpen)` (rule 3, which never applies in v1 because desktop runs have no vault), plus every registrable domain the proxy saw used **before** taint (the "learned" set, so open pages keep working), plus every origin approved later. |

Taint is one-way, per lease. The agent sets it through the control API (§8.4) **before** it executes the first `shell` call or the first native-app action. The recycle clears it.

A denied connection emits `egress_blocked {origin}`. The agent turns that into the existing `new_origin` approval through `LoopBrowser.drainBlockedNavigations()`, so in-loop policy (D44, D51 (c)) applies unchanged:

- **Ask** asks;
- **Auto** denies unless allowlisted;
- **Bypass** approves and adds the origin.

### 8.4 Control API and event stream (controller, port 9226)

| Route | Body | Effect |
|---|---|---|
| `POST /recycle` | — | §5.4 restore. Answers `{ vmId, restoreMs }` once the VM is resumed and `start` is sent. |
| `GET /vm` | — | `{ vmId \| null }`. It is null while a restore is in flight. |
| `PUT /egress` | `EgressState { allowedOrigins ≤ 200, tainted }` | Validated, then forwarded to the proxy's loopback control. Replaces the state. Once `tainted` is true it stays true until the next recycle; a later `tainted: false` is ignored. |
| `GET /egress/events` | — | NDJSON stream of `EgressEvent { at, origin, site, decision: allowed_first \| denied \| private_blocked }`. `allowed_first` is sent once per registrable domain per lease. The agent holds one stream per lease. |

All shapes are zod schemas in `packages/contracts/src/desk.ts`. Requests come only from the agent IP (nftables). Bodies are capped at 64 KiB.

## 9. `SlotProvider` seam

### 9.1 Interface (`apps/agent/src/slots/provider.ts`)

```ts
export interface SlotProvider {
  readonly kind: SlotKind;                              // "browser" | "desktop"
  cdpBaseUrl(name: string): Promise<string>;            // both kinds: http://<ip>:9223
  readBrowserId(name: string): Promise<string | null>;  // readiness, as today
  recycle(name: string): Promise<void>;                 // browser: CDP Browser.close; desktop: POST /recycle
  desk?(name: string): DeskClient;                      // desktop only
  egress?(name: string, runId: string): EgressChannel;  // desktop only
}
export interface SlotProviders { forSlot(name: string): SlotProvider }
```

- `browserSlotProvider()` wraps `cdpBrowserControl` and `slotCdpBaseUrl` unchanged.
- `desktopSlotProvider()` addresses the slot's `cdp` IP: CDP on 9223 (the container DNATs it), `POST :9226/recycle`, `createDeskClient(<ip>:9225)`, and an egress channel over `:9226/egress`. Its `readBrowserId` returns the controller's `vmId` (from `GET :9226/vm`), and only once `cdpBrowserControl.readBrowserId` also answers (§5.4).
- `slotProviders({ browser, desktop })` dispatches with `slotKindOf(name)`.

`LiveView` is not part of the interface, because it is already slot-kind-agnostic: n.eko answers on `<slot>:8080` for both kinds.

### 9.2 `SlotPool` keeps its logic

`SlotPoolOptions.control` and `SlotPoolOptions.cdpBaseUrl` are replaced by `providers: SlotProviders`. `#restart` still loops until a different browser id answers, still closes (now `recycle`s) at most once, and still marks the slot idle. Every existing case in `pool.test.ts` keeps its expectation. Only the fakes change from `{ control, cdpBaseUrl }` to a fake provider. That is the evidence for V7. `rememberBrowser(name, baseUrl)` becomes `rememberBrowser(name)`.

### 9.3 Leases and claims

- `SLOT_NAME_PATTERN` becomes `^(browser|desktop)-[1-9][0-9]?$`, and `slotKindOf(name)` returns its prefix.
- The `browser_slots.kind` column (§16) is derived from the name and constrained to match it.
- `claimNextRun` asks which kinds have an idle slot (`select distinct kind from browser_slots where state = 'idle' and name = any(slots)`), filters candidates with `runs.environment = any(kinds)`, and calls `pickIdleSlot` with only the slots of the candidate's kind.
  - The rule 3 warm reserve then applies per kind.
  - `concurrency` still counts every leased slot.
  - A queued desktop run with no idle desktop slot never blocks browser runs, and the reverse holds too.
- Env: `DESKTOP_SLOTS` (an optional `SlotList` of `desktop-*` names; empty means none) sits beside `BROWSER_SLOTS` (`browser-*` only) in `AgentEnv` and `MigrateEnv`. `syncBrowserSlots` receives both lists.
- `assertConcurrencyFitsSlots` counts both lists.

## 10. Run-level changes

### 10.1 `runs.environment`

- The `run_environment` enum is `browser | desktop`, default `browser`, set at creation and immutable.
- `CreateRunInput` gains `environment` (default `browser`) and `desktopAcknowledged?: true`.
- These refinements apply:
  - `environment = desktop` ⇔ `toolProfile = desktop_use`;
  - `desktop` requires `desktopAcknowledged: true`.
- `RunSummary` gains `environment`.

### 10.2 The `desktop_use` profile

```
TOOL_PROFILE_TOOLS.desktop_use = ["computer", "read_page", "capture", "video", "annotate", "shell"]
```

`fill_credential` and `use_passkey` are absent (decision (a)). `shell` appears in no other profile. The `TOOL_NAMES` comment "There is no exec_* tool" is replaced with "`shell` exists only in `desktop_use` (D53c)".

### 10.3 The `shell` tool (decision (b))

```ts
ShellArgs   = { command: string 1..4000, cwd: string ≤ 512 | null, timeoutSec: int 1..120 | null }
ShellResult = { exitCode: int, stdout: string ≤ 32000, stderr: string ≤ 8000, truncated: boolean, timedOut: boolean }
```

- **Approval.** `approval()` returns `{kind:"exec", command, cwd}` every time. Policy then decides (§11.1).
- **Taint.** On act, before the first call it sets taint (§8.3) and records it in the run's `DesktopState`.
- **Result.** It calls `desk.exec`. The result is `untrusted: true`, so the registry wraps it with `wrapUntrusted` before it reaches the model (D38: windowed and capped).
- **Telemetry.** The span carries `mt.desk.exit_code`, `mt.desk.output_bytes` and `mt.desk.timed_out`, never the command or output (V12).

### 10.4 `capture{kind:"file"}`

- **Args.** `CaptureArgs.kind` gains `"file"`, and `CaptureArgs` gains `path: string ≤ 512 | null`. `kind = file` requires `path` and `environment = desktop`; otherwise the result is `ToolError("file_capture_unavailable")`.
- **Approval.** `approval()` returns `{kind:"file_export", path, bytes: null}`.
- **Act:**
  1. `desk.fileGet(path, MAX_PDF_BYTES)`.
  2. Sniff the type from the bytes, never from the extension the guest reports.
  3. A PDF goes to `buildPdfCapture` (the existing pipeline).
  4. DOCX, PPTX and XLSX go to `DoclingClient.convert(bytes, basename)` when docling is configured (compose profile `pdf`); otherwise `ToolError("docling_unavailable")`.
  5. Anything else gives `ToolError("unsupported_file")`.
- **Storage.** The original file is stored as an asset and a `downloads` row (`approvedBy` = the decider), and `download_ready` is emitted. So the file the person approved exporting is also theirs to keep.
- **Provenance.** Blocks keep `origin: "pdf"` (docling or pdf.js). The source URL is `file://<basename>`, which is display only.

### 10.5 Turn context (D56)

`apps/agent/src/loop/turn-context.ts` is the single path for model-visible run facts. At a turn boundary it derives allowed origins, saved sign-in aliases/origins/field names, approval mode, budget, plan, takeover and wait state from their owners. It emits only changed facts as `Executor:` input, and restates all facts after compaction. No credential values or labels enter this context (D38 rule 3).

Desktop facts plug into this same module: immutable run environment, the validated file list, shell cwd, per-lease taint and which apps are open. P1 supplies the environment/provider facts; P3 supplies validated desktop observations and shell state. Use data already loaded by the provider, observation and lease, with no second prompt or extra per-step DB reads. Guest-provided paths and app names remain bounded, validated untrusted data, never executor instructions. Desktop v1 continues to expose no vault tools or sessions (§12.1).

## 11. Approvals

### 11.1 Kinds (decision (c))

| Kind | Request | When | Ask | Auto | Bypass |
|---|---|---|---|---|---|
| `exec` | `{ command ≤ 4000, cwd }` | Every `shell` call | ask | **denied** (no exec allowlist in v1) | approved |
| `file_export` | `{ path ≤ 512, bytes \| null }` | Every `capture{kind:"file"}` | ask | **denied** | approved |
| `desktop_mode` | `{ environment: "desktop" }` | Written by web at run creation as an already-approved row (`decided_by` = the creating user, `step_seq = 0`). It is an audit of the acknowledgement, like `bypassAcknowledged`. | n/a | n/a | n/a |

- `AUTO_MODE_DECISIONS` and `BYPASS_DECISIONS` gain all three kinds. `desktop_mode` maps to `"ask"` in both, because the tables are total and `decideByPolicy` is never called with it. This is the same convention as Observer's `observer` kind [OBS §8].
- `download` keeps its row: downloads into the VM still need approval in v1 (decision (c)).
- If Observer's `data_egress` and `observer` kinds land first, this plan's contract task adds its kinds beside them, and the reverse.

### 11.2 Desktop computer actions: govern the boundary, not the pixels

`DesktopComputerExecutor` (`apps/agent/src/desk/desktop-computer.ts`) classifies each action with `deskd.windows()` and `deskd.hitTest()`:

1. **Rule 1 (Chromium region).** The point is inside the Chromium window's content area (CDP `Browser.getWindowForTarget` bounds, matched to the EWMH window), and Chromium is top-most there. The action is translated to CSS pixels and runs through **today's** `ComputerExecutor`, `targetFor`, `needsApproval`, input guard and click guard, dispatched over CDP. This is unchanged code.
2. **Rule 2 (anywhere else).**
   - An AT-SPI name that `isRiskyLabel(name)` matches gives a `risky_click` approval with label `"<app>: <name>"`.
   - `Enter` (keypress, or a line break in `type`) aimed at a terminal (`role = terminal`) is refused with `TERMINAL_ENTER_REFUSAL` ("Use the shell tool to run commands"). This mirrors the secret-field typing refusal.
   - With no accessible name, the action is allowed while untainted.
   - Once tainted, in Ask mode it asks `risky_click` with label `"<app>: unnamed control"`. Auto and Bypass apply their `risky_click` rows.
3. **Taint.** The first rule-2 actuation (click, double click, activating keypress, or `type`) sets taint before it executes.

The model's screenshot comes from `deskd.screenshot()` and goes through the existing pipeline (sharp, then `pixel-screen` when secrets are registered, which never happens in v1, then masked step storage).

### 11.3 Guard (D52) integration

These triggers are added to `packages/observer/src/guard/triggers.ts` [OBS §6.2]:

| Trigger | When |
|---|---|
| `exec` | Every `shell` call |
| `file_export` | Every `capture{kind:"file"}` |
| `first_native_actuation` | The first rule-2 actuation of a run |

`GuardItem.actionClass` gains `exec | file_export`. The `exec` item carries `{ commandChars, firstToken }` and nothing else. `firstToken` is the first whitespace-separated word, ≤ 32 chars, matched against `^[A-Za-z0-9._/-]+$` or replaced with `"other"`. Full command text never reaches the Guard, which keeps it metadata-only [OBS §6.4]. Composition is unchanged: `strictest(policy, guard)`, so a Guard `escalate` pauses Bypass too.

## 12. Vault, sessions, masking, files and clipboard

### 12.1 Vault and sessions (decision (a))

Desktop runs:

- have no `fill_credential` or `use_passkey` (they are absent from `desktop_use`);
- load no sealed `browser_sessions`;
- seal nothing back.

The vault hooks check `run.environment` and return no tools and no sessions for desktop runs. That makes every D44 secret invariant hold by structure: there is no secret in the VM to leak.

### 12.2 Masking

`MaskSources.hasSecrets()` is false for desktop runs. The OCR scan stays wired as defence in depth.

### 12.3 Takeover warning

When a person takes over a desktop run, the run view shows: "Anything you type, paste or open in this desktop can be read by the agent's programs. It is erased when the run ends." Sign-in during takeover is allowed and not blocked. The session dies at recycle.

### 12.4 Downloads

- **Browser parity (P1).** `BrowserSession` is given `downloads: { slotPath: "/home/neko/Downloads/<runId>", localPath: "<agent downloadsDir>/<runId>" }`. The `DownloadGate` sweeps and reports as today. `DownloadFolder` gains an optional `pull(id: string): Promise<void>`, which copies `<slotPath>/<id>` into `<localPath>/<id>`. The desktop connector implements it with `desk.fileGet`. The gate calls it before it reports `onFinished`, and a failed pull is logged, never announced.
- **No shared volume.** Desktop slots do not mount `downloads` [R §3.5]. `clearRunDownloads` deletes the agent-local folder.
- **Approval.** Downloads into the VM keep needing approval (decision (c)).

### 12.5 Clipboard

`deskd` has no clipboard method. n.eko clipboard access is granted only while `controller = 'user'`, as today. Recycle destroys the clipboard.

### 12.6 Files into the VM

The agent may `filePut` assets the run's workspace already owns, for example to open a note's PDF. That needs no approval: the data is already ours. In v1 nothing in the tool set uses this. It exists for P4's benchmark task, and the model cannot call it directly.

## 13. Live view and takeover

- **Protocol unchanged.** Traefik routes `/live/<runId>/` to `desktop-N:8080`, which DNATs to the guest. The WebRTC mux is published as today, with `NEKO_WEBRTC_NAT1TO1=PUBLIC_IP` and the pion TCP-mux patch carried in the `slot` stage.
- **Takeover freeze.** For desktop slots, `liveHooks.control` calls `desk.freeze(true)` after `giveControl` and `desk.freeze(false)` before `takeControl`. Freeze failures are logged and counted (`mt.desk.action{method=freeze,outcome=error}`). They never block the takeover. The agent's own actions stop as today (`ControlGuard`).
- **Header badge.** A "Desktop" badge appears in the run header, beside the bypass badge.

## 14. D44 invariants in desktop mode

| Invariant | How it holds in desktop mode | Verified by |
|---|---|---|
| Secrets never reach the model, logs or screenshots | By structure: no vault tools, no sessions loaded or sealed (§12.1). Telemetry carries no exec or `deskd` text (V12). The OCR scan stays as defence in depth. | P3 unit tests (profile has no credential tools; vault hooks return none for desktop); P4 secret-canary scan of telemetry, logs and step images |
| Vault fills only on the item's exact origin | Trivially: no fills. Browser mode is unchanged. | P3 contract test |
| Network policy (no private or SSRF ranges) and the sandbox stay on | Enforced outside the guest: nftables drops guest forwarding, and the proxy's private-range check is unconditional and has no switch. KVM is the sandbox. Bypass reaches neither. | P2 proxy unit tests; P4 security suite (guest tries private IPs, metadata, rebinding, raw IP, UDP, QUIC, IPv6) |
| Kill switch and takeover always work | The kill path ends in `recycle`, whose SIGKILL a guest cannot refuse. Takeover uses the agent-side `ControlGuard` on every `deskd` call, plus `freeze`. | P2 controller tests; P4 "VMM gone ≤ 1 s after kill" and takeover-freeze tests |
| D38 OpenAI data policy | Unchanged: the same wrapper. `shell` and `deskd` text going to the model is wrapped as untrusted, windowed and capped. | Existing D38 guard tests; P3 shell tool test |
| `malicious_instructions` pauses for a person | Unchanged: `decideSafetyChecks` runs first. | Existing tests |
| Bypass is explicit, warned and audited | Desktop mode adds its own acknowledgement and a `desktop_mode` audit row. Bypass + desktop needs both acknowledgements. | P3 DTO tests; web create-run int test |

## 15. Telemetry (D50)

All names are added once to `packages/contracts/src/telemetry.ts`.

| Kind | Name | Attributes |
|---|---|---|
| span (changed) | `mt.slot.reset` | adds `mt.slot.kind` (`browser`\|`desktop`) |
| span | `mt.vm.restore` | `mt.slot.name`, `mt.vm.restore_ms` |
| span | `mt.desk.action` | `mt.desk.method` (one of `DESK_METHODS`), `mt.desk.outcome` (`ok`\|`error`\|`timeout`), `mt.desk.bytes` |
| span | `mt.desk.exec` | `mt.desk.exit_code`, `mt.desk.output_bytes`, `mt.desk.timed_out`, `mt.desk.ms`. **Never** the command or output text. |
| span | `mt.egress.decision` | `mt.egress.decision` (`allowed_first`\|`denied`\|`private_blocked`), `mt.egress.site` (the registrable domain only, never the path or query), `mt.run.id` |

- **No new instruments.** Restore latency, screenshot latency and denial counts come from the collector's span metrics (`mt.span.duration`, `mt.span.calls`). `SPANMETRIC_DIMENSIONS` gains `mt.slot.kind`, `mt.desk.method`, `mt.desk.outcome` and `mt.egress.decision`. `mt.egress.site` is left out because its cardinality is unbounded.
- **Logs.** `desktop-host` logs with pino-compatible JSON lines to stdout: controller and proxy decisions, with no URLs beyond registrable domain. The guest serial console is forwarded as container logs with `source=guest_console` and passes through the collector's redaction pass (it is untrusted text).
- **Collector.** The collector-YAML pin test makes `infra/otel/collector.yaml` follow the new dimensions.

## 16. Migrations

The numbers are assigned at merge time (V14). Observer owns 0015, the notes plan takes 0016 and later, and each file is renamed and its journal entry regenerated with `pnpm --filter @mastertutor/db generate` on the merge branch.

**`00NN_desktop_slots` (P1)**

```sql
CREATE TYPE "public"."slot_kind" AS ENUM('browser', 'desktop');
ALTER TABLE "browser_slots" ADD COLUMN "kind" "slot_kind" DEFAULT 'browser' NOT NULL;
ALTER TABLE "browser_slots" DROP CONSTRAINT "browser_slots_name_valid";
ALTER TABLE "browser_slots" ADD CONSTRAINT "browser_slots_name_valid" CHECK ("name" ~ '^(browser|desktop)-[1-9][0-9]?$');
ALTER TABLE "browser_slots" ADD CONSTRAINT "browser_slots_kind_matches_name" CHECK (split_part("name", '-', 1) = "kind"::text);
CREATE TYPE "public"."run_environment" AS ENUM('browser', 'desktop');
ALTER TABLE "runs" ADD COLUMN "environment" "run_environment" DEFAULT 'browser' NOT NULL;
```

**`00NN_desktop_mode` (P3)**

```sql
ALTER TYPE "public"."tool_profile" ADD VALUE 'desktop_use';
ALTER TYPE "public"."approval_kind" ADD VALUE 'exec';
ALTER TYPE "public"."approval_kind" ADD VALUE 'file_export';
ALTER TYPE "public"."approval_kind" ADD VALUE 'desktop_mode';
ALTER TABLE "runs" ADD CONSTRAINT "runs_desktop_profile" CHECK (("environment" = 'desktop') = ("tool_profile" = 'desktop_use'));
```

The `CHECK` is in the second migration because the enum value must be committed before it is used.

## 17. UI

All of this follows D17, D21, D25 and D28 and the existing new-task and run-view patterns.

- **New task** (`apps/web/components/new-task/options-grid.tsx`, `draft.ts`):
  - An **Environment** segmented control: Browser | Desktop.
  - Choosing Desktop shows the `nt-risk` warning panel, with the same component as bypass, saying what it allows (runs programs, files) and what it never allows (no saved logins, no private network, reset after the run). It also shows the acknowledgement checkbox "I understand. Start this run in a desktop." The profile is forced to `desktop_use`.
  - The draft persists `environment` and `desktopAcknowledged`.
- **Run header** (`apps/web/components/run/run-header.tsx`): a "Desktop" badge.
- **Approval cards** (`apps/web/components/run/model/approval-copy.ts`, `approval/approval-sheet.tsx`):
  - `exec`: title "Run a command?", the command in a monospace untrusted block (`untrustedText`, ≤ 4000, in `<bdi>`), and `cwd`.
  - `file_export`: "Export a file from the desktop?" with the path.
  - Rule-2 `risky_click` labels show `"<app>: <name>"`.
- **Takeover**: the desktop warning (§12.3) in the takeover overlay.
- **QA.** The D22 swarm and D28 motion check cover the new states at every breakpoint, light and dark.

## 18. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit | contracts (`desk.ts`, tools, approval tables, DTO refinements), `net-policy` (moved tests unchanged), proxy decide and server (fake resolver, local upstreams), VMM client (fake API socket), controller state machine, desk framing and client, desktop executor rules, shell tool, file capture, pool (unchanged cases) | `packages/**`, `apps/desktop-host/src/**`, `apps/agent/src/**` (`*.test.ts`) |
| Integration | migration, `syncBrowserSlots` with kinds, claim per kind, create-run with `desktop_mode` row | `*.int.test.ts` |
| Behaviour | P1 parity: the existing behaviour suites with `BEHAVIOUR_SLOT_KIND=desktop`. P3: `deskd` contract and desktop actions against a real VM. | `tests/behaviour/`, `apps/**/*.behaviour.test.ts`, on the Dokploy host |
| Security | guest escapes: private ranges, metadata, rebinding, raw IP, UDP, QUIC, IPv6, the agent's ports from the guest, reset leftovers, clipboard, export without approval, kill timing | `tests/security/desktop-*.security.test.ts`, on the host |
| Shell verify | image contents, nftables ruleset, read-only root, capabilities | `apps/browser-slot/test/verify-desktop.sh` |
| UI | cards, picker, badge, QA swarm | `apps/web` UI tests, D22 |
| Benchmark | one study task: open a PDF and a PPTX, compute in Python, capture both files | `tests/bench`, P4 |

## 19. Phases, gates and effort

| Phase | Content | Exit gate | Effort (engineer-days) |
|---|---|---|---|
| **P0 Spike** | Read-only host checks. Firecracker in an unprivileged container. Guest from the slot image. Boot, snapshot and restore timing. n.eko through DNAT and the mux. CDP from the agent. The openbox vs Xfce trial. | `orchestration/runs/<date>-agent-vm-p0/report.md` says **go**. Every go criterion in plan Task P0.6 is met, and the user accepts it. | 4–6 |
| **P1 Browser parity** | Slot kinds, the migration, `SlotProvider`, claims per kind, the `packages/net-policy` move, the egress proxy (untainted), the guest/kernel/rootfs/desktop-slot targets, the controller and relay, `deskd` `hello`+`fileGet`, download pull, compose. | The existing behaviour suites pass against desktop slots (Chromium-only guest) on the host. | 12–16 |
| **P2 Boundary** | The egress control API and events, taint-driven scope, agent egress wiring (denials become `new_origin`), restore and egress spans, boundary security tests. | Boundary security tests pass. Parity suites still pass. | 3–6 |
| **P3 Desktop mode** | Contracts, migration 2, desktop packages, the full `deskd`, `DeskClient`, the desktop executor, `shell`, `capture{kind:file}`, approvals, taint, Guard triggers, telemetry, UI. | Unit, integration and behaviour tests pass. UI tests pass. | 15–20 |
| **P4 Security and QA** | The security suite, the D22 swarm, the benchmark study task, the runbook. | All suites pass on the host. The user reviews the results. | 8–10 |

**Total: 42–58 engineer-days.** The proxy moved into P1 so that parity is proven with the final network shape; there is no throwaway forwarding path. P2 can start once the controller exists. P3's UI tasks can run in parallel with P3's back end.

## 20. Host actions that need the user's approval

These all concern the shared `coursebite` host (D41, D45).

| # | Action | Phase | Kind |
|---|---|---|---|
| H1 | Read-only SSH checks:<br>• `uname -r`<br>• `ls -l /dev/kvm`<br>• `getent group kvm`<br>• `/sys/devices/system/cpu/vulnerabilities/*`<br>• `/sys/kernel/mm/ksm/run`<br>• `swapon --show`<br>• cgroup v2 swap accounting (`/sys/fs/cgroup/cgroup.controllers`)<br>• `df -h` for the Docker root<br>• `docker info` (version, cgroup driver) | P0 | Allowed by the brief. They change nothing. |
| H2 | Running containers with `/dev/kvm` and `/dev/net/tun` (remote-test, labelled `mastertutor.ci=1`) | P0, P1–P4 tests | A new privilege class on a shared host. Ask once before P0.2. |
| H3 | Only if `/dev/kvm` is not group-accessible: a udev or permission change | P0 | **Host change.** It needs explicit approval, or the result is no-go. |
| H4 | Prod compose changes, the `desktop` profile, the new 5910N ports with router forwarding (as in run 28), and the Dokploy deploy | after P4 | Manual, per D42 |
| H5 | SMT and KSM | never in this work | **Out of scope.** P0 records their state. The residual side-channel risk is written into the P0 report for the user to accept. |

There is **no** AppArmor change (desktop slots need no profile), **no** `daemon.json` change and **no** host package install.

## 21. Decisions

### Adopted (from the research, binding by the brief)

- Firecracker in an unprivileged Compose service, as in V1 and V2.
- The guest comes from the slot lineage, with one Dockerfile.
- `deskd` over vsock with a minimal interface.
- The snapshot is taken before n.eko, Chromium and `deskd`, and the reset is enforced on the host.
- Egress through nftables plus our own proxy outside the guest, with shared scope and range rules **moved** to `packages/net-policy`.
- `SlotProvider` formalises the existing seam, and `SlotPool`'s logic is unchanged.
- `runs.environment`, `desktop_use`, the `shell` tool and `capture{kind:"file"}`.

### Recommended defaults, each **pending user confirmation**

- **(a)** Desktop runs in v1 have no vault, no sealed sessions and no credential tools (§12.1). *Pending user confirmation.*
- **(b)** Add a typed `shell` tool, available only in `desktop_use`. It reverses the "no exec tool" comment (§10.3). *Pending user confirmation.*
- **(c)** Add the approval kinds `exec`, `file_export` and `desktop_mode`. Downloads into the VM keep needing approval in v1 (§11.1). *Pending user confirmation.*
- **(d)** Choose openbox (with tint2) or Xfce from the P0 trial (Task P0.5). *Pending user confirmation of the trial result.*

### Other choices this spec makes (for review)

- **(e)** The proxy allowlist switches on at taint. Before the first `shell` call or native-app action, egress matches today's browser slots. After it, egress is limited to the run scope, plus the sites already used, plus later approvals (§8.3). Without this, ordinary pages break, or guest code can reach anything.
- **(f)** `deskd` is written in Python (stdlib, plus Debian's `python3-xlib` and `pyatspi`) inside the guest. It is the second Python component after the docling sidecar (D8). The reason is AT-SPI's bindings.
- **(g)** The guest overlay's upper directory lives in guest RAM, not in a host-side copy-on-write disk file. That removes a per-reset file copy, and the data is discarded with the VM.
- **(h)** `desktop_mode` is recorded as an already-approved approvals row, not as an approval the loop asks for.
- **(i)** The egress proxy ships in P1, with the run untainted, so the P1 parity gate runs on the final network shape.

## 22. Risks

| Risk | Mitigation |
|---|---|
| vsock listeners do not survive a restore | P0 checks this. The fallback is for `vm-init` to dial host vsock 1026 for its `start` line. |
| The snapshot memory file plus guest RAM exceeds `mem_limit` | P0 measures peak cgroup memory. `mem_limit` is set to the measured peak plus 25%. |
| Domain fronting through an allowed CDN, after taint | Accepted residual risk. The proxy enforces the host and the checked IP. With no secrets in the VM, the impact is limited to public material. |
| Guest kernel exploit, or a side channel with SMT on | KVM is the boundary. The container adds a second layer. SMT and KSM state is recorded, and the user accepts or declines the residual risk (H5). |
| Image size (3–4 GB per tag) on a host with limited disk | P0 measures it. Builds use the label-scoped cleanup (D45). |
| Restore is slower than the container restart it replaces | The P0 go criterion is a reset p95 of ≤ 5 s to a new CDP browser id. |
| Guest code reads its own slot's n.eko member passwords (they reach the guest in the start line, derived per slot as today) | n.eko's port 8080 admits only the agent, web and Traefik (nftables), and the public `/live` route sits behind ForwardAuth and the live cookie. A leaked password opens nothing new. Per-lease n.eko passwords are a later hardening option. |
| Opening each page fetches a CDP page screenshot as well as the desktop one in `desktop_use` | Accepted for v1 (measure first, principle 2). The P3 gate report records observe latency, and an optimisation is planned only if it matters. |
