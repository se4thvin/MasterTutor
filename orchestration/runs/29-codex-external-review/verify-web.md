# Run 29b: verification of the frontend findings (#4–#6)

- **Scope:** `.worktrees/fe`, branch `fe-track`.
  - HEAD is `564b646`.
  - The in-flight wave's uncommitted edits touch only motion and CSS files, plus `e2e/press.spec.ts`. None of them touches the code below.
- **Method:** a vitest file runs the real `fixtureRouter` behind the real `RPCHandler`/`RPCLink` wire encoding.
  - A per-path gate holds a response, so delivery order can differ from server-processing order.
  - The component sequences are transcribed from HEAD.
- **Files:**
  - Test: `scratchpad/verify29/web-findings.verify.ts`
  - Config: `scratchpad/verify29/verify.config.mjs`
  - For the run, the test was copied to `apps/web/lib/__verify29__/` and then deleted. The repo is unchanged.
- **Result:** 8/8 pass. Each "HEAD" test asserts the bug; each "FIX" test asserts the proposed behaviour.
- **Not run:** Playwright. Port 3100 is held by the fix agent's server, and the config sets `reuseExistingServer: false`.

## #4: Raw `api.*` mutations skip the session-expiry handling. CONFIRMED (not fixed by I2)

**Trace**
- `dbd7bf4` (I2) handles `UNAUTHORIZED` only in the `QueryCache`/`MutationCache` `onError` (`app/providers.tsx:19-27`).
- The app has **no `useMutation` anywhere**. All 15 write sites call `api.*` directly:
  - `block-editor:41`, `verify-check:33`, `export-button:17`
  - `defaults-form:80`, `kill-switch-row:29`
  - `folder-actions:35`, `folder-name-sheet:59-60`, `use-move-folder:24`
  - `use-move-note:24`, `use-delete-note:18`
  - `vault-view:49,66`, `secret-sheet:71,86`, `add-sign-in-sheet:117`
- Their errors never reach either cache.
- Sites that invalidate an *active* query in `finally` reach sign-in only indirectly: the refetch fails and the `QueryCache` redirects. They show a misleading toast first.
- `block-editor`, `verify-check`, `export-button`, the settings writes and the vault secret writes do not invalidate.
  - On an expired session they show "Couldn't save your edit. The block is unchanged."
  - The user's typed text is lost (this compounds M11), and the page stays put.

**Repro**
- Test `#4 HEAD`: after the session ends, `api.notes.updateBlock` rejects with a typed `UNAUTHORIZED`, and the providers' `onError` count stays at 0.

**Fix**
1. Handle the error once, at the link:
   - In `lib/api/client.ts`, set `new RPCLink({ url, interceptors: [onError(e => { if (errorCode(e) === "UNAUTHORIZED") endSession(); })] })`. `onError` is exported by `@orpc/client`.
   - Put `endSession()` in a small `lib/auth/session-end.ts`. It:
     - runs only once (the `leaving` flag)
     - calls the listeners registered through `onSessionEnd(fn)`. `Providers` registers `client.clear()`.
     - calls `window.location.replace(signInPathFor(location.pathname, location.search))`
   - Remove the two cache `onError`s, so there is one source of truth. Keep the `retry` predicate.
2. Secret-bearing writes stay plain `api.*` calls and never go through `useMutation`. The `MutationCache` keeps `variables`, and the interceptor reads only the error, never the input.
   - Test `#4 FIX` shows that a raw `vault.setSecret` and a query both reach the interceptor while `getMutationCache().getAll()` stays empty.

**Regression tests**
- Unit test, `lib/api/client.test.ts`:
  - Stub `fetch` to return the encoded `UNAUTHORIZED`, and assert `endSession` runs once for each of: a raw call, a query, and two concurrent calls.
  - Assert it does not run for `NOT_FOUND`.
- e2e, `session.spec.ts`:
  - Open the note, flip the cookie to signed-out, edit block 3, and press Save. Expect `/sign-in?next=%2Fnotes%2F…` and no danger toast.
  - Do the same for `secret-sheet` Save.

## #5: Defaults and kill-switch saves overwrite each other's cached settings. CONFIRMED

**Trace**
- `defaults-form.tsx:85` writes `qc.setQueryData(key, saved)` (the whole `SettingsView`).
- `kill-switch-row.tsx:29` writes `qc.setQueryData(key, await setKillSwitch(...))` (also the whole view).
- The `pending` guards serialise each writer only against itself, not against the other.
- `KillBanner` and the Switch both read this cache.

