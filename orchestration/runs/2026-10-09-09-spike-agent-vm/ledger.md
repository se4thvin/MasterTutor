# P0 ledger — plan: docs/superpowers/plans/2026-10-09-agent-vm.md

Base: 81d7a7f6; existing isolated worktree, branch vm-p0-spike, initially clean.

Preflight: P0 has no production interface or migration changes. Dependencies are sequential: host → boot → guest/reset → ingress/stream → WM → verdict. Review Focus concerns later production tasks; no production boundary is claimed by this spike.

Ruling: D55 already grants H2; do not ask again. Cost if wrong: device access outside authorization; the current user request expressly grants it.

Ruling: use mt-vm-p0 labels exclusively for cleanup, rather than broad mastertutor.ci pruning. The narrower current instruction protects concurrent MasterTutor test runs. Cost if wrong: isolated resources could remain; verify after cleanup.

Ruling: use the existing remote CI image with a dedicated synced directory and named runner; exclude all .env* files. The stock runner includes two env files and creates resources without mt-vm-p0 labels. No application package is touched, so DB integration is inapplicable. Repository units run as an extra regression check. Cost if wrong: differences from the standard harness; disclose them.

P0.1: host checks executed, KVM_GID=994, mode 660; cgroup2fs with memory controller. SMT on, KSM 0, unchanged. Typecheck/lint passed twice. First extra repository-unit run: 2310 pass, 8 fail, 2 skipped. Retried with 16 runner CPUs / 8 workers: 2313 pass, 5 fail, 2 skipped; all three timeouts resolved without assertion/timeout changes. Four failures are absent .env* reads (no such files were transferred or read); remaining failure is the pre-existing Observer guard missing from the security inventory. No application package was changed. No DB integration applies.

Ruling: continue the spike with the unrelated inventory failure recorded; do not change production security inventory during P0. Cost if wrong: baseline regression remains visible; report never claims all repository units pass.

Ruling: Vitest project config overrides CLI excludes here; use a negative test-name filter for the three env-reading regression suites in subsequent checks. Cost if wrong: env reads fail on absent files; all .env* remain excluded from sync.

P0.1 commit: 67b9df8d.

P0.2: measurement helper tests missing-module RED → 3/3 GREEN; added real Unix HTTP test exposed an incomplete test-server body read, then 4/4 GREEN. Firecracker v1.17.0 archive SHA verified against GitHub's release digest. Ten quickstart boots: p50 2204.441656 ms, p95 2385.503070 ms. UID 10001, VMM CapEff 0 / Seccomp 2, init capabilities exactly 0x10c0; swap.max 0. Read-only, nonprivileged container with exact devices and resource limits. No ports. Boot container removed by both spike and run labels; image retained for dependent spike builds, removed at final cleanup.

P0.2 repository checks: typecheck/lint pass. Harness quote bug fixed by passing the container script through a quoted heredoc (no host installs were attempted). Final extra unit run: 2310 pass, 1 existing inventory failure, 9 skipped (2 existing, 7 selected out by the env-reading suite-name filter). No caused failure remains. No DB package touched. A scripts/remote-test.sh modification appeared from outside this work; it is neither changed nor staged by this spike.

Ruling: prepare the current CI squashfs in a build stage with ext4 tooling, rather than running host unsquashfs/mkfs or generating SSH credentials. Lock guest password fields and remove upstream SSH directories. Cost if wrong: quickstart differs from writable upstream image; it reached login on the read-only drive all ten times.

P0.2 commit: 305975ac.

P0.3: built Linux 6.1.188 from kernel.org, source SHA ed4d0acb1307c235230c89efc094e210e6290593f94a7e617f28b1001101a33a; pinned Firecracker CI config SHA 153ca1b40f3312bfb40b7587b471ea548a915f98f480f0d0892a1537957a2147. Vmlinux SHA 83d341b7c611ca3794ef98cd80acc63a758d3dafd63e5ab801ebc9e36057a77b. Both parser tests and public identity test missing-code RED → 3/3 GREEN on coursebite. Rootfs is built from the actual browser-slot Dockerfile lineage, 1809842176 bytes.

Ruling: use container build stages for rootfs tools and labelled export containers to obtain artifacts, rather than host mkfs/tar installs. This also follows spec §6.1's rootfs build direction. Cost if wrong: image-build/export overhead during the spike; runtime is identical read-only ext4.

Ruling: mount /proc before umount /.oldroot. The plan's exact order caused PID 1 to exit (umount could not resolve the old-root mount), then a kernel panic; real VM bootstrap RED → GREEN after swapping those operations. Cost if wrong: boot ordering must be rechecked on future guest changes; no host setting was changed.

