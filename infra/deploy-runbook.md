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
- `bash infra/host/create-obs-network.sh` (dry run), then with `--yes`. This creates the external
  internal `mastertutor-obs` network, which only Traefik and OpenObserve join (D50, §13).
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
  - `COMPOSE_PROFILES=pdf,observability` (D50; check-env refuses either profile missing)
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
  `<app>_garage-data`, `<app>_downloads` and `<app>_openobserve-data`; a rename orphans them.
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
   Then `bash infra/host/attach-traefik.sh --network obs` (dry run), then with `--yes`
   **[approval]**: Traefik's only route to OpenObserve (§13).
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
- **Volume backup:** `openobserve-data` (OpenObserve's WAL and metadata; its data files are in
  Garage's `observability` bucket, which the Garage volumes cover), daily at 03:45.
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
- Images are tagged `:prod` (`mastertutor/{web,node-runtime,audio-capture,browser-slot}:prod`), never the CI
  `:local` tags that test runs on this host rebuild.

- **After any Dokploy or Traefik update** (a Dokploy upgrade, or any tenant's change to
  Traefik's ports or env recreates `dokploy-traefik`): run `bash infra/host/attach-traefik.sh`
  (dry run). It must report "already attached … at .12"; otherwise the app is down until it is
  re-run with `--yes` **[approval]**. Then check `curl -sI https://<domain>/healthz` answers 200.
  Do the same for `bash infra/host/attach-traefik.sh --network obs`, or `/observability` is down.

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
- PDFs are parsed only in `pdf-worker` (B5 review I-1), a container from the node-runtime image on
  the same `pdf` network: no env, no egress, read-only root, uid 1000, 4 GB (two PDFs at once fit
  its memory budget) / 2 CPUs / 128 pids, restarted when it exits. Each PDF runs in a
  `node --permission` child that is killed at 120 s. The agent sends bytes and reads back
  schema-checked JSON capped at 128 MiB, at most 20,000 blocks (past that the note is partial and
  records `blocksTruncated`).
- `internal: true` networks block DNS forwarding only on Docker Engine ≥ 26.0.0 (or 25.0.5;
  CVE-2024-29018). The host must run such a version, or pdf-worker and docling could leak PDF
  content through DNS. The CI host runs 29.2.1.
- PDFs up to 100 MiB are captured, but the original file is stored only up to the 25 MiB asset
  limit; the source records `originalWithheld: "too_large"` (or `"unscreened"` when a page image
  was withheld by the secret screen). Revisit when object reads stream (preflight S8).
- No coturn (D42).
- ForwardAuth runs by `.11`, before strip (D41, B6 §7).
- web is not on `dokploy-network`; its router lives in `compose.prod.yml` (review I2).
- Dokploy backups replace a custom dump schedule (D41).
- No host firewall or sysctl changes (D41, D45).

## 12. Third-party images and licences

Every third-party image is free and open source (CLAUDE.md cost rule). The one that runs untrusted
input with model weights is pinned by digest, the digest verified offline on the CI host:

- `quay.io/docling-project/docling-serve-cpu:v1.36.0@sha256:225c8586e20d5d0fc6811a9e0e044fa602bcc4393f00389009bad42d6787b58f`
  - Code: docling-serve 1.36.0, docling-slim 2.132.0, docling-core 2.99.0, docling-parse 7.22.1,
    docling-ibm-models 4.0.3, docling-jobkit 3.8.1: MIT. EasyOCR 1.7.2 and RapidOCR 3.9.2:
    Apache-2.0. PyTorch: BSD-3-Clause.
  - Model weights baked into the image (`DOCLING_SERVE_ARTIFACTS_PATH`): docling-layout-heron and
    its ONNX export (Apache-2.0), docling-models / TableFormer (CDLA-Permissive-2.0),
    DocumentFigureClassifier v2.5 (MIT), EasyOCR detection and recognition weights (Apache-2.0),
    RapidOCR PP-OCR models (Apache-2.0, from PaddleOCR).
  - To update: pull the new tag on the CI host, read its digest, rerun the offline check
    (`--network none --read-only`, convert the fixture), then change compose.yml and
    `apps/agent/src/pdf/both-paths.int.test.ts` together.
- `otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6`:
  Apache-2.0.
- `openobserve/openobserve:v1.0.4@sha256:d4a878fac1f6c56003764f7f2a1625668917388f167e222c8c810de3f54c56ba`:
  AGPL-3.0, run unmodified as a separate service; no code is copied (D20). Telemetry, usage
  reporting and GeoIP downloads are off, and it has no egress.

## 13. Observability (D50)

The whole telemetry stack is profile `observability`: `otel-collector`, `openobserve` (data in
Garage's `observability` bucket, under its own key) and the one-shot `observability-init`, which
re-applies users, retention, dashboards and alerts on every deploy. In order:

1. **User approval** for the two host changes below **[approval]**. Neither is run by an agent.
2. `bash infra/host/create-obs-network.sh` (dry run), then with `--yes` **[approval]**: the
   external internal network `mastertutor-obs`.
3. `bash infra/host/attach-traefik.sh --network obs` (dry run), then with `--yes`
   **[approval]**. Re-run it whenever Dokploy recreates Traefik, like the cdp attach (§8).
4. `COMPOSE_PROFILES=pdf,observability`.
5. `pnpm env:init --out <file>` adds the new secrets (`OBSERVE_ROOT_PASSWORD`,
   `OBSERVE_INGEST_PASSWORD`, `OBSERVE_VIEWER_PASSWORD`, `ALERT_WEBHOOK_SECRET`,
   `S3_OBSERVE_ACCESS_KEY_ID`, `S3_OBSERVE_SECRET_ACCESS_KEY`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`) to an existing file without touching its values; then
   `pnpm deploy:check-env <file>`. OpenObserve refuses a password without a lowercase letter, an
   uppercase letter, a digit and a special character, so set them only through env-init.
6. After the deploy: sign in as the owner, open `/observability/` (through the Alerts page's
   "Open dashboards"), and check that the six "MasterTutor · …" dashboards exist. A non-owner
   gets 403.
7. Turn on phone alerts in the iPhone Home Screen app (Settings → Notifications).

Notes:

- Dashboards and alerts are code (`packages/observability`): edits made in the OpenObserve UI are
  overwritten on the next deploy.
- **Container logs:** slots, `pdf-worker`, `audio-capture` and `docling` log through Docker's
  `fluentd` driver to the collector on `127.0.0.1:24224` (the only new published port, loopback
  only). The driver is asynchronous and non-blocking, and Docker's dual-logging cache keeps
  `docker logs` and Dokploy's log viewer working while the collector is down.
- **Bounds:** collector 512 MB / 0.5 CPU / 128 pids; OpenObserve 2 GB / 1 CPU / 256 pids;
  observability-init 256 MB / 0.25 CPU / 64 pids. Retention: logs 30 d, traces 15 d, metrics 90 d.
- OpenObserve's open-source build has one user role (admin), so the ingest and viewer users are
  admins inside OpenObserve: the ingest credential lives only in the collector and the viewer's
  only in web's ForwardAuth answer, never in a browser. The collector's networks are internal except
  `obs-ingest`, which exists only to publish the loopback port and has IP masquerade disabled, so
  the collector has no route to the internet.
- **Rotation [approval]:** change `OBSERVE_INGEST_PASSWORD`, `OBSERVE_VIEWER_PASSWORD` or
  `ALERT_WEBHOOK_SECRET` in the env and redeploy; `observability-init` applies it.
- **Root rotation [approval]:** OpenObserve keeps root's password after its first boot (it ignores
  a changed `ZO_ROOT_USER_PASSWORD`), so root changes its own password through `observability-init`:
  1. in the env file, move the current `OBSERVE_ROOT_PASSWORD` value to
     `OBSERVE_ROOT_PASSWORD_PREVIOUS` and leave `OBSERVE_ROOT_PASSWORD=` empty; `pnpm env:init --out
<file>` fills it with a new compliant password. Run `pnpm deploy:check-env <file>` and redeploy;
  2. check the job: `docker compose -p <app> -f compose.yml -f compose.prod.yml ps -a observability-init`
     must show exit 0, and its log must end with "observability ready";
  3. remove `OBSERVE_ROOT_PASSWORD_PREVIOUS` from the env and redeploy.

  If root's password and `OBSERVE_ROOT_PASSWORD` ever disagree without `_PREVIOUS`, the job logs a
  fatal "cannot sign in as OpenObserve's root" line naming the keys and exits 1, and users,
  dashboards and alerts are not re-applied: check its exit code after every deploy (step 2).
