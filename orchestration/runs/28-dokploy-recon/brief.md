---
run_id: 28-dokploy-recon
date: 28-dokploy
agent_type: general-purpose
phase: deploy
status: completed
depends_on: []
---

Explore the user's Dokploy server through the `mcp__dokploy-mcp__*` tools and work out how MasterTutor should deploy there. Load the tools with ToolSearch first, for example `+dokploy project` or `select:` with specific names. The server is reached over the user's tailnet.

**HARD RULE: READ-ONLY.**
- Use only read calls: `*-one`, `*-all`, `*-getAll`, `*-search`, `*-byProjectId`, `*-readTraefikConfig`, `settings-get*`, `settings-read*`, `settings-health`, `settings-getDokployVersion`, `settings-getIp`, `server-all`, `server-one`, `server-publicIp`, `server-getServerMetrics`, `docker-getContainers*`, `dockerDiskUsage-getDiskUsage`, `dockerVolume-getVolumes`, `network-all`, `network-inspect`, `domain-by*`, `certificates-all`, `registry-all`, `destination-all`, `project-all`, `environment-*` (read only), `compose-one`, `compose-loadServices`, `compose-getConvertedCompose`, `deployment-all*`, `overview-*`, `settings-getTraefikPorts`, `swarm-getNodes`, `cluster-getNodes`.
- Never call anything that creates, updates, deploys, starts, stops, restarts, removes, cleans, prunes, writes, saves or toggles. Never call `docker-readContainerFile` or `dockerVolume-readVolumeFile`. Never call `user-*` token or key generators.
- **Secrets:** if a response contains env vars, passwords, tokens, private keys or connection strings, never copy their values into your output. Record only the key names, and only where they matter.

**Repo:** `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`, read-only except for your report file.

Read these for what MasterTutor needs:
- the compose file(s) at the repo root (`compose*.yml` / `docker-compose*.yml`);
- `apps/*/Dockerfile`;
- `apps/browser-slot` (n.eko, seccomp, iptables, the `cdp` internal network with static IPs .10/.11/.12, six slots);
- `CLAUDE.md`;
- `orchestration/STATE.md` (D10, D11, D12, D26);
- spec §1, §5 and §6, and Phase 9 in `docs/superpowers/plans/2026-10-05-phase-7-10-integration-qa-deploy-benchmark.md`.

**Answer these questions:**
1. **Server facts:** Dokploy version, server(s), CPU/RAM/disk, Docker and swarm mode, existing projects and apps (names only), and the networks.
2. **Traefik:** how it is configured (ports, entrypoints, certificate resolver), plus the domains and certificates in place. Which domain or subdomain should MasterTutor use?
3. **Feasibility of our compose on Dokploy:**
   - custom seccomp profile;
   - `cap_add` NET_ADMIN for iptables;
   - internal networks with static IPv4;
   - IPv6 disabled;
   - `shm_size`;
   - WebRTC UDP port ranges for n.eko (and whether a TURN or host UDP range is needed behind Traefik);
   - named volumes for Postgres, Garage and downloads;
   - the healthchecks.

   Compose vs swarm stack: which Dokploy compose type ("docker-compose" vs "stack") supports these? Flag any blockers.
4. **Secrets and env:** how secrets should be supplied, for example `OPENAI_API_KEY` and the vault keypair (D31, Dokploy env secrets).
5. **Source and build:** Git provider vs registry, and the build location (on-server builds vs a prebuilt registry). Report the build disk and cache state.
6. **Backups:** what is available for Postgres and volumes (destinations).
7. **Port and network conflicts** with existing apps.

**Output:**
- Write the full findings and a concrete, step-by-step deployment plan to `orchestration/runs/28-dokploy-recon/report.md`. The plan should cover:
  - the compose changes needed;
  - the Dokploy objects to create later (project, compose app, domains, env, backups);
  - the risks;
  - the open questions for the user.
- Also write `orchestration/runs/28-dokploy-recon/brief.md` containing this prompt.

Reply in at most 250 words: the key facts, the blockers, and the recommended approach. Do not dispatch subagents.
