---
run_id: 2026-10-09-09-spike-agent-vm
date: 2026-10-09
agent_type: primary-executor
phase: spike
status: completed
verdict: go
depends_on: [2026-10-09-06-research-agent-vm]
---

# D53c P0 spike report

**GO for the measured P0 configuration.** All G1–G12 pass on coursebite under the exact container limits, without host changes. The golden snapshot uses Openbox; the separate 48-case desktop trial selects Xfce. Its pre-golden configuration must be revalidated before relying on these measurements. **P1 has not started and requires the user's acceptance of this report.**

## Pins

| Pin | Value |
|---|---|
| FIRECRACKER_VERSION | `v1.17.0` |
| FIRECRACKER_SHA256 | Release archive: `06094a1108ae9e82aa4c23a775aa92758f53f1175d422270d9d6162cb9ade558` |
| KERNEL_VERSION | `6.1.188`, built with VMGenID, virtio-vsock, overlayfs and tmpfs |
| KERNEL_SHA256 | Vmlinux: `83d341b7c611ca3794ef98cd80acc63a758d3dafd63e5ab801ebc9e36057a77b` |
| Kernel source SHA256 | `ed4d0acb1307c235230c89efc094e210e6290593f94a7e617f28b1001101a33a` |
| Firecracker CI kernel-config SHA256 | `153ca1b40f3312bfb40b7587b471ea548a915f98f480f0d0892a1537957a2147` |
| KVM_GID | `994` |
| Guest WM | Measured golden: `openbox`; decision (d), selected for subsequent work: `xfce` |
| Vsock start transport | `listen 51`; listener bound before golden and survives every restore; no dial-1026 fallback |
| Final measured rootfs | `2392850432` bytes, SHA256 `9805244c5650026471ec3f09ca508afae9583d8c578ac65dcddae5ccbc8094c9` |
| Browser-slot lineage | Actual `apps/browser-slot/Dockerfile`; Neko v3.1.6 / commit `65fba485de2987998c7028b04240b21669d674e0`, repository Pion ICE v4.2.2 TCP-mux patch |
| Neko base-image digest | `sha256:2471119c7b4010067f76f3421a78a8bcf35e3c223b2d1f4db084914ec915fb30` |
| Ingress probe | `Chrome/154.0.8037.57`, CDP protocol `1.3` |

The final artifact was exported from the built slot-lineage rootfs and patched offline with the final `vm-init`, using the existing CI image's `debugfs`, because Docker Hub returned three auth-service 500/504 errors. The patch targets `/usr/sbin/vm-init` and verifies exact bytes with `cmp`. The source Dockerfile contains the same init for a normal full rebuild. Ext4 build timestamps make its SHA an artifact pin, not a reproducible-build guarantee. [Patch evidence](../../../spikes/agent-vm/out/p0-5-x-user-offline-fixed.txt).

## Go criteria

Final reset sample: **30 consecutive full snapshot loads**, 2 vCPUs / 4096 MiB / CID 3, read-only ext4 plus a fresh tmpfs overlay. Percentiles use nearest rank. Stream sample: 62.108 seconds scrolling the long fixture served on guest loopback. No threshold, assertion, timeout or API retry was loosened.

