# Brief: animation-expert pass (D28)

Audit every UI motion for QA run **{{RUN_ID}}**. Do not edit product code. Save evidence under
`orchestration/runs/{{RUN_ID}}/artifacts/`; your final reply is the report (no report files).

## Inputs
- `apps/web/e2e/motion/catalog.ts` lists every motion; stylelint's motion rules (`stylelint.config.mjs`,
  run by `pnpm lint`) cover every CSS @keyframes and transition statically.
- Tokens (`apps/web/lib/motion-tokens.ts`, the only source; `styles/motion.css` is generated):
  `springs.spring` (stiffness 400, damping 30, about 455 ms), `springs.springSoft` (260/30, sheets and the
  PiP), `durations.press` 90, `micro` 120, `base` 200, `panel` 300, `cursorMin`–`cursorMax`
  250–450, `clickPulse` 400, `heroReveal` 700; `easings.out/in/cursor/standard`; `press` scales
  0.96 / 0.92 (icons) / 0.98 (rows).
- Spec §11.4; run 16 (the 3D hero); fe carry-overs to judge:
  - m-6: the folder tile gulps before the move is confirmed. Gulp on success only?
  - `.rnum` baseline alignment, and `translate` on `<tr>` (WebKit).
  - Inline-style duration props are not linted, and `step-start`/`step-end` are not banned.

## Procedure
1. `scripts/remote-test.sh ui e2e/motion.spec.ts --project=w1440` (layout and paint
   in each animated subtree, reduced motion), then attach `apps/web/playwright-report/` findings.
2. Frame timing on the Mac (real GPU), under the local lock:
   `bash -c 'until mkdir /tmp/mt-behaviour.lock 2>/dev/null; do sleep 15; done; trap "rmdir /tmp/mt-behaviour.lock" EXIT; MOTION_FRAMES=1 MOTION_VIDEO=1 PW_DEV=1 pnpm --filter @mastertutor/web exec playwright test e2e/motion.spec.ts --project=w1440 --headed'`
   Record the worst frame per motion. Copy the webm clips you cite from `apps/web/test-results/`
   into your artifacts directory.
3. For each motion, judge:
   - **Curve feel:** `spring` settles with no visible second bounce; sheets and PiP use `springSoft`;
     press feedback starts under 100 ms.
   - **Takeover:** frame 1 → 1.01, ring cross-fade, banner spring, cursor fade, exact reversal on hand back.
   - **Cursor:** arc travel 250–450 ms on the cursor easing; click ring 24→44 px over 400 ms.
   - **Reduced motion:** fades or jumps; nothing slides.
   - **The 3D hero (raw three, `components/hero/*`):** the poster cross-fades over 700 ms; it pauses
     offscreen and on a hidden tab; `three` is never downloaded under reduced motion
     (`apps/web/e2e/hero.spec.ts` must pass).
4. Reply with a summary and exactly one ```json qa-report block (`SwarmReport` in
   `apps/web/e2e/stack/qa/findings.ts`): `group: "MOTION"`, `agent: "animation"`, `category: "motion"`,
   evidence inside `orchestration/runs/{{RUN_ID}}/` (webm, mp4, gif, json or png).
