---
run_id: 28-dokploy-recon
date: 28-dokploy
agent_type: general-purpose
phase: deploy
status: completed
depends_on: []
---

I couldn't write `report.md`: the harness blocks subagents from writing report files. So the 250-word summary is first and the full report follows below. `brief.md` was written to `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/28-dokploy-recon/brief.md`. The repo's `orchestration/tools/persist_run.py` can save this reply as `report.md`. All Dokploy calls were read-only.

## Summary (≤250 words)

**Key facts**
- **Server:** Dokploy v0.30.5, one host (`coursebite`), single-node swarm, Docker 29.2.1.
- **Resources:** 88 vCPU, about 504 GiB RAM, about 1.68 TB disk free.
- **NAT:** the host is behind NAT (LAN 192.168.86.94, public 47.220.155.251). The server is shared with other people's projects; YUMMI is tagged "DO NOT TOUCH".
- **Traefik:** a standalone `dokploy-traefik` container, entrypoints `web` :80 and `websecure` :443, Let's Encrypt with the TLS-ALPN challenge.
- **Domain:** suggest `notes.sethvin.dev`. You already use that domain for Quant Trader.
- **Registry and backups:** no registry, no backup destination, and no backups run anywhere on the server.

**Compose fit:** use the Dokploy compose type "docker-compose", not "stack". Seccomp, NET_ADMIN, static IPs on the internal network, the IPv6 sysctls, `shm_size`, named volumes and the healthchecks all work under it. Ports 59001–59006 and the subnet 172.30.231.0/24 are free. TURN isn't needed for v1 because the TCP mux covers networks that block UDP.

**Blockers**
- The repo has no git remote, so Dokploy has nothing to build from.
- The router must forward 59001–59006 UDP and TCP to 192.168.86.94.
- DNS for the chosen domain must point at 47.220.155.251.
- A self-hosted S3 backup destination is needed.

**Phase 9 changes needed**
- Make `mastertutor-cdp` an external network, so redeploys keep the Traefik attachment.
- Point ForwardAuth at `172.30.231.11:3000`, not `web:3000`. Another app's `web` service on the shared `dokploy-network` could make that name ambiguous.
- Replace the `pgbackups` dump volume with Dokploy's own compose database backups.
- Remove the `OPENAI_EMBEDDINGS_KEY` check; decision D36 dropped that key.
- Don't run `firewall.sh` as written. Its `ufw --force enable` could cut off services other people run on this host.
- The AppArmor sysctl applies to the whole host and needs your approval.

**Recommended approach:** build on the server from GitHub (the same way your quant-trader app deploys), with auto-deploy off.

---

# Full report: Dokploy server recon and MasterTutor deploy plan

All Dokploy calls were read-only. Nothing was created, changed, deployed or cleaned, and no container or volume file was read. The API returned secret values as `[REDACTED]`, and none are reproduced here. Claims marked `[unverified]` come from general Dokploy or Docker knowledge, not from this server.

## 1. Server facts

| Item | Value | Source |
|---|---|---|
| Dokploy | **v0.30.5** | `settings-getDokployVersion` |
| Servers | Local host only. `server-all` returned `[]`: no remote or build servers. | `server-all` |
| Host | `coursebite`, x86_64 Linux, Docker Engine **29.2.1** | `swarm-getNodeInfo` |
| CPU / RAM | **88 vCPU** and **about 504 GiB** RAM; about 9 GB in use | `docker-getServerHealth` |
| Disk | 1.97 TB total, about 283 GB used (**about 1.68 TB free**) | `docker-getServerHealth` |
| Swarm | Single-node swarm. This node is the manager and leader, at node address **192.168.86.94** (LAN). | `swarm-getNodes` |
| Public IP | **47.220.155.251**. The node address is private, so the host is **behind NAT**. | `settings-getIp`, web server settings |
| Dokploy UI | `dokploy.coursebite.ai`, HTTPS via Let's Encrypt | web server settings |
| Settings | Daily Docker cleanup is on. Build concurrency is 1. Logs are cleaned daily. Metrics run on port 4500. | web server settings |
| Infrastructure health | Dokploy's Postgres and Traefik are both healthy | `settings-checkInfrastructureHealth` |

