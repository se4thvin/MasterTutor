# Run 29: external Codex review (pasted by the user), 2026-10-05

This is an independent review session run beside the build. The user pasted it into the orchestrator session. It reviewed backend HEAD 664d618 and frontend HEAD 068695b, each with uncommitted edits. Its findings are verified independently before any fix (runs 29a/29b).

1. **P1: Cross-origin iframe clicks and keys skip approval.**
   - `hit-test.ts` sees only the opaque iframe, so `needsApproval` returns null.
   - Repro: clicking "Delete account" inside a cross-origin iframe ran without approval.
2. **P1: Space can submit an ordinary form without approval.**
   - In `policy.ts`, generic form-submit gating covers ENTER only.
3. **P1: An approval can be reused on a different record at the same target path.**
   - `domHash` hashes only the interactive manifest, so it misses record changes in static text.
   - Repro: "Alice" → "Bobby"; the earlier approval then deleted Bobby.
   - This is separate from the M10 path-binding fix.
4. **P2 (frontend): Raw `api.*` mutations skip the session-expiry handling.**
   - Example: `block-editor` calls `api.notes.updateBlock` directly.
5. **P2 (frontend): Defaults and kill-switch saves overwrite each other's cached settings.**
   - Each replaces the whole settings cache, so out-of-order responses diverge.
6. **P2 (frontend): Deleting a note leaves its detail and search caches.**
   - A deleted note can be reopened from cache.

**Validation at review time:**
- 327/327 unit tests and lint pass.
- Typecheck fails on `claim.int.test.ts` `reclaimedSlot`. This mismatch comes from the in-flight fix wave.
