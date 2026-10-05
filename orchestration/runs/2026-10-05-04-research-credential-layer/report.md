---
run_id: 2026-10-05-04-research-credential-layer
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I recommend a design where the model only ever handles aliases. A trusted executor outside the model's loop resolves them, but only for a pinned origin and an allowed field. It types the value through Playwright and redacts every screenshot before it leaves the container. browser-use, Stagehand, 1Password, Bitwarden and OpenAI's new hosted browser all keep raw secrets out of model context this way.

## 1. How existing tools handle secret injection
- **browser-use:** the model sees only placeholder keys from `sensitive_data`, and the library swaps in the real value when typing. Credentials can be scoped per domain, e.g. `{'https://*.work.com': {...}}`. Supplying `sensitive_data` without `allowed_domains` makes agent construction fail with `InsecureSensitiveDataError` (a third-party mirror of their security doc says this; the official page doesn't show it). The docs also say to use `use_vision=False` if screenshots might show sensitive data, so screenshots are an admitted leak path.
- **Stagehand:** you write `act("type %password% ...", {variables})` and the values never go to the LLM. Turn server-side caching off for these calls, because variable values are sent to the cache service.
- **1Password Secure Agentic Autofill** (early access since Oct 2025, Browserbase only): a person approves each fill on their phone or desktop. The credential travels over an end-to-end encrypted channel built on the Noise Framework and is filled straight into the browser.
- **Bitwarden Agent Access SDK** (early alpha, Mar 2026, `github.com/bitwarden/agent-access`, Apache-2.0): just-in-time, human-approved, end-to-end encrypted. Today it injects credentials as environment variables into a child process via the CLI. Browser and Browserbase integration is "coming."
- **OpenAI Agents API hosted browser** (DevDay, 29 Sep 2026): your app builds its own sign-in form and submits it to a separate endpoint. Submitted values "stay outside the agent's model input." Approval is per origin, not per action. Passkeys and QR-code sign-in are not supported. This applies only to OpenAI's hosted browser, not your own Playwright, but it's a good pattern to copy.
- **Anthropic:** using computer use on sites that need a login raises prompt-injection risk. Keep the model away from sensitive data and review its actions.

## 2. Recommended design

**A. Tool contract.** The model gets `fill_credential(alias, field ∈ {username, password, totp})`. It gets no `get_secret` and no free-text secrets. The executor:
- resolves `alias` to an encrypted record bound to an exact origin (scheme + eTLD+1 + port), checked against `page.mainFrame().url()` and the target element's frame origin;
- refuses if the target element isn't the expected type (`input[type=password]` for passwords, `autocomplete=username|one-time-code`) or isn't in that record's field allowlist;
- types with `locator.fill()` and returns only `"ok"` or an error code to the model;
- strips the values from logs, traces and HAR (HTTP Archive) files. Leave Playwright tracing off during fills, or scrub the traces.

**B. Screenshot hygiene, layered:**
1. Take every screenshot the model sees with Playwright `page.screenshot({mask: [...], style: ...})`. Mask password inputs, inputs labelled `autocomplete=one-time-code`, any input the executor has filled, and any element whose current value matches a stored secret.
2. Inject CSS that forces `-webkit-text-security: disc` on username and OTP fields.
3. Before filling, re-set the field's `type=password` and remove or disable "show password" toggles.
4. Freeze the screenshot stream from the start of a fill until the fields are masked or the page has navigated.
5. As a final check, scan the screenshot with OCR and the accessibility tree for exact secret matches, and drop the frame on any hit.

**C. Storage.** Use envelope encryption with AES-256-GCM: one data key per user, wrapped by a KMS key (AWS/GCP KMS or Vault Transit). For self-hosting, use a master key from env or a Docker secret, ideally a libsodium `secretbox` or `age` recipient key. Bind each ciphertext to `user_id|alias|origin` as associated data so rows can't be swapped. Decrypt only inside the executor, just before the fill, and zero the buffers afterwards. Keep an append-only audit log (who, alias, origin, time, approved by), never values.

**D. Prompt-injection defense.** Pin the origin (step A). Don't follow cross-origin redirects mid-fill. Ignore any text on the page that asks for secrets. Require human approval on the first use of an alias for an origin, on any new origin, and on any fill that isn't on a login page. Let the agent navigate only within domains allowed per task.

**E. MFA and sessions:**
- Store TOTP seeds encrypted and generate codes server-side with RFC 6238 (`otplib` in TS, `pyotp` in Python), which is browser-use's `bu_2fa_code` pattern.
- Hand SMS codes, push approvals, passkeys, CAPTCHAs and SSO popups to a person through a live view (noVNC/CDP screencast). Pause the model during handoff and mask its screenshots.
- Persist Playwright `storageState` encrypted with the same envelope scheme, as Browserbase Contexts do, so logins are rare.
- Logout: clear the context and storage state, then revoke or delete the saved session blob.

## 3. Libraries
- Playwright (`mask`, `storageState`)
- `libsodium-wrappers` / PyNaCl, or `age`
- `@aws-sdk/client-kms` / Vault
- `otplib` / `pyotp`
- browser-use or Stagehand, if you'd rather adopt their substitution layer than build your own
- Bitwarden Agent Access, or 1Password through Browserbase, as a future source of credentials

## Unverified
- I didn't confirm Playwright's default `maskColor` (sources disagree: `#FF00FF` vs `#F0F0F0`).
- The OCR scan, CSS text-security and toggle blocking in B are my own engineering advice, not taken from a source.
- OpenAI's hosted-browser auth is only days old, and I didn't check how it relates to the `computer-use-preview` model you're using.
- The Bitwarden SDK's language bindings are unconfirmed.

## Sources
- https://docs.browser-use.com/open-source/customize/browser/authentication
- https://github.com/webllm/browser-use/blob/main/docs/SECURITY.md
- https://docs.stagehand.dev/v3/references/act
- https://1password.com/blog/closing-the-credential-risk-gap-for-browser-use-ai-agents
- https://1password.com/press/2025/oct/browserbase-ai-security-partnership
- https://bitwarden.com/blog/introducing-agent-access-sdk/
- https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use
- https://mixed-news.com/en/openai-agents-api-computer-use-origin-approval/
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- https://docs.browserbase.com/features/contexts
- https://docs.browserbase.com/platform/identity/authentication
- https://playwright.dev/docs/api/class-page#page-screenshot
