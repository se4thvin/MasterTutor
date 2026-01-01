---
run_id: 2026-10-05-04-research-credential-layer
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
---

# Brief: Secure credential layer

Research task (web research, no code changes). Today is 2026-10-05. We are building an agentic note-taking web app where an LLM agent (OpenAI computer-use model) controls a Chromium browser (Playwright, in Docker) and must log in/out of websites on the user's behalf. Requirement: the LLM must NEVER see the plaintext passwords (not in prompts, tool args, tool results, screenshots, logs, or traces), but user-provided credentials must still be usable to log in.

Find the best 2026 approaches, with sources:
1. Placeholder/secret-injection patterns: agent emits `fill_secret(alias, field)` or `{{secret:alias}}` and a trusted executor resolves it out-of-band. How do browser-use (sensitive_data), Stagehand, Browserbase, 1Password Agentic Autofill / Secure Agentic Autofill, Bitwarden, Anthropic/OpenAI agent guidance handle this?
2. Screenshot leakage: password fields are masked, but how to guarantee — e.g. forcing input type=password, CSS masking of username/OTP fields, redacting regions before screenshot is sent to the model, blocking "show password" toggles, disabling screenshots while filling.
3. Storage: encrypting credentials at rest (envelope encryption, libsodium/age, AES-256-GCM with KMS or a master key from env), per-user keys, domain binding (only inject for matching origin to prevent phishing / prompt-injection exfiltration), audit logs.
4. Prompt-injection defense: a malicious page asking the agent to type the secret into another field/site — origin pinning, field allowlists, human-in-the-loop approval.
5. MFA/TOTP (storing TOTP seeds and generating codes server-side), passkeys, SSO/OAuth popups, CAPTCHAs (hand off to human via live view), and session persistence (storing cookies/storage state encrypted so re-login is rare). Logout handling.
6. Any standards or libraries in 2026 (TS or Python) to use.

Return a concise report (<700 words) with a recommended design, and source URLs. Flag anything unverified.
