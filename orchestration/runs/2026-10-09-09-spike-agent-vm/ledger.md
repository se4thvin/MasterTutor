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
