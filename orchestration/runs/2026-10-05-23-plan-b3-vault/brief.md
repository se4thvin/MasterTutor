---
run_id: 2026-10-05-23-plan-b3-vault
date: 2026-10-05
agent_type: general-purpose
phase: plan
status: completed
depends_on: []
---

Repo: /Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark. First read `orchestration/briefs/plan-writer-common.md`; everything in it applies to you.

Your phase is **B3 Vault**, spec §9 plus §16. The plan covers:
- **Sealing:** a libsodium sealed box with row binding. `web` seals using the public key only, `agent` opens. Include `vault:rotate`.
- **oRPC vault endpoints:** create, update, delete and list (aliases only), plus an OTP submit that seals into `otp_codes` and sends NOTIFY `otp_ready`.
- **`fill_credential`:** all fields (username, password, totp via otplib, pin, otp), split PIN/OTP boxes, and the checks for origin, frame, field type, first-use approval, and atomic fill with respect to abort.
- **IMAP OTP:** via imapflow, with a greenmail fixture.
- **`use_passkey` and enrolment:** CDP WebAuthn.
- **Sealed per alias+origin `browser_sessions`:** save after login and at checkpoints, and delete on logout.
- **`vault_audit`.**
- **Fixtures:** the login site (password, TOTP, split PIN, email OTP), the WebAuthn site, and the injection page.
- **The §12 security tests that fail the build:** secret canary including OCR, origin pinning, field type, injection, key placement.

The benchmark (zyBooks email/password login) relies on this phase. Make sure username and password filling works on ordinary real-world login forms, including React-controlled inputs, by firing the input and change events Playwright's `fill()` triggers.

Assume B1 provides `BrowserSession`, a `ControlHeld` guard, the `Tool<A,R>` registry, approvals, and the step transaction. Name the exact B1 interfaces you consume. B1's plan is being written in parallel, so define the seams you need explicitly.

Your final reply will be saved to `docs/superpowers/plans/2026-10-05-phase-b3-vault.md`.