**Projects and apps (names only)**
- **YUMMI** (tagged **"DO NOT TOUCH"**): `yummi-brain-web`, `yummi-gateway` (two apps with this name), `yummi-brain-worker`, and one Postgres.
- **job-search-crm**: compose app `jobcrm`, and one Postgres.
- **Quant Trader**: compose apps `quant-infra` and `quant-app`, and one Redis. `quant-app`'s last deploy shows an error, but its containers are healthy.
- **Portfolio**: `frontend`.
- **Landing**: `landing`.
- **Utilities**: compose app `Open Design`. An Uptime Kuma container also runs.
- **Ollama**: compose app ` chat` (the name starts with a space).
- **OpenClaw**: compose app `openclaw-estevan`.
- **DevOps**: empty.
- **Joy**:
  - production: `joy-api` and Postgres;
  - `dev-green`: `Backend`, Postgres and Redis.

Some containers run outside Dokploy: `gluetun`, `openvpn`, `rabbitmq`, `mongodb`, `redis-stack-server`, `postgressql`, and a `plex-stack` network. One container is dead. **Several people host projects on this box.**

**Docker networks**

| Network | Driver | Subnet |
|---|---|---|
| `ingress` | overlay | 10.0.0.0/24 |
| `dokploy-network` | overlay | 10.0.1.0/24 (14 containers) |
| `bridge` | bridge | 172.17.0.0/16 |
| `docker_gwbridge` | bridge | 172.18.0.0/16 |
| `plex-stack_default` | bridge | 172.19.0.0/16 |
| `clawdbots-openclaw-6qpplk` | bridge | 172.20.0.0/16 |
| quant-app `_default` | bridge | 172.21.0.0/16 |

Dokploy's own Networks registry (`network-all`) is empty.

## 2. Traefik

- Traefik runs as a **standalone container, `dokploy-traefik`**, not a swarm service. So `docker network connect` works on it.
- **Providers:**
  - `docker`, with `exposedByDefault: false` and the default network `dokploy-network`;
  - `file`, watching `/etc/dokploy/traefik/dynamic`.
- **Entrypoints:**
  - `web` on :80;
  - `websecure` on :443, with HTTP/3 advertised and the default resolver `letsencrypt`.
- **Certificate resolver:** `letsencrypt`, using the ACME TLS-ALPN challenge (`tlsChallenge`).
- **Dashboard:** `api.insecure: true`, but the dashboard isn't published. `settings-getTraefikPorts` returned `[]`, so there are no extra entrypoints.
- **Certificates:** none uploaded. Every domain uses Let's Encrypt.
- **Domains in use:**
  - `*.coursebite.ai`: `yummi`, `estevan.oc`, `joy.ws`, `chat.ws`, `joy-design-hub.ws`, `joy-api.ws`, plus the panel at `dokploy`;
  - `harsh.cv` and `www.harsh.cv`;
  - `joyphone.io`, `joyos.io` and `joyassistant.io`, each also with `www.`;
  - `jobcrm.cws.gg` and `jobcrm-api.cws.gg`;
  - **`quant.sethvin.dev`** and **`quant-gw.sethvin.dev`**.
- **Recommended domain: `notes.sethvin.dev`**, or `mastertutor.sethvin.dev`.
  - `sethvin.dev` is yours: your Quant Trader app deploys from the GitHub repo `se4thvin/quant-trader`.
  - The other domains seem to belong to other people on the server; the ACME account email is not yours.
  - An A record pointing at 47.220.155.251 must exist before the first deploy.

## 3. Can our compose file run on Dokploy?

**Use the compose type `docker-compose`, not `stack`.** `docker stack deploy` doesn't support:
- `build`;
- seccomp via `security_opt`;
- `ipv4_address`;
- `depends_on` conditions;
- `shm_size`.

Your `quant-app` already runs as `docker-compose` with on-server GitHub builds, so this path is proven on this server. Keep **isolated deployment off** (it rewrites networks) and **randomize off**.

