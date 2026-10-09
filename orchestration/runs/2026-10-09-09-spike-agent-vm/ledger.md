# P0 ledger — plan: docs/superpowers/plans/2026-10-09-agent-vm.md

Base: 81d7a7f6; existing isolated worktree, branch vm-p0-spike, initially clean.

Preflight: P0 has no production interface or migration changes. Dependencies are sequential: host → boot → guest/reset → ingress/stream → WM → verdict. Review Focus concerns later production tasks; no production boundary is claimed by this spike.

Ruling: D55 already grants H2; do not ask again. Cost if wrong: device access outside authorization; the current user request expressly grants it.

Ruling: use mt-vm-p0 labels exclusively for cleanup, rather than broad mastertutor.ci pruning. The narrower current instruction protects concurrent MasterTutor test runs. Cost if wrong: isolated resources could remain; verify after cleanup.

Ruling: use the existing remote CI image with a dedicated synced directory and named runner; exclude all .env* files. The stock runner includes two env files and creates resources without mt-vm-p0 labels. No application package is touched, so DB integration is inapplicable. Repository units run as an extra regression check. Cost if wrong: differences from the standard harness; disclose them.

P0.1: host checks executed, KVM_GID=994, mode 660; cgroup2fs with memory controller. SMT on, KSM 0, unchanged. Typecheck/lint passed twice. First extra repository-unit run: 2310 pass, 8 fail, 2 skipped. Retried with 16 runner CPUs / 8 workers: 2313 pass, 5 fail, 2 skipped; all three timeouts resolved without assertion/timeout changes. Four failures are absent .env* reads (no such files were transferred or read); remaining failure is the pre-existing Observer guard missing from the security inventory. No application package was changed. No DB integration applies.

Ruling: continue the spike with the unrelated inventory failure recorded; do not change production security inventory during P0. Cost if wrong: baseline regression remains visible; report never claims all repository units pass.

Ruling: Vitest project config overrides CLI excludes here; use a negative test-name filter for the three env-reading regression suites in subsequent checks. Cost if wrong: env reads fail on absent files; all .env* remain excluded from sync.
