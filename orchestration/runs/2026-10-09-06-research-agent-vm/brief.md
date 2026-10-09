---
run_id: 2026-10-09-06-research-agent-vm
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

Research and design a **per-run sandbox VM** for the MasterTutor agent. Decision D53c in `orchestration/STATE.md` covers it: the agent should be able to work beyond a Chromium browser, in a whole small VM.

**Repo.** `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`. Read these first:
- `CLAUDE.md`
- D36–D53 in STATE, especially D41/D42 (Dokploy, shared host), D44 (bypass invariants), D45 (AppArmor), D47, D51
- the current browser-slot design: `apps/browser-slot/`, `apps/agent/src/slots/*`, `apps/agent/src/browser/*`, the n.eko live view and takeover (B6), and the computer tool
- the swappable BrowserProvider interface in the spec

**Host facts.**
- The Dokploy host `coursebite` is bare metal with KVM: `/dev/kvm` exists, there are 88 cores and about 500 GB RAM, and it runs Docker.
- It is shared with other tenants, so any host change needs the user's approval.
- Only OpenAI may be a paid service. Everything else must be free, open source and self-hosted.

**Research, with web search and primary sources:**
1. **VM technology.** Compare these options:
   - Firecracker or Cloud Hypervisor microVMs (via firecracker-containerd, Kata Containers, or direct);
   - QEMU/KVM desktop VMs;
   - gVisor;
   - LXD VMs;
   - how existing agent sandboxes do it: E2B, Daytona, OpenAI's and Anthropic's computer-use reference containers, Browserbase, Scrapybara, Cua, OpenHands runtime, Microsoft's Windows Agent Arena.

   Assess each on isolation strength, boot time, snapshot/restore (reset between runs, warm pools), GPU-less desktop performance, Docker Compose / Dokploy compatibility, licence and resource overhead.
2. **Guest design.** A minimal Linux desktop: a light window manager, Chromium, a terminal, a file manager, an office/PDF viewer and Python, chosen for study tasks. The agent's computer-use tools must work at desktop level (screenshot, mouse and keyboard), plus keep CDP to Chromium inside the guest so the browser tools still work. Plan how n.eko or an equivalent streams the whole desktop for live view and takeover.
3. **Security.**
   - Keep egress and the SSRF policy at the VM network boundary (tap, nftables).
   - The vault: secrets never enter the VM except through the existing fill path. Consider whether a desktop VM breaks the fill-pinning model.
   - Masking and the secret screen on desktop screenshots.
   - Downloads and file exfiltration.
   - Clipboard.
   - Reset with no leftover state.
   - The bypass invariants (D44).
4. **Integration.**
   - A `VmProvider` behind the existing provider interface, with the same slot lease, reset and pool semantics.
   - Run-level choice between "browser" and "desktop".
   - Effects on the click guard, which relies on CDP and won't cover native apps, so propose how approvals work for desktop actions.
   - Telemetry.
   - Cost and latency.
5. **Rollout and lift.** Phases, a realistic effort estimate, and which host steps need the user's approval.

**Deliverable.** A research report with a recommended architecture, options and trade-offs, sources with URLs, and `[unverified]` marks where needed. Return the full report as your final reply. Don't write files and don't dispatch subagents. Never read `.env*`.
