# Run 29a: independent verification of agent findings 1–3

Date: 2026-10-06. Read-only: no product code changed.

**Revisions checked**
- HEAD `4ad3623` (agent code as of `664d618`), on branch `agentic-notes-browser-agent`.
- The working tree with the B1 final-fix-wave edits in flight. These include the M10 `TargetDescription.path` binding, the M11 history target and the gate's path check.

**Method**
- One standalone script, `scratchpad/repro.ts`, imports the real modules:
  - `BrowserSession.connect` (with the real network policy in test mode)
  - `ComputerExecutor`
  - `SessionLoopBrowser.targetFor`
  - `needsApproval`
  - `readPage` (as the source of `domHash`)
- The script runs these against local headless Chromium 1243 (the Playwright build) and two `node:http` servers on different ports. `site.fixtures.test:A` and `evil.fixtures.test:B` are mapped to 127.0.0.1 with `--host-resolver-rules`, which makes them two origins.
- The script reproduces both halves of the loop:
  - the approve phase, using `#riskyItems` logic and the `previous` threading;
  - the act-time gate, a line-for-line copy of `#execute`'s gate, with the HEAD variant (kind + label) and the working-tree variant (kind + label + path).
- Each server records every POST, which shows whether the risky side effect really happened.
- Runs:
  - The working tree, with in-process cross-origin frames.
  - The working tree with `--site-per-process --isolate-origins=http://evil.fixtures.test` (out-of-process iframe, OOPIF; one `iframe` CDP target confirmed).
  - A `git archive` of HEAD.
- The script did not use the shared compose DB, the browser slots, or the integration and behaviour suites.

**Side finding: HEAD does not run as committed.**
- Docs commit `a69d02b` also committed a staged rename, `guardrails/untrusted.ts` → `tools/untrusted.ts`.
- At HEAD, `tools/registry.ts`, `loop/run-loop.ts` and `loop/compaction.ts` still import `../guardrails/untrusted.ts`, so the agent fails with ERR_MODULE_NOT_FOUND.
- The in-flight wave fixes these imports.
- For the HEAD run, I copied the file back inside the scratch copy only.
- The fix wave should land in one commit with the rename, or HEAD should be fixed up.

## Finding 1: cross-origin iframe clicks and keys skip approval. Verdict: CONFIRMED

**Code path**
- `hitTestScript` → `deep()` reads `iframe.contentDocument`. For a cross-origin frame this is `null`, or it throws, so the walk stops at the `<iframe>` element.
- `describeTarget(iframe)` returns `{tag:"iframe", label:"" (or the page-chosen title), isFormSubmit:false, interactive:false}`.
- `needsApproval`: `isRiskyLabel("")` is false and the target is not a form submit, so it returns `null`.
- `focusScript` has the same blind spot: for a focused button inside a cross-origin frame, `document.activeElement` is the `<iframe>`, so ENTER and SPACE classify against the iframe.
- `readPageScript` also skips cross-origin frames, so the model sees the button only in the screenshot.

**Evidence (the same in all three runs)**

| Action | Approve phase | Act gate | Server saw |
|---|---|---|---|
| click on "Delete account" in the frame | `iframe:"" need=null` | `need=null` | `POST /effect/iframe-delete acct=victim` |
| ENTER with the in-frame button focused | `iframe:"" need=null` | `need=null` | `POST /effect/iframe-delete` |
| SPACE with the in-frame button focused | `iframe:"" need=null` | `need=null` | `POST /effect/iframe-delete` |

The fix-wave edits (`path`, history targets) do not change this.

**Related, same root cause (not reproduced):**
- `#type` and `#keypress` check `focusTarget()?.isSecretField`, and `armSecretBlock` runs only in the top frame's isolated world.
- So the secret-field typing refusal is likely blind inside cross-origin frames too.
- The fix below closes it with the same mechanism.