**Repro**
- **Test `#5 HEAD` (a), the safety case:**
  1. The defaults save is processed first, while `killSwitch` is still false, but its response is held.
  2. The kill switch turns on, and its response arrives first.
  3. The late defaults response then sets the cache's `killSwitch` to **false** while the server has it **true**.
  - The UI says runs can start, and the banner disappears.
- **Test `#5 HEAD` (b), the reverse order:**
  - A late `setKillSwitch` response carries the old `defaultBudget` and rolls the saved defaults back in the UI.
  - Because the cache changed, `DefaultsForm` is re-keyed and shows the old values.

**Not fixed by the planned kill-switch `finally invalidate`**
- An invalidate on settle narrows (a) but does not close it. A defaults response that arrives after the kill switch's refetch still overwrites the cache.
- `defaults-form` never cancels or invalidates.

**Fix**
1. **Field ownership.** Each writer merges only its own fields:
   - `setQueryData<SettingsView>(key, old => old && { ...old, killSwitch: res.killSwitch })`
   - `setQueryData<SettingsView>(key, old => old && { ...old, defaultBudget: res.defaultBudget, defaultAllowedOrigins: res.defaultAllowedOrigins })`
   - Put these as `patchSettings(qc, pick)` in `lib/settings/cache.ts`, beside `lib/notes/cache.ts`, so both components share one helper.
2. **Reads cannot clobber writes.**
   - `defaults-form` also does `await qc.cancelQueries({ queryKey: key })` before sending.
   - Both writers do `invalidateQueries({ queryKey: key })` in `finally`. The kill-switch part is already ruled.
3. **Ordering guard (Phase 7, contract).**
   - Add `version: z.number().int()` to `SettingsView` in `packages/contracts`. The server increments it on every write.
   - `patchSettings` and the `settings.get` result then apply only when `incoming.version >= cached.version`.
   - Without a server version, a client-side sequence cannot order a refetch against a write. Field ownership plus cancel/invalidate is the correct fix now, and `version` closes the remaining refetch-versus-write window.

**Regression test**
- Unit test `lib/settings/cache.test.ts`, mirroring `#5 FIX` (it passes in both delivery orders): drive both writes through the gated link, then assert `cache === server`.

## #6: Deleting a note leaves its detail and search caches. CONFIRMED

**Trace**
- `use-delete-note.ts` patches and invalidates `notes.list` only.
- `notes.get` (`note-reader.tsx:32`) and `notes.search` (`use-note-search.ts:17`) keep the deleted note.
- With `staleTime` 30 s, both are served without a refetch, so the palette hit or a back-navigation reopens a deleted note.

**Repro**
- **Test `#6 HEAD`:** after a successful delete, the server returns `NOT_FOUND`, but the cached `notes.get` holds data with `isInvalidated: false`. The cached search hits include the note and are also not invalidated.
- **Race test:** a `notes.get` that the server answered before the delete, with the response still on the wire, writes the detail back after the delete.

**Fix** (in `useDeleteNote`, as `removeNoteCaches(qc, noteId)` in `lib/notes/cache.ts`)
1. Before the request: `await Promise.all([qc.cancelQueries({ queryKey: getKey, exact: true }), qc.cancelQueries({ queryKey: orpc.notes.search.key() })])`, alongside the existing list patch. This also covers M10's sibling.
2. On success:
   - `qc.removeQueries({ queryKey: getKey, exact: true })`
   - `qc.setQueriesData(search.key(), d => d && { ...d, items: d.items.filter(h => h.noteId !== noteId) })`
   - `void qc.invalidateQueries({ queryKey: orpc.notes.search.key() })`
3. On failure: restore nothing for get or search. They were only cancelled, and the cancel reverts their state.

**Interaction with the in-flight wave**
- `invalidateQueries` refetches active searches with `cancelRefetch`. Any search the server answered before the delete committed is therefore replaced.
- **Test `#6 FIX`** holds both `get` and `search` across the delete. It asserts that `notes.get` is gone, that no hit for the note remains, and that the search is invalidated.

**Regression tests**
- Unit: `lib/notes/cache.test.ts`, the same as `#6 FIX`.
- e2e, `library.spec.ts`:
  1. Open note 1, go back, and delete it.
  2. `page.goBack()` should show the not-found state, not the note.
  3. In ⌘K, search for its title: it should have no result.
