# MasterTutor deploy runbook (Dokploy)

**Status: deploy-ready files; NOT deployed.** The real deploy and its inputs are deferred until
the zyBooks benchmarks pass (D42). Every step marked **[approval]** changes the shared Dokploy
host, Dokploy, DNS or the router, and runs only after the user explicitly approves that step
(D41). Never touch other apps on the host (YUMMI is "DO NOT TOUCH").

## 0. Deferred inputs (D42): needed from the user before anything below

1. **Domain** (`DOMAIN`), with its DNS A record pointing at the public IP. **[approval]** — the
   user creates the record.
2. **Git remote** for on-server GitHub builds (`main`).
3. **Router:** forward 59001–59006 UDP and TCP to the host's LAN address. Confirm whether the
   public IP is static, because a change breaks `NEKO_WEBRTC_NAT1TO1` and DNS. **[approval]** —
   the user changes the router.
4. **AppArmor:** the `mastertutor-slot` profile is loaded on the host
   (`sudo aa-status | grep -w mastertutor-slot`; install: `infra/host/apparmor/README.md`).
   **[approval]** — the user runs the sudo install.
5. **Backup destination:** a self-hosted S3-compatible target on ANOTHER machine (D11; a target
   on this host does not survive losing the host).

## 1. Ready checks (no host access)

- `pnpm deploy:check-env /path/outside/repo/prod.env` prints `production env OK`. This is the
  production gate for the env; `pnpm prod:smoke` checks the running deploy (§10).
- `scripts/remote-test.sh smoke` ends with `RESTORE DRILL OK`.
- The zyBooks benchmark (Phase 10) has passed.

## 2. Host, once [approval]

- AppArmor profile loaded (input 4).
- `CDP_SUBNET_PREFIX=<prefix> bash infra/host/create-cdp-network.sh` (dry run), then the same
  command with `--yes`. This creates the external `mastertutor-cdp` network.
- **No** `ufw`, no sysctl, no other host firewall change: the router controls ingress (D41).
  Docker publishes only the six media ports; `tests/compose/prod-overlay.int.test.ts` guarantees it.
- **Production files go up on this host only through the Dokploy app.** Any other
  `docker compose … -f compose.prod.yml up` here (a CI suite, a bench stack) registers duplicate
  `mastertutor-*` routers on the shared Traefik, which drops conflicting definitions and breaks
  live view.

## 3. Secrets

- On a trusted machine: `pnpm env:init --out /path/outside/repo/prod.env`. It refuses a path git
  would track, and prints key names, never values.
- Edit by hand (never paste values into chat or tickets):
  - `DOMAIN=<domain>`
  - `PUBLIC_URL=https://<domain>`
  - `PUBLIC_IP=<public IPv4>`
  - `COMPOSE_PROFILES=pdf`
  - `AUTH_SIGNUP_OPEN=0`
  - `OPENAI_API_KEY` (the single key, D36)
  - `CDP_SUBNET_PREFIX` only if 172.30.231 is taken
- Must NOT be present: `TURN_SECRET`, `OPENAI_EMBEDDINGS_KEY`, `AGENT_TEST_MODE`,
  `WEB_FIXTURE_API`, `VAULT_NEXT_PRIVATE_KEY`, and a non-empty `SLOT_EGRESS_ALLOW_CIDRS`
  (`compose.prod.yml` pins it empty anyway).
- `pnpm deploy:check-env <file>` must print `production env OK`. Run it from a clean shell.

## 4. Dokploy app [approval]

- Compose type **docker-compose** (not stack); source GitHub, on-server build, branch `main`,
  compose path `compose.yml`.
- Command (D41): `-p <app> -f compose.yml -f compose.prod.yml up -d --build --remove-orphans`.
- **Isolated deployment OFF** (it rewrites networks), **randomize OFF**, **auto-deploy OFF**, no
  webhook: deploys are manual (D42).
- **Never rename the app.** Volumes are `<app>_pgdata`, `<app>_garage-meta`,
  `<app>_garage-data` and `<app>_downloads`; a rename orphans them.
- Environment: paste the checked file.
- **The Domains tab stays empty.** No service joins Dokploy's shared `dokploy-network` (other
  tenants' service names would answer our bare-name lookups). `compose.prod.yml` carries web's
  router (`Host(<domain>)`, websecure, `letsencrypt` resolver) on `mastertutor-cdp`, where
  Traefik sits at `.12`; the `/live` routers share that certificate.

## 5. Deploy [approval]

1. Check the external network still matches the env:
   `CDP_SUBNET_PREFIX=<prefix> bash infra/host/create-cdp-network.sh` (dry run) must report
   "already exists and matches"; it exits 1 on a mismatch.
2. Deploy from Dokploy.
3. `bash infra/host/attach-traefik.sh` (dry run), then with `--yes`. It must report `.12`.
   Traefik reaches web and the slots only over `mastertutor-cdp`, so without this attachment the
   whole app is down (404/502 for every request, not just live view). The attachment can be made
   before the first deploy, since the network exists from §2.
4. First owner: set `AUTH_SIGNUP_OPEN=1`, redeploy, sign up, then set it back to `0` and redeploy.

## 6. Backups [approval]

- Destination: the self-hosted S3 target (input 5).
- **Compose database backup:** service `postgres`, database `mastertutor`, user `owner`,
  daily 03:00, keep 14. Format: `pg_dump -Fc --no-acl --no-owner` gzipped, which is what
  `scripts/deploy/restore-drill.sh` rehearses.