**Fix feasibility, probed (`scratchpad/probe.ts`)**
- In-process cross-origin frame:
  - `DOM.getNodeForLocation` on the page session returns the in-frame `BUTTON`.
  - The owner `<iframe>` node carries `frameId`.
  - `IsolatedWorlds.evaluate(hitTestScript, pointInFrame, frameId)` runs inside the frame and returns `{label:"Delete account", tag:"button"}`.
- OOPIF:
  - The page session sees only the `IFRAME` (no `contentDocument`, and `Page.getFrameTree` has no child).
  - `context.newCDPSession(frame)` for the out-of-process frame plus `IsolatedWorlds` on that session returns the button, both for the hit test and for `focusScript`.
  - For an in-process frame, `newCDPSession(frame)` throws "part of the parent frame's session". That is the signal to use the parent session with the child's `frameId`.

**Fix design**
1. In `browser/` (a new `frame-target.ts` next to `hit-test.ts`), add `resolveFrameTarget(session, point | "focus")`.
   - It runs `hitTestScript` or `focusScript` in the top frame. When the script stops at an `IFRAME`/`FRAME` whose document it cannot read, the script returns `{ opaqueFrame: { path, rect } }` instead of describing the iframe.
   - The Node side then:
     - gets the owner's `frameId` (`DOM.describeNode` on the owner via the isolated-world handle, or `DOM.getNodeForLocation`);
     - translates the point by the owner's content box (`DOM.getBoxModel`);
     - re-runs the same script in that frame. It uses the parent CDP session with `frameId` when the frame is in-process. Otherwise it uses the frame's own CDP session (Playwright `Frame` matched by `Page.getFrameTree().frame.id === frameId`), cached per frame target in `BrowserSession`.
   - It recurses to a fixed depth (for example 4).
   - For keys, `focusScript` descends the same way through the focused frame's `document.activeElement`.
2. The returned `TargetDescription` gains `frame: { origin, url } | null`.
   - Its `path` is prefixed with the frame chain, for example `iframe:2@https://evil.example>html>body>button`, so the M10 binding cannot transfer between frames.
   - `approvalRequestFor` puts the frame origin into the label or summary for the human.
3. Fail closed: if any step fails, return a synthetic target `{tag:"iframe", label:"Embedded frame that could not be inspected (<origin>)", opaqueFrame:true, interactive:true}`. Failures include no `frameId`, a detached frame, an attach or evaluation error or timeout, depth exceeded, or a `<frame>`/`<object>`/`<embed>` the code cannot enter.
   - `needsApproval` gains one first rule: `opaqueFrame` plus click, double_click, an ENTER/SPACE keypress with any modifiers, or `type` text containing `\n` → `form_submit` "Act inside an embedded page that could not be inspected".
4. Executor parity: `#keypress` and `#type` use the same resolver for the secret-field refusal and arm `armSecretBlock` in the focused frame's world.
   - `#click`'s snap logic must not snap away from an opaque frame onto a top-level candidate.
5. Lean path: the extra CDP hops happen only when the top-frame script reports an opaque frame. Same-origin pages pay nothing.

**Regression tests**
- State machine (`run-loop.int.test.ts`, `FakeLoopBrowser`):
  - Add `FakeLoopBrowser.focused` (keypress/type currently fall back to `PLAIN_TARGET`).
  - (a) A click whose target is `{frame:{origin:OTHER}, label:"Delete account"}` → `waiting(approval)`, and `browser.executed` stays empty until approved.
  - (b) An `opaqueFrame` target → `waiting(approval)` for click, ENTER and SPACE; after denial, nothing runs.
  - (c) Act-time: after an approval for `frame A>…>button`, the same label and path in frame B are refused with TARGET_CHANGED.
- Real browser (`session-browser.behaviour.test.ts`, slot fixtures):
  - A fixture page on `SITE` that iframes `OTHER/frame-delete.html`.
  - `targetFor(click)` returns `{label:"Delete account", frame.origin:OTHER}`.
  - `targetFor(keypress ENTER/SPACE)` after focusing the in-frame button returns the same.
  - Run both with and without `--site-per-process` (an OOPIF fixture, or `--isolate-origins` on the slot).
  - Simulate an evaluation failure (for example a frame that navigates away mid-resolve) and assert that the opaque fallback requires approval.