| Requirement | Verdict | Notes |
|---|---|---|
| Custom seccomp profile (relative path) | OK | It resolves against the cloned code directory `[unverified exact path]`. |
| `cap_add: NET_ADMIN` | OK | |
| Internal `cdp` network with static IPv4 (.10, .11, .12) | OK | 172.30.231.0/24 is free. Make the network external (see §7). |
| IPv6 off via `sysctls` | OK | The entrypoint also has an ip6tables fallback. |
| `shm_size: 2gb`, `tmpfs`, restart policies, `stop_grace_period`, `cap_drop`, `no-new-privileges` | OK | Compose-only features. |
| Named volumes | OK | Dokploy runs with `-p <appName>`, so volumes are named `<appName>_pgdata` and so on. Never rename the app or randomize, or the data is orphaned. Docker 29's prune removes only anonymous volumes `[unverified for Dokploy's exact flags]`. |
| Healthchecks and `service_completed_successfully` | OK | Cleanup deletes exited one-shot containers; the next `up` recreates them. |
| `garage.toml` bind mount | OK | |
| Chromium sandbox sysctl | **Host change** | `kernel.apparmor_restrict_unprivileged_userns=0` affects the whole shared host. The host OS isn't visible through the API. |
| WebRTC 59001–59006 UDP and TCP | OK on the host. **Router forwarding is required.** | Nothing on the host uses 59xxx. Media never goes through Traefik. The router must forward these ports to 192.168.86.94. `NAT1TO1` is 47.220.155.251. |
| TURN | Not needed for v1 | The TCP mux covers networks that block UDP. TURN is only needed for clients limited to port 443, and Traefik can't relay TURN over UDP. The `coturn` and `docling` profiles from spec §3.1 aren't in `compose.yml` yet. |
| `/live` signalling | OK, with Traefik attached | Slots stay off `dokploy-network`. Traefik joins `mastertutor-cdp` at .12, and labels set `traefik.docker.network`. |

**Dokploy itself doesn't block anything here.** The blockers are outside it (§8).

## 4. Secrets and env

- Put secrets in the compose app's **Environment** tab. With `createEnvFile` on, Dokploy writes them to a `.env` file that Compose uses to fill `${VAR}` values.
- `compose.yml` has no `env_file:`. Each service's `environment:` block still enforces least privilege per spec §13. Keep it that way.
- Values are stored in Dokploy's database and in a **plaintext `.env` on the host** `[unverified exact path]`. Anyone with root or Dokploy admin rights on this shared box can read them.
- Dokploy's vault-provider feature is empty here, and it would need HashiCorp Vault or OpenBao. That's extra infrastructure, so it's not recommended now.
- The vault keys are single-line base64 X25519 keys, so they paste cleanly. To set them up:
  1. Generate them with `pnpm env:init` into a file outside the repo.
  2. Check that file with `pnpm deploy:check-env`.
  3. Paste the values into Dokploy.
  4. Delete the file.
- **Keys needed (names only):**
  - OpenAI: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional).
  - Database: `POSTGRES_PASSWORD`, `WEB_DB_PASSWORD`, `AGENT_DB_PASSWORD`.
  - Garage: `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`.
  - S3: `S3_WEB_ACCESS_KEY_ID`, `S3_WEB_SECRET_ACCESS_KEY`, `S3_AGENT_ACCESS_KEY_ID`, `S3_AGENT_SECRET_ACCESS_KEY`.
  - App secrets: `BETTER_AUTH_SECRET`, `VAULT_PUBLIC_KEY`, `VAULT_PRIVATE_KEY`, `NEKO_ADMIN_SECRET`, `NEKO_MEMBER_SECRET`, `LIVE_COOKIE_SECRET`, `TURN_SECRET`.
  - Addresses: `PUBLIC_IP`, `PUBLIC_URL`, `DOMAIN`.
  - Settings: `AUTH_SIGNUP_OPEN=0`, `AGENT_TEST_MODE=0`, `LOG_LEVEL`, `BROWSER_SLOTS`, `COMPOSE_PROFILES`.
- **Plan inconsistency:** Phase 9 Task 14 (`check-env.ts`, its test and the runbook) still requires a separate `OPENAI_EMBEDDINGS_KEY`. D36 dropped that key, so this needs fixing.

## 5. Source and build

- **Registries:** none.
- **Git providers:** three GitHub Apps.
  - `Dokploy-2026-06-11-hzctk2`: owned by the API user and used by `se4thvin/quant-trader`.
  - `Dokploy-2026-09-15-u5e8xm`: owned by the API user and shared with the organisation.
  - `personal-dokploy-44`: owned by another member.
- **The local repo has no git remote.** It must be pushed (for example, to a private repo under `se4thvin`), and the `hzctk2` app must be given access to it.
- **Recommendation: build on the server from GitHub.** No registry exists, and the host has plenty of CPU and disk.
- **Build cache:** 0 B. Images take 10.8 GB.
- **Volumes:** 185 GB in total, of which 176.8 GB (95%) could be freed. Those unused volumes belong to other people's apps; don't prune them without asking.
- **Cold builds:** daily cleanup clears the build cache, so every deploy builds from scratch. Build concurrency is 1, so our builds queue behind other people's deploys.
- **Deploy command:** the default is likely `docker compose -p <appName> -f <composePath> up -d --build --remove-orphans` `[unverified exact string]`. Override it to add `-f compose.prod.yml`, and keep `-p <appName>`.
- **Auto-deploy:** off. Deploy manually, or from a CI webhook after a green build (spec §13).

## 6. Backups

- **There are no destinations and no backups anywhere on this server.** Every Dokploy backup uploads to an S3-compatible destination, so one must be created first.
- Dokploy v0.30 supports **compose database backups**: a `pg_dump` of service `postgres` (database `mastertutor`, user `owner`) on a cron schedule, with retention.
  - These should replace Phase 9's `pg_dump` schedule and `pgbackups` volume, so there's only one backup mechanism.
- It also supports **volume backups** (a tar of a named volume, with an option to stop the container during the copy).
  - Use them for `garage-meta` and `garage-data`.
  - Garage's metadata is SQLite, so stop `garage` during the copy.
  - Don't back up `downloads`; its contents are temporary.
- Under D11 the destination must be self-hosted or free. One option is an S3-compatible service on another machine on your tailnet. A destination on this same host gives no protection against losing the host.

## 7. Port and network conflicts

- **Host ports already in use:**
  - 80 and 443 (TCP, plus 443/UDP for HTTP/3);
  - 3000 for the Dokploy UI `[inferred]`;
  - 4500;
  - 9091 and 51413 (TCP and UDP);
  - 1194/UDP;
  - 5672, 27017 and 6379;
  - 5432 (a Postgres outside Dokploy).
- We publish only 59001–59006, so **there's no port conflict**. The `cdp` subnet doesn't conflict either.
- **Name collision on `dokploy-network`:** Traefik resolves ForwardAuth's `web:3000` while it sits on both the shared `dokploy-network` and `mastertutor-cdp`. If another app on `dokploy-network` has a service called `web`, the name becomes ambiguous.
  - Fix: use `http://${CDP_SUBNET_PREFIX}.11:3000/api/live/auth` instead.