| # | Criterion | Threshold | Measured | Pass |
|---|---|---|---|---|
| G1 | Exact restricted Firecracker container | Two devices; initial NET_ADMIN, SETUID, SETGID only; read-only root | `/dev/kvm`, `/dev/net/tun`; cap-drop ALL, those three caps; nonprivileged, init, NNP; 10 GiB memory=memswap, 4 CPUs, 256 PIDs; group 994 | Yes |
| G2 | VMM capabilities / seccomp | CapEff 0; Seccomp 2 | UID 10001, CapEff `0000000000000000`, Seccomp `2`, NoNewPrivs `1`; reset and live samples | Yes |
| G3 | Container swap allowance | `memory.swap.max = 0` | `0` | Yes |
| G4 | Load→resumed p95 | ≤500 ms | **36.373487 ms**; p50 7.205490 ms | Yes |
| G5 | Load→fresh CDP ID p95 | ≤5000 ms | **4099.635437 ms**; p50 3322.490004 ms; 30 distinct IDs | Yes |
| G6 | Peak container memory | ≤9 GiB | **5184319488 bytes / 4.828 GiB** live peak; reset peak 5017686016 bytes / 4.673 GiB | Yes |
| G7 | Existing probeSlot from CDP network | OK | Imported unchanged; separate bridge-peer probe returned Chrome and protocol 1.3 | Yes |
| G8 | Live video through TCP mux behind DNAT | OK | 1280-wide decoded video; selected remote ICE protocol `tcp`, `tcp_mux: true`, behind dedicated Traefik ForwardAuth and DNAT to guest | Yes |
| G9 | Sustained stream FPS / container CPU | ≥25 FPS at ≤1.5 CPUs | **25.000934 FPS / 1.188828 CPUs** over 62.108 s; every client FPS sample 25; docker stats 120.14%, 122.59%, 114.74%, 126.92% | Yes |
| G10 | Restored boot ID and randomness differ | Unique across restores | 30/30 distinct boot_id and 16-byte urandom samples; see qualification below | Yes, measured snapshot |
| G11 | Run-one file absent after recycle | Always absent | `/home/neko/leftover` absent at every run's start, then written again in its overlay | Yes |
| G12 | Rootfs size | ≤4 GiB | **2.228515625 GiB**, both WMs and required applications installed | Yes |

Evidence: [final reset](../../../spikes/agent-vm/out/p0-5-final-x-restore.txt), [stream and unchanged probeSlot](../../../spikes/agent-vm/out/p0-5-final-stream-embed.txt), [docker stats](../../../spikes/agent-vm/out/p0-5-stream-docker-stats.txt), [exact final runtime](../../../spikes/agent-vm/out/p0-5-final-runtime.txt). Clock correction error was at most one second across all restores.

**G10 qualification:** Linux boot_id is initialized lazily. This snapshot first reads it after restore; the result does not prove VMGenID replaces an already-initialized boot_id. A service that reads boot_id before golden can invalidate this result. VMGenID randomness reseeding and a fresh application/session identity are separate concerns. Repeat G10 when changing any pre-golden service, especially adding the selected Xfce session. Do not manufacture a replacement ID and report it as the kernel boot_id.

## Host facts (H1) and residual risks

[Read-only host evidence](../../../spikes/agent-vm/out/host-check.txt): kernel `6.8.0-142-generic`; `/dev/kvm` root:kvm mode 0660, GID 994; `/dev/net/tun` mode 0666; cgroup v2 with memory controller; Docker 29.2.1, systemd driver, Docker root `/mnt/raid0dev/docker`. At preflight: 503 GiB RAM, 484 GiB available; 8 GiB host swap unused; Docker disk 1.8 TiB, 1.3 TiB available.

SMT was **on**, KSM was **0**. Vulnerability files report SMT exposure for L1TF, MDS, MMIO stale data and TSX asynchronous abort, among the recorded mitigations. Neither setting was changed. These remain shared-host risks; passing this functional spike is not a side-channel isolation proof. No host install, sudo, device-permission change, daemon.json/AppArmor change or other tenant/Dokploy/host-Traefik mutation occurred. The spike used its own labelled Traefik container, and every published port bound 127.0.0.1.

## WM trial (decision d)

`gpt-6-astra`, low reasoning effort, the existing D38 `createOpenAI` wrapper, computer tool only; three repetitions of each of eight tasks for each WM. The order alternated between repetitions. Both ran in the same guest with the same fixtures, graders and eight-provider-turn limit; “steps” counts executed computer actions, so a case can exceed eight actions. Median includes failed cases.

| WM | Successful / total | Success rate | Median steps | USD |
|---|---|---|---|---|
| Openbox + tint2 | 16 / 24 | 66.67% | 2 | $2.1954655 |
| Xfce | 22 / 24 | 91.67% | 2 | $1.6848625 |
| Total | 38 / 48 | — | — | **$3.880328 / $10 cap** |

| Task | Openbox successes /3 | Xfce successes /3 |
|---|---|---|
| Open sample PDF through file manager | 2 | 3 |
| Open terminal without entering anything | 0 | 3 |
| Open Writer from applications menu | 2 | 2 |
| Switch to Chromium | 3 | 2 |
| Maximize PDF viewer | 3 | 3 |
| Close dialog | 3 | 3 |
| Open PPTX in Impress | 2 | 3 |
| Find/open text editor | 1 | 3 |