- Unit (`policy.test.ts`): opaque-frame rules for each action type.

## Finding 2: Space can submit an ordinary form without approval. Verdict: CONFIRMED

**Code path**
- In `needsApproval`, keypress ENTER or SPACE with a risky label → `risky_click`.
- The generic form rule is `combo === "ENTER" && formKind === "other"`. SPACE on a native submit button labelled "Save" in an `other` form therefore returns `null`.
- A click on the same button does need approval (`isFormSubmit && formKind==="other"`). Keyboard activation is weaker than click.
- Modifier variants normalize to `SHIFT+SPACE` and so on, and neither rule matches them.

**Evidence (HEAD, working tree and OOPIF runs identical)**
- The batch is `click title → type "hello world" → TAB → keypress X`. The approve phase classifies the last key against the input (focus has not moved yet). The act-time gate sees `button "Save"`.

| X | Act gate | Server saw |
|---|---|---|
| SPACE | `need=null` | `POST /effect/space-save title=hello+world` |
| SHIFT+SPACE | `need=null` | `POST /effect/space-save` |
| CTRL+SPACE | `need=null` | `POST /effect/space-save` |
| ALT+SPACE | `need=null` | `POST /effect/space-save` |
| ENTER (control) | `need=form_submit` | stopped; nothing sent |

- SPACE with focus already on Save submits as well.
- A click on Save → `form_submit`.
- `type "hello world"` (a space in a text field) stays ungated, as required.

**Fix design** (in `guardrails/policy.ts`, one source of truth)
1. Extract `activationNeed(target, action)`: risky label → `risky_click`; else `isFormSubmit && formKind==="other"` → `form_submit`. Click and double_click call it directly.
2. For a keypress, strip modifiers from `normalizeCombo` (`combo.split("+").at(-1)`) to get `key`.
   - If `key` is `ENTER` or `SPACE`, return `activationNeed(...)`, so Space and Enter on a submit control equal a click, with any modifiers.
   - Then keep the existing implicit-submission rule, widened to modifiers: `key === "ENTER" && formKind === "other"` (Enter in any field of the form).
   - SPACE on an editable text field, checkbox or radio does not match `isFormSubmit`, so typing a space stays ungated.
3. `type` stays as it is: a space in text is never an activation.
4. Not covered, which is acceptable: `type="button"` with a JS submit and a non-risky label. That is the same gap as click today, so it is not a keyboard-specific bypass.

**Regression tests**
- Unit (`policy.test.ts`):
  - SPACE, SHIFT+SPACE, CTRL+SPACE, ALT+SPACE, META+SPACE and SHIFT+ENTER on `{isFormSubmit:true, formKind:"other", label:"Save"}` → `form_submit`.
  - SPACE on `{editable:true, formKind:"other"}` → `null`.
  - SPACE on `login`/`search` submits → `null` (click parity).
- State machine (`run-loop.int.test.ts`, with `FakeLoopBrowser.focused` driven by `actionHook` on TAB):
  - (a) Batch `[click field, type "a b", TAB, SPACE]`, where TAB moves fake focus to Save. The approve phase passes, but the act-time gate stops before SPACE. `executed` holds three actions, and the next turn's result tells the model to ask.
  - (b) SPACE with focus already on Save → `waiting(approval)`; approved → executed; denied → not run.
  - (c) `type "hello world"` into the field → no approval step.
- Real browser (`computer.behaviour.test.ts` or `session-browser.behaviour.test.ts`): use the `form-post.html`-style fixture to assert that `targetFor(SPACE)` after TAB is the submit button, and that `needsApproval` is non-null for each Space variant.

## Finding 3: an approval is reused on a different record at the same target path. Verdict: CONFIRMED (not fixed by M10)

