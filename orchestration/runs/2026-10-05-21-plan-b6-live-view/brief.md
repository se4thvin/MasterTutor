---
run_id: 2026-10-05-21-plan-b6-live-view
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. First read `orchestration/briefs/plan-writer-common.md`; everything in it applies to you.

Your phase is **B6: Live view**. It is defined by spec §10 and §16 and by `orchestration/runs/2026-10-05-15-research-webrtc-live-view/report.md`. It covers:
- `NekoLiveView` and the n.eko admin API calls;
- oRPC `runs.openLive` with server-side n.eko login, the signed `live_slot` cookie, and TURN REST credentials;
- `/api/live/auth` ForwardAuth;
- per-slot Traefik routers, in both the test file provider and the production label/compose form;
- the control lock: oRPC `runs.takeControl` / `runs.handBack`, `NOTIFY run_control`, the agent aborting work, `giveControl`/`takeControl`, the clipboard toggle, and auto hand-back after 15 minutes idle;
- uploads through n.eko upload/dialog;
- downloads through CDP into the `downloads` volume, then Garage, then `download_ready`;
- the coturn profile;
- the §12 tests for live-view auth, takeover lock and SSRF.

B6 builds on B1, whose plan is being written in parallel. Assume B1 provides a `SlotPool`, a `BrowserSession` with a `ControlHeld` guard, and a per-run `AbortController` registry. Define the minimal seam you need as explicit interfaces and say exactly which B1 exports you consume.

Your final reply will be saved to `docs/superpowers/plans/2026-10-05-phase-b6-live-view.md`.