**Select Xfce.** No tie breaker was needed. Failures retained: Openbox had two model stops, five turn-limit failures and one rejected call; Xfce had two model stops. Two earlier setup attempts failed before API use and cost $0. This is a small fixture trial, not a general desktop-success estimate. The PDF grader specifically requires Evince and its fixture title; Impress also requires its fixture title. No grader was relaxed during the matrix. Screenshots came from guest `xwd`, converted in memory; the copied PDF and Apache POI PPTX were not authored or rewritten by the model. [All public case rows](../../../spikes/agent-vm/out/p0-5-model.jsonl), [fixtures and cost-bound sources](../../../spikes/agent-vm/wm-trial/FIXTURES.md).

The API key was read only at runtime, in memory, from the running local `mastertutor-bench-agent-1` Docker Env after checking running state and bench/service labels. SSH/stdin handed it directly to a dedicated remote model container; it was never placed in argv, Docker Env metadata, a file, telemetry or output. API requests used store:false and in-memory stateless replay. No screenshot, request/response body or model transcript was persisted. Public result rows contain only grades, steps, reasons and cost. Pre-send conservative reservations and validated-usage settlement enforced the cap; ambiguous paid requests would stop without retry. The model container exited and was automatically removed.

## Tasks, commits and verification

| Task | Commit | Result and verification |
|---|---|---|
| P0.1 host checks | `67b9df8d5a8a14254448ef9764a101203f96882b` | Read-only checks complete. Typecheck/lint pass. Initial extra units had three timing failures, resolved by a 16-CPU runner / eight workers without changing tests; final initial run 2313 passed / 5 failed / 2 skipped: four absent-env-file failures and the existing inventory failure. |
| P0.2 exact-container boot | `305975ac85603d7d2864d051e9a4398b88360dd9` | Ten successful quickstart boots, p95 2385.503070 ms. FC helper RED→GREEN, 4 tests. Typecheck/lint pass; repository units 2310 passed / 1 existing failure / 9 skipped. |
| P0.3 slot-lineage guest/reset | `609455ba2187bd9d5bffee9e2a472e153f86c939` | Initial 30 restores passed; guest parser/identity RED→GREEN. Typecheck/lint pass; repository units 2310 / 1 / 9. |
| P0.4 DNAT/CDP/live probe | `8dc591be13db25edd2c879d29104a3b0a0528acb` | CDP passed; Neko pipeline permission error left G8/G9 unmet at this commit. Final five guest helper tests pass remotely. Typecheck/lint pass; repository units 2310 / 1 / 9. Stream correction is in P0.5. |
| P0.5 WM trial/final measurements | `27f0cae1d930a597def593a897dc8a0d26164a99` | 48 cases complete under cap; corrected image reset and stream pass. Typecheck/lint and strict spike TS compile pass; 4 FC + 5 guest + 2 action-guard + 3 Node key/budget tests pass; shell syntax checks pass. Repository units 2310 / 1 / 9. |
| P0.6 report/cleanup | Commit containing this report; resolve as below | Typecheck/lint/strict spike TS and 14 helper tests pass; repository units 2310 / 1 existing failure / 9 skipped. Final labelled resource counts all zero. Exact SHA supplied in the completion message. |

Resolve the immutable P0.6 commit after delivery with `git log -1 --format=%H -- orchestration/runs/2026-10-09-09-spike-agent-vm/report.md`. A report cannot contain its own eventual Git hash without changing that hash.

Check logs: [P0.1](../../../spikes/agent-vm/out/p0-1-checks.txt), [P0.2](../../../spikes/agent-vm/out/p0-2-checks.txt), [P0.3](../../../spikes/agent-vm/out/p0-3-checks.txt), [P0.4](../../../spikes/agent-vm/out/p0-4-checks.txt), [P0.5](../../../spikes/agent-vm/out/p0-5-checks.txt), [P0.6](../../../spikes/agent-vm/out/p0-6-checks.txt).

The persistent repository failure is `tests/security/inventory.test.ts`: the already-merged `apps/agent/src/guardrails/observer/guard.security.test.ts` is missing from `INVENTORY`. It predates P0 and was left for its owner. Subsequent runs select out seven cases from the three suites that open `.env*` directly or through Playwright config; the other two skips are existing. No env-file content was read or transferred. No application/DB package, schema, migration or drizzle meta changed, so DB integration tests do not apply to touched packages. All caused implementation/test-harness failures were corrected; retained RED logs are evidence, not unresolved failures. Fresh Opus review could not run: D40 requires Opus, and available subagent tools offer no Opus. The primary executor performed the review; there is no claim of independent review.