- **Keeping Traefik attached:** if Compose owns `mastertutor-cdp`, recreating that network drops Traefik's attachment, and `down` can fail while Traefik is still attached.
  - Fix: create the network once on the host as `external`, with `--internal --subnet 172.30.231.0/24 --ip-range 172.30.231.128/25`.
  - After that, you only need to re-run `attach-traefik.sh` when Dokploy recreates the Traefik container.
  - Dokploy v0.30's new Networks feature might manage this attachment itself `[unverified]`.
- The slot egress filter blocks private and CGNAT ranges. Slots can't reach other people's containers, the LAN, the tailnet, or Traefik at .12.

## 8. Blockers and risks

**Blockers**
1. The repo has no git remote.
2. The router must forward 59001–59006 UDP and TCP to the host.
3. DNS: `A notes.sethvin.dev → 47.220.155.251`.
4. A self-hosted S3 backup destination is needed.
5. Phase 9 hasn't been built yet: `compose.prod.yml`, `infra/host`, `check-env` and the runbook. B6's `/api/live/auth` must also exist.

**Risks**
- **`firewall.sh` on a shared host.** It runs `ufw --force enable` and allows only 22, 80, 443 and the media ports. That could block non-Docker services on the host that other people rely on (metrics, VPN, the tailnet). Docker-published ports bypass ufw anyway.
- **The AppArmor sysctl** loosens isolation for everyone on the host.
- **Home IP.** If the public IP is dynamic, a change breaks `NAT1TO1` and DNS.
- **NAT hairpin and tailnet access.** Clients on the same LAN need the router to support NAT loopback. Clients on the tailnet need an extra `NAT1TO1` address `[unverified that n.eko accepts a list]`.
- **Slow deploys.** Builds start cold and queue behind other people's deploys.
- **Secrets on disk.** They sit in a plaintext `.env` on a shared host.
- **Traefik `api.insecure`** applies to the whole server. It isn't exposed publicly.
- **Volume names depend on the app name.** Renaming the app orphans the data.
- **YUMMI is tagged "DO NOT TOUCH".** No MasterTutor step touches it, but any host-level change also affects it.