Ruling: bind the vsock start listener before reporting golden. Otherwise the plan snapshots before the listener exists and cannot test listener survival. Cost if wrong: notification ordering changes, but 30/30 restores accepted through the existing listener.

Ruling: copy only explicitly allowlisted static n.eko settings from inherited image ENV into a non-secret shell settings file. Filesystem exports discard Docker ENV. Guest session settings remain in memory; no guest.env credential file is written. Pulse/n.eko/Chromium start after golden, per the spec, rather than the inconsistent P0 step that mentions pre-snapshot Pulse. Cost if wrong: omitted static setting changes stream behavior; P0.4 probes the resulting stream.

P0.3 measured (30/30): resumed p50 6.606472 ms / p95 15.651914 ms; fresh CDP p50 3001.143156 ms / p95 3179.423370 ms; cgroup memory.peak 5009731584 bytes; 30 unique boot_id, 30 unique urandom samples; leftover absent every time; clock max error 1 s. UID fc capabilities remain zero and Seccomp 2. Start transport listen51; no fallback needed. All restore containers removed by labels. Typecheck/lint pass; extra repository units 2310 pass / 1 existing inventory failure / 9 skipped; guest helper units 3/3 pass. No DB package touched.

Ruling: boot_id is different in this snapshot because its first read is after restore; do not infer that VMGenID changes an already-initialized Linux boot_id. Cost if wrong: later pre-golden services could change this observed property; repeat the measurement when the snapshot point changes.

Migrations checked by filename only: 0015 Observer, 0016 remove_model_blocks, 0017 guard_shadow_default, 0018 guard_checkpoint are occupied. No P0 migration is needed; P1 must determine the next free number again (currently 0019) after its gate is accepted.

P0.3 commit: 609455ba.

P0.4: DNAT rules and isolated spike Traefik installed inside labelled containers only; guest egress is default-DROP. Actual probeSlot imported unchanged from a separate cdp-network container: Chrome/154.0.8037.57, protocol 1.3. G7 passes. Neko never reached HTTP readiness: startup pipeline permission error; five retries on the final diagnostic image, with Chromium/Pulse alive. G8 fails; G9 has no valid stream measurement. Fixed diagnostics expose counts/categories only; a file-access trace found zero EACCES file paths. Public-source CDP diagnostic unavailable. Do not infer a host change is necessary from this unresolved failure.

Ruling: preserve NEKO_SERVER_BIND and PULSE_SERVER in the static, nonsecret ENV allowlist. Filesystem export loses image ENV; the previous allowlist omitted both. Pulse's actual Unix endpoint is /tmp/pulseaudio.socket (anonymous guest-local protocol). Cost if wrong: settings drift; source values are copied from the actual lineage, not duplicated production constants. Rootfs ownership was separately checked and is correct (home uid/gid 1000, mode 0700); no ownership change made.

Ruling: Docker internal bridges on this host produce null published ports. A regular, separately named bridge with namespace nft default-DROP retains loopback publications and denies new guest egress. Cost if wrong: bridge peers could send traffic; only the dedicated spike services and probes attach. Full production allowlists/Better Auth are not validated by P0; the focused fixture uses memory-only Neko login and ForwardAuth.

P0.4 initial parser RED was run locally (deviation from D48); final five helper checks and repository checks run on coursebite. No env files were read or transferred. All Docker mutations/removals are scoped to the mt-vm-p0 labels. The WM trial remains required even with G8/G9 currently unmet; the final gate cannot be go without passing measurements.

P0.4 final verification: typecheck/lint pass; extra repository units 2310 pass / 1 existing security-inventory failure / 9 skipped. Guest helper units 5/5 pass remotely. No DB package touched; DB integration inapplicable. Network containers/network removed by mt-vm-p0 + run labels. Diagnostic tracing is opt-in via public P0_TRACE=1; ordinary startup has no tracer.

P0.4 commit: 8dc591be.

P0.5: model trial completed all 48 cases, gpt-6-astra / createOpenAI / computer tool only. Openbox+tint2 16/24 (66.67%), median 2 executed actions, $2.1954655; Xfce 22/24 (91.67%), median 2 actions, $1.6848625. Total $3.880328, below the $10 cap. Decision (d): Xfce. No credential, screenshot, model response or transcript written. Only public grades/counts/USD emitted. Two setup failures before the paid run cost zero. Model key selected in memory from the running local mastertutor-bench agent's Docker Env, handed through SSH/stdin to a dedicated remote container, never stored in Docker Env metadata or a file.

