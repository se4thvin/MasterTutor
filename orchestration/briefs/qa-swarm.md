# Brief: UI validation swarm agent (D22)

You own screen group **{{GROUP}}** for QA run **{{RUN_ID}}**. Do not edit product code, and do not
start, stop or reseed any stack.

## Inputs
- Your shots were already taken (the orchestrator ran `pnpm qa:shoot --group {{GROUP}} --run {{RUN_ID}}`):
  `orchestration/runs/{{RUN_ID}}/artifacts/shots/<screen>/<w1440|w1180|w1024|w820|w390>-<light|dark>.{png,json}`
  plus `summary.json` and `auto-findings.json`. Each JSON lists fe's layout issues (44px targets included), serious or
  critical axe violations, and `errors`: the screen did not open, a 5xx response, or a page error. A screen that did not
  open has no detector results, and its PNG (if any) shows what was there instead.
- Screens: `apps/web/e2e/stack/qa/screens.ts` (`group === "{{GROUP}}"`). Widths come from
  `apps/web/e2e/helpers/breakpoints.ts`.
- Rules: spec §11 (`docs/superpowers/specs/2026-10-05-agentic-notes-design.md`), D22 in `orchestration/STATE.md`.
{{VERIFY_LINE}}

## Procedure
1. Open every PNG with the Read tool. Read scales a tall full-page shot down, so the whole PNG is
   only the overview: for detail (text, 1px edges, focus rings) read crops of at most 1200 px a side,
   made with macOS `sips`, for example
   `sips -c <height> <width> --cropOffset <top> <left> <shot>.png --out <crop>.png`
   (pixels; read the size with `sips -g pixelWidth -g pixelHeight <shot>.png`). Write crops as in
   step 3. For each screen, compare the five widths side by side and check:
   - **Alignment:** baselines, gutters, edges, concentric radii, the 4/8pt rhythm.
   - **Overflow and clipping:** nothing cut off. The D22 trio: the 6th OTP box is visible; the
     struck-out "model" stays on one line; callout leaders never cross the timeline.
   - **Wrapping:** one-word orphans, labels breaking mid-phrase, truncation without a tooltip.
   - **Contrast:** text on glass in both themes, disabled states, focus rings.
   - **Layout rules (spec §11.5):** full sidebar over 1180; icon rail at ≤ 1180 with the browser
     stacked above the timeline; bottom tab bar at ≤ 820; trimmed path at ≤ 420.
2. `auto-findings.json` holds every layout and axe entry as a finding with a stable key: one per
   issue and screen; `selector` is the issue without its measurements; `width`/`theme` are null
   when it shows at more than one; `autoDetected: true`. Copy them into your report **verbatim**:
   do not re-word, re-judge, re-key, split or merge them, or later rounds will not dedupe.
   Your own visual findings use the `screens.ts` id as `screen` and a CSS selector for the element.
3. Crops: write every crop next to the original inside `orchestration/runs/{{RUN_ID}}/artifacts/`
   and cite the crop that shows a finding.

## Reply (your final message is the report; do not write report files)
Reply with a short summary, then exactly one fenced block whose info string is `json qa-report`:

```json qa-report
{ "group": "{{GROUP}}", "agent": "layout", "checked": [{ "screen": "…", "width": 1440, "theme": "light" }],
  "findings": [{ "group": "{{GROUP}}", "screen": "run-otp", "width": 390, "theme": "dark",
    "category": "clipping", "severity": "major", "title": "…", "detail": "…",
    "evidence": ["orchestration/runs/{{RUN_ID}}/artifacts/shots/run-otp/w390-dark.png"],
    "selector": "section.run-otp .cslots-slot:nth-child(6)", "autoDetected": false }] }
```
- `category`: alignment, overflow, clipping, wrapping, contrast, overlap, target-size, a11y, motion, flake, other.
- `severity`: **blocker** (unreachable or unreadable), **major** (visibly broken), **minor** (polish).
- Evidence paths must sit inside `orchestration/runs/{{RUN_ID}}/`. Taste-only opinions are not findings.

## Variant: INTERACTIVE
Group **INTERACTIVE**, `agent: "interactive"`, evidence as gif (claude-in-chrome `gif_creator`) or PNG
under `orchestration/runs/{{RUN_ID}}/artifacts/`.
- You run only after every shooter of this round has finished (P8-22): you may change data, and a
  shot taken after that would show your changes, not the seed. If the orchestrator has not said the
  round's shoots are done, stop and ask.
- Use the claude-in-chrome tools in your own new tab at http://localhost:18080 (an SSH tunnel to the
  remote QA stack, already open). Sign in as the T1 test owner (`apps/web/e2e/stack/support/env.ts` `OWNER`).
- Widths 1440, 1180, 1024 and 820 with `resize_window`. 390 is covered by emulation in fe's w390
  project (`scripts/remote-test.sh ui`); note it in `checked` as `width: 390` only if you used it.
- Check the stateful flows the shooter cannot reach: sheets opening and closing, the approval
  spotlight, ⌘K search, drag-to-move, toasts and Undo, keyboard focus order and visible focus, the
  takeover affordance on `run-live` (the frame is a stub; judge the chrome, not the stream).
- You may change data (move a note, add a vault item); the orchestrator re-seeds afterwards.
- Never type real credentials anywhere.