**Code path**
- `domHash` is `readPage(interactive).hash`: the sha256 of url, title and the interactive manifest (tag, role, name, attrs, point).
- A record's identity in static text ("Alice" in a `div`) is not in that manifest. A fixed-position Delete button has the same name, point and path.
- On resume, `obs.url !== pending.url || obs.domHash !== pending.domHash` therefore passes.
- The act-time gate then matches:
  - kind `risky_click`, label `"Delete"`;
  - in the working tree, also `path "html>body>button"`.

**Evidence (all runs)**
- Approval requested with the record showing "Alice": `domHash 1d1cc7a1…`.
- The page then shows "Bobby": `domHash 1d1cc7a1…` (unchanged), so the resume does not supersede.
- Gate: `need=risky_click`, decision matched, executed.
- Server saw `POST /effect/delete Bobby`.
- The working-tree M10 path binding does not help: the path is identical.

**Fix design**
1. `describeTarget` gains `context: string`, a digest of the target's record context.
   - The page script returns the raw context text, and `hit-test.ts` hashes it with sha256 on the Node side at once. Raw text never leaves the browser module.
   - The page does not choose a weak hash: page content is adversarial, so the hash must resist collisions.
   - Context text is the visible `innerText`, whitespace-normalized and capped (for example 16k chars), of:
     - (a) the nearest record container: `tr, [role=row], li, [role=listitem], article, [role=article], dialog, [role=dialog], fieldset, form, section, [role=region], [aria-selected=true]`;
     - (b) plus the `main`/`[role=main]` landmark, or `body` when there is none. This catches fixed toolbars acting on "the current record", which is exactly the repro: the button has no record ancestor.
   - Live regions are excluded to limit noise: `[aria-live]`, `[role=status|timer|log|marquee|alert]`, `<time>`.
   - The digest also covers the frame URL (with the finding-1 frame chain) and the top-level `location.href`, including query and hash, since SPAs carry record ids there.
2. Bind it:
   - `RiskyItem`, `ApproveStepResult` and `ItemDecision` gain `context` (nullable, defaulting to null for old rows, like `target`).
   - The act-time gate requires `decision.context === target.context` in addition to kind, label and path. On mismatch it gives TARGET_CHANGED and no action.
   - This keeps the gate the single authoritative check, so `domHash` keeps its loop-detection meaning.
3. Human UX (optional, small): add a short, clipped excerpt of the record container text to the `risky_click`/`form_submit` request, so the approver sees "Delete — Alice …". It goes only to the approvals UI, never to the model.
4. Trade-off: a page with visible churn in `main` (counters, tickers) will re-ask after a slow approval. That is fail-safe; measure it in the B1 benchmarks before narrowing the context.

**Regression tests**
- State machine (`run-loop.int.test.ts`):
  - (a) The M10-style test with `risky("Delete", "html>body>button", context:"h(Alice)")`. `browser.actionHook`, or a mutation while `waiting(approval)`, swaps the context to `h(Bobby)` with the same path, label and domHash. After `decideApproval(approved)` and resume, `browser.executed` is empty and the model gets TARGET_CHANGED.
  - (b) An unchanged context → executes once.
  - (c) The same record but a URL changed only in the hash or query (`#/users/1` → `#/users/2`) → refused.
- Real browser (`session-browser.behaviour.test.ts`): a fixture with a fixed-position Delete and a `#record` div. `targetFor(click).context` differs after `textContent = "Bobby"`, while `readPage().hash` is equal, which documents why `domHash` is not enough. A changing `<time>` element does not change `context`.
- Unit: rebuilding the decision from `ApproveStepResult` keeps `context` across restore (the `approvals.ts` schema default for old rows).

## Artifacts
In `/private/tmp/claude-501/-Users-sethvin-nanayakkara-orca-workspaces-MasterTutor-houndshark/da9cab1f-0477-48e7-b492-c59001c21006/scratchpad/`:
- Scripts: `repro.ts` and `probe.ts`.
- Results: `wt.json` (working tree), `oopif.json` (working tree with OOPIF) and `head.json` (HEAD).