## Deviations P1 must apply

1. **P1.12 bootstrap:** mount `/proc` before lazily unmounting `/.oldroot`. The plan's opposite order caused a real PID-1 exit/kernel panic. Bind the vsock-51 listener before announcing golden; otherwise it is absent from the snapshot. Start Xorg as `neko`, matching the lineage; root-X caused the Neko pipeline permission error. Keep the VMM at UID 10001 with CapEff 0 and group 994. Do not add a setpriv bounding-set operation that requires dropped SETPCAP.
2. **P1.12/P1.13 guest build:** export the actual browser-slot lineage using container build stages and labelled export containers. Preserve only explicitly allowlisted nonsecret image ENV in the exported filesystem, including `NEKO_SERVER_BIND` and `PULSE_SERVER`; the actual Pulse Unix endpoint is `/tmp/pulseaudio.socket`. Docker ENV is otherwise lost. Pulse/Neko/Chromium start after golden, following the spec rather than the conflicting P0 prose. Never create credential-bearing guest.env or SSH keys.
3. **P1.12/P1.17 selected WM:** trial WMs were switched after restoring the Openbox golden. Before deploying a pre-golden Xfce session, repeat G4–G6 and G8–G11, especially cached boot_id and session state. Retain the measured Openbox configuration until that check passes; these Openbox results do not certify an Xfce golden.
4. **P1.13/P1.16 ingress:** an `internal:true` bridge on this host produced null published-port bindings. P0 used a separate regular bridge, namespace nft default-DROP egress and loopback-only mux/Traefik publications. The spike's ForwardAuth is a fixed-session memory-only fixture; production Better Auth, IP allowlists, proxy policy and multi-slot routing still need P1 parity/security tests. Reuse `liveEmbedPath`; the bare path does not automatically start the embed. No production auth parity is claimed here.
5. **P0 harness / P1 tests:** Docker exec in the slot container cannot execute programs inside its guest. The spike instead uses bounded fixed vsock-52 methods, validates computer actions using existing shared parsing, and disallows arbitrary text/terminal commands/system shortcuts. Screenshots and graders run inside the guest. Use the planned deskd contract and trust-boundary tests for production. D48 deviation: the initial P0.4 parser RED was accidentally local; final helpers and all heavy verification ran on coursebite. The standard remote harness was replaced with a labelled equivalent that excludes all `.env*` files and preserves generated artifacts and the numeric spend ledger.
6. **Migrations:** 0015 Observer and 0016 remove_model_blocks are occupied, as are 0017 guard_shadow_default and 0018 guard_checkpoint. P0 needs none. At P1 merge time, recheck the next free number (currently 0019) and regenerate drizzle journal/snapshot together.

## Cleanup and remaining work

Cleanup is restricted to `mt-vm-p0=1` labels for containers, networks, volumes and images. **Final counts: 0 containers, 0 networks, 0 volumes, 0 images.** [Cleanup evidence](../../../spikes/agent-vm/out/p0-6-cleanup.txt), [final resource census](../../../spikes/agent-vm/out/p0-6-resources.txt). The existing CI runner image is reused, not removed. Label-less BuildKit cache is not broadly pruned. The prefixed remote checkout and downloaded/generated public guest artifacts remain as ordinary files; no credentials were written there. The unrelated external modification to `scripts/remote-test.sh` remains unstaged and unchanged by this work.

No P1+ implementation, production deployment, push or merge occurred. No host change is needed for this tested configuration. Production isolation, egress proxy, vault restrictions, deskd, parity, independent review and the selected-Xfce golden remain future gated work.

## Verdict

**go**, scoped to the measured P0 configuration and the qualifications above. G1–G12 all pass. The earlier Neko failure was resolved inside the guest; host permission/settings changes are unnecessary. If later revalidation fails a criterion, stop and present a no-go; the research alternatives are Cloud Hypervisor or QEMU for the user to decide on. This report does not begin those alternatives or P1. **Stop here until the user accepts this report.**