Ruling: use a fixed, bounded vsock-52 desktop RPC rather than docker exec inside the container (which cannot execute guest processes). Host wrapper imports the existing computer action parser; the guest rejects arbitrary text, terminal input, system shortcuts and actions outside screen bounds. Cost if wrong: a fixture-specific interface differs from future deskd; no production service is claimed by this spike.

Ruling: install both WMs and the named applications in the guest container build. Preserve the PDF and Apache POI PPTX byte-for-byte. Generate an Openbox menu for the same applications available to Xfce, and alternate WM order across repetitions. Grade the PDF with Evince plus its fixture title, and the PPTX with Impress plus its fixture title. Cost if wrong: these fixture-specific choices and an eight-provider-turn limit constrain the trial; both WMs use identical constraints, and failures are retained.

P0.5 expanded-rootfs reset revalidation before the Xorg-user experiment: 30/30; load→resumed p95 25.248842 ms; fresh CDP p95 3107.523297 ms; peak 4988878848 bytes; boot_id/urandom unique 30/30; leftovers absent; clock error at most 1 s; listen51 survives; VMM CapEff 0 / Seccomp 2. This golden starts Openbox; Xfce trial sessions start after restore. A future selected-Xfce golden must be measured independently before relying on these figures.

Ruling: budget reserves a conservative screenshot/text/output charge before each request, persists only that numeric charge, settles against validated usage, and retains an ambiguous reservation with no API retry. A post-trial repository sync removed generated artifacts and the remote numeric ledger; no additional API request followed. Restore the ledger from the completed trial's public total and explicitly exclude it and guest artifacts from future rsync deletion. Cost if wrong: repeated trials could undercount prior spend; preserve the ledger and never reset it to zero.

P0.5 targeted strict TypeScript verification exposed unsafe Window casts in the P0.4 viewer, outside root tsconfig coverage. Replace them with a Window declaration; strict spike compile passes. Helper suites: FC 4, guest 5, action guards 2, Node key/budget 3 pass. The first combined Python invocation lacked the fc helper on PYTHONPATH; corrected harness, no assertion changed.

P0.5 final stream investigation: the lineage runs Xorg as neko; the spike initially ran it as root. Try restoring the lineage user, without host changes. Three Docker Hub auth failures (500/504) blocked a full rootfs rebuild. Use existing CI-image debugfs to patch only our disposable rootfs's vm-init; the normal source Dockerfile remains the reproducible full build. Restrict opt-in strace to file syscalls, excluding network payload tracing. No host install, sudo or global setting changed.

P0.5 stream correction: Xorg as neko made Neko login ready. The first offline patch used /sbin, a symlink debugfs does not follow, and failed; re-exported the pristine artifact, patched /usr/sbin/vm-init, and verified its exact bytes with cmp before runtime build. Corrected rootfs SHA 9805244c5650026471ec3f09ca508afae9583d8c578ac65dcddae5ccbc8094c9, size 2392850432 bytes. The normal full rootfs source starts Xorg as neko and includes the same init. No permission or ownership change on the host.

P0.5 final corrected-image 30/30 reset: resume p50 7.205490 ms / p95 36.373487 ms; CDP p50 3322.490004 ms / p95 4099.635437 ms; reset memory.peak 5017686016 bytes. Thirty distinct boot_id, urandom and Chromium ids, every leftover absent, clock error at most 1 s, listen51. This remains the plan's Openbox golden; the Xfce trial is a post-restore session comparison.

Ruling: import liveEmbedPath from contracts for the viewer. The plan's bare /live/<uuid>/ path opens the client login UI rather than the auto-authenticated embed; its 30-second video wait correctly failed. The existing embed query contains fixed public placeholders, not credentials. Cost if wrong: client setup differs; the corrected path matches the production helper exactly and keeps auth in ForwardAuth memory.

P0.5 final stream: TCP selected, 62.107973 s scrolling guest-loopback fixture; decoded 25.000934 fps, all 12 client fps samples 25; CPU 1.188828 cores average. Four docker stats CPU samples 120.14%, 122.59%, 114.74%, 126.92%. Live memory.peak 5184319488 bytes; swap.max 0; VMM UID 10001 / CapEff 0 / Seccomp 2 / NoNewPrivs 1. Exact 10g=swap, 4 CPUs, 256 PIDs, two devices, three initial caps, read-only root, loopback-only ports confirmed. G8/G9 now pass; all twelve criteria measured pass for the Openbox golden. Before relying on a pre-golden Xfce session, P1 must repeat the snapshot/identity/stream checks; boot_id's lazy initialization remains a material limitation.