## 9. Step-by-step deployment plan

**A. Repo changes (Phase 9, Tasks 12–14)**
1. Change `compose.prod.yml`:
   - make `cdp` `{ name: mastertutor-cdp, external: true }`;
   - point ForwardAuth at `http://${CDP_SUBNET_PREFIX:-172.30.231}.11:3000/api/live/auth`;
   - remove `pgbackups` and the `/backups` mount;
   - keep the slot routers on `websecure` with TLS;
   - attach only `web` to `dokploy-network`.
2. Change `infra/host`:
   - add an idempotent `create-cdp-network.sh`;
   - keep `attach-traefik.sh`;
   - rewrite `firewall.sh` so it only adds rules and never enables ufw (or drop it);
   - install the sysctl only if you approve it.
3. In Task 14, drop the `OPENAI_EMBEDDINGS_KEY` rule, and switch the runbook to Dokploy's database and volume backups.
4. Add the `docling` (`pdf`) and `coturn` (`turn`) services if v1 needs them.

**B. Host prep (needs your approval; done over SSH)**
1. Set up router forwarding for 59001–59006 UDP and TCP.
2. Add the DNS A record.
3. Run `create-cdp-network.sh`.
4. Install the sysctl, if approved.

**C. Dokploy objects (create later)**
1. Project `MasterTutor`, environment `production`.
2. Compose app `mastertutor`:
   - source: GitHub via `hzctk2`, branch `main`, path `./compose.yml`;
   - type `docker-compose`;
   - isolated deployment off, randomize off;
   - custom command `-p <appName> -f compose.yml -f compose.prod.yml up -d --build --remove-orphans`;
   - auto-deploy off.
3. Environment: the keys in §4, plus:
   - `DOMAIN=notes.sethvin.dev`;
   - `PUBLIC_URL=https://notes.sethvin.dev`;
   - `PUBLIC_IP=47.220.155.251`;
   - `COMPOSE_PROFILES=pdf`.
   Validate them first.
4. Domain: service `web`, port 3000, `notes.sethvin.dev`, HTTPS, `letsencrypt`.
5. Deploy, then run `attach-traefik.sh`.
6. Destination: the self-hosted S3 target.
7. Backups:
   - a compose database backup of `postgres` (database `mastertutor`, user `owner`), daily at 03:00, keeping 14;
   - daily volume backups of `garage-meta` and `garage-data`.
8. Run the restore drill against the real destination, then the production smoke test with one takeover.

## 10. Open questions for you
1. Domain: `notes.sethvin.dev`, or another name? Who manages DNS for `sethvin.dev`?
2. Repo location: a private repo under `se4thvin`? May the `hzctk2` Dokploy app have access to it?
3. Can you forward 59001–59006 UDP and TCP on the router? Is the public IP static?
4. Will you use the app from your home LAN or over the tailnet?
5. Do you approve the host-wide AppArmor sysctl? What OS version is the host?
6. Which self-hosted S3 target should backups go to?
7. Should we drop `firewall.sh` and control access at the router instead?
8. Are coturn and docling needed for v1?
9. Should deploys be manual, or triggered by a CI webhook?
