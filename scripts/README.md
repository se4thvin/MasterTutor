# scripts

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `remote-test.sh`       | Runs a test suite on the shared CI host instead of this machine (below). |
| `check-agent-image.sh` | Proves the production agent image carries no test code.                  |
| `compose-smoke.sh`     | Boots the full stack with the test overlay and smoke-tests it.           |
| `env-init.ts`          | Writes a fresh `.env` with generated secrets.                            |
| `scan-test-code.ts`    | The scanner `check-agent-image.sh` runs inside the image.                |

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
```

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
- The behaviour stack has fixed loopback ports and a fixed subnet, so behaviour runs take a host
  lock and run one at a time.

Kept between runs: each worktree's synced copy with its `node_modules` and `.next`, the
`mt-pnpm-store` volume and the `mt-ci-runner:<hash>` image. To remove a worktree's copy:
`ssh coursebite-build rm -rf mt-ci/<worktree-name>`.