- **Volume backups, in order after the dump:** `garage-meta`, then `garage-data`, daily at 03:30,
  with Dokploy's "stop the container during the backup" on, so the backup stops `garage` and
  starts it again. Garage's metadata is SQLite (`infra/garage/garage.toml`): a hot copy can
  restore corrupt. Taking objects after the dump means every restored row's object exists
  (objects newer than the dump are harmless orphans).
- **Not backed up:**
  - `downloads`: transient; finished downloads are ingested into Garage.
  - `pgdata`: the database backup covers it.
- **Restore:**
  1. stop `web` and `agent`;
  2. restore the dump: Dokploy's restore, or
     `gunzip -c <file> | docker compose … exec -T postgres pg_restore -U owner -d mastertutor --clean --if-exists --no-acl --no-owner`;
  3. with `garage` stopped, restore `garage-meta` and `garage-data` from the same night, then
     start `garage`;
  4. `docker compose -p <app> -f compose.yml -f compose.prod.yml run --rm migrate`, which re-applies grants;
  5. start `web` and `agent`.
- **First-backup check [approval]:** take one manual backup of the database and both Garage
  volumes to the real destination, download them, and restore them into a throwaway project
  `mt-drill-<random>` with `scripts/deploy/compose.drill.yml` (CI labels, no ports, no slots),
  using the same lines; check garage starts and lists the bucket; then `docker compose -p
mt-drill-<random> … down -v`. This confirms the format matches the drill. If Dokploy's file is
  not a gzipped custom-format dump, change the drill's two marked lines and this section together.

## 7. Key rotation [approval]

**[approval]** — every step below changes the production env, Garage or the vault.

- **Garage S3 keys (D61):** rotate the access key id AND the secret together, never the secret
  alone (an env edit and a redeploy, so `garage-init` imports the new id). `garage-init` refuses a
  new secret under an existing id. Afterwards, delete the old key with
  `docker compose … exec garage /garage key delete --yes <old id>`.
- **Vault:** `vault:rotate` with `VAULT_NEXT_PRIVATE_KEY` set only for that one-off command,
  never in the app env.

## 8. Network and host notes

- Media goes straight to the slots on 59001–59006 (UDP and TCP mux), with
  `NEKO_WEBRTC_NAT1TO1=PUBLIC_IP`. There is no TURN in v1 (D42).
- Clients on the same LAN need the router's NAT loopback. Tailnet clients are unsupported
  unless a second NAT1TO1 address is verified.
- `/live/<runId>/` passes through the per-slot routers in `compose.prod.yml`, in this order:
  ForwardAuth to web's static `.11` → strip → frame headers. Uploads go through a more specific
  router that adds the 100 MiB body limit after ForwardAuth. Traefik buffers an upload body past
  1 MiB to disk inside the shared Traefik container, so six concurrent uploads can briefly use
  about 600 MB of its disk; only signed-in members holding control can upload.
- **Resource bounds** (the host is shared): every service has `mem_limit`, `cpus`, `pids_limit`
  and json-file log rotation (10 MB × 3). Slots 4 GB / 2 CPUs / 4096 pids each (24 GB, 12 CPUs
  for six), agent 4 GB / 2, web 2 GB / 2, postgres 2 GB / 2, garage 1 GB / 1, migrate 1 GB / 1,
  garage-init 512 MB / 0.5.
- Images are tagged `:prod` (`mastertutor/{web,node-runtime,browser-slot}:prod`), never the CI
  `:local` tags that test runs on this host rebuild.

- **After any Dokploy or Traefik update** (a Dokploy upgrade, or any tenant's change to
  Traefik's ports or env recreates `dokploy-traefik`): run `bash infra/host/attach-traefik.sh`
  (dry run). It must report "already attached … at .12"; otherwise the app is down until it is
  re-run with `--yes` **[approval]**. Then check `curl -sI https://<domain>/healthz` answers 200.

## 9. What users should know

- **Uploads:** drag-and-drop into the live view only. The n.eko file chooser is not supported in v1.
- **Downloads:** downloads land in the run's assets. The download link is a short-lived
  (300 s) signed `assets.url`.

## 10. Smoke after deploy [approval]

```sh
read -r SMOKE_EMAIL && read -rs SMOKE_PASSWORD && export SMOKE_EMAIL SMOKE_PASSWORD
pnpm prod:smoke --base https://<domain>
```

It runs one real-model capture with one takeover and spends at most $1. Against a non-loopback
`--base` it skips the local-stack preflight (lock and prod-mode config check): `deploy:check-env`
is the production gate.

## 11. Recorded deviations from spec §3.1 and §13

- docling runs on its own internal `pdf` network, shared only with the agent (B5 decision 17;
  spec §3.1 says `backend`). It has no route to Postgres, Garage or the internet, runs read-only
  with no capabilities, and `compose.prod.yml` pins the agent's `DOCLING_URL=http://docling:5001`.
- No coturn (D42).
- ForwardAuth runs by `.11`, before strip (D41, B6 §7).
- web is not on `dokploy-network`; its router lives in `compose.prod.yml` (review I2).
- Dokploy backups replace a custom dump schedule (D41).
- No host firewall or sysctl changes (D41, D45).
