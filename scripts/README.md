# scripts

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `remote-test.sh`       | Runs a test suite on the shared CI host instead of this machine (below). |
| `check-agent-image.sh` | Proves the production agent image carries no test code.                  |
| `compose-smoke.sh`     | Boots the full stack with the test overlay and smoke-tests it.           |
| `env-init.ts`          | Writes a fresh `.env` with generated secrets.                            |
| `scan-test-code.ts`    | The scanner `check-agent-image.sh` runs inside the image.                |
| `e2e.sh`               | Boots the E2E stack and runs the Playwright stack suite in it.           |
| `lib/test-stack.sh`    | The test stack's Compose command and the laptop stack lock (sourced).    |
| `qa-stack.sh`          | The Phase 8 QA stack: up, wiring, shoot, ui, down (below).               |

## Remote test runner

Heavy suites overload a laptop. `scripts/remote-test.sh` runs them on the Dokploy host instead
(SSH alias `coursebite-build`), from any worktree:

```sh
scripts/remote-test.sh unit
scripts/remote-test.sh integration apps/agent/src/vault/fill.int.test.ts   # vitest args pass through
scripts/remote-test.sh security
scripts/remote-test.sh web-build      # next build + check:bundle
scripts/remote-test.sh agent-image    # scripts/check-agent-image.sh
scripts/remote-test.sh behaviour      # refused until the AppArmor profile is loaded (infra/host/apparmor/)
scripts/remote-test.sh e2e            # full-stack Playwright suite (scripts/e2e.sh); results in apps/web/e2e/.out/
scripts/remote-test.sh e2e stack/specs/api-conformance   # Playwright args pass through
scripts/remote-test.sh smoke          # scripts/compose-smoke.sh against the two-slot test stack, then the
                                      # Dokploy-format backup/restore drill (scripts/deploy/restore-drill.sh)
scripts/remote-test.sh qa             # Phase 8 QA stack (scripts/qa-stack.sh): stays up; results come back
scripts/remote-test.sh qa --down      # removes the QA stack and frees the stack lock
scripts/remote-test.sh bench-mock     # Phase 10 harness self-test (scripts/bench-mock.sh; `pnpm bench:mock`)
```

### The QA suite (Phase 8)

```sh
scripts/remote-test.sh qa up                     # fresh seeded QA stack (no agent, no slots)
scripts/remote-test.sh qa wiring [--grep "G3 "]  # real-stack wiring smoke
pnpm qa:shoot --group G3 --run <run-id>          # one group's shots, filed under the run (Task 9)
scripts/remote-test.sh qa ui [playwright args]   # fe's fixture suite + visual baselines, on Linux
scripts/remote-test.sh qa --down                 # always: e2e and other full-stack suites wait on the lock
```

To open the QA stack in a browser on the Mac: `ssh -N -L 18080:127.0.0.1:18080 coursebite-build`,
then go to `http://localhost:18080`. Hold `/tmp/mt-behaviour.lock` while a local browser drives it.

Output streams back and the script exits with the suite's exit code. Ctrl-C tears the run down.

What happens:

1. The worktree is rsynced to `~/mt-ci/<worktree-name>/`. `.gitignore` is honoured, and
   `node_modules`, `.git`, `.env*`, `.superpowers`, `orchestration` and `.next` are never sent.
   `.env.test` (dummy values) and `.env.example` are the only env files that go.
2. `remote-test/run-on-host.sh` runs the suite in a `node:24-bookworm`-based runner image
   (`remote-test/runner.Dockerfile`: Docker CLI, pinned pnpm, Playwright Chromium), built once per
   content hash. The runner uses the host network, runs as the host user, mounts the Docker socket
   and the code at its host path, and keeps the pnpm store in the `mt-pnpm-store` volume. It gets
   32 CPUs and 64 GB.
3. `remote-test/testcontainers-ci.ts` is preloaded into Vitest: every Testcontainers container is
   published on 127.0.0.1 only and labelled. Ryuk is off; the run's own cleanup removes them.
4. On exit, the run removes only what it created: containers, networks and volumes labelled
   `mastertutor.ci.run=<project>`, and the Compose project `<project>` (`down -v`).

The host is shared with other people's production apps. Rules for anything added here:

- Label every container, volume and network `mastertutor.ci=1` (and `mastertutor.ci.run=<project>`).
- Compose projects are `mt-<branch>-<rand>` (`COMPOSE_PROJECT_NAME` is set in the runner).
- Publish ports on 127.0.0.1 only. Never prune globally; never touch other containers, Dokploy,
  Traefik or host settings. Work only under `~/mt-ci/`.
- The behaviour stack and the full test stack have fixed loopback ports and subnets, so each
  takes a host lock: `behaviour.lock` (flock) for behaviour, and `stack.lock` for e2e, smoke, qa
  and bench-mock (a directory naming its owner; qa holds it until `qa --down`). If a host crash
  leaves a stale `stack.lock`, check that `docker compose ls` shows no `mt-` project, then run
  `rm -rf ~/mt-ci/.runs/stack.lock`.
- Full-stack suites run `compose.test.yml` plus `tests/e2e/compose.remote.yml` (CI labels, the
  slot AppArmor profile, no published media ports). The AppArmor profile must be loaded.

Kept between runs: each worktree's synced copy with its `node_modules` and `.next`, the
`mt-pnpm-store` volume and the `mt-ci-runner:<hash>` image. To remove a worktree's copy:
`ssh coursebite-build rm -rf mt-ci/<worktree-name>`.

## Heavy stacks on a laptop

One heavy stack at a time (D46). Anything that boots slots or the full stack on a laptop takes
`/tmp/mt-behaviour.lock` first. `scripts/e2e.sh` and `scripts/compose-smoke.sh` do it themselves
(and keep it with `KEEP_STACK=1`). For anything else, such as `pnpm test:behaviour` or a manual
`pnpm compose:test up`:

```sh
until mkdir /tmp/mt-behaviour.lock 2>/dev/null; do sleep 15; done; trap 'rmdir /tmp/mt-behaviour.lock' EXIT
```
