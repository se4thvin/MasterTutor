---
run_id: 2026-10-09-04-research-document-designer
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

# D53b Observer document designer: research report

**What I read.** `CLAUDE.md`; decisions D50, D52 and D53 in `orchestration/STATE.md`; the Observer spec `docs/superpowers/specs/2026-10-09-observer-design.md`; the integration-map report `orchestration/runs/2026-10-09-01-research-observer-integration-map/report.md`. I skimmed the Copilot and Guard research runs (`-02`, `-03`) only where they bear on the designer.

**Code facts that shape the design.**
- `BLOCK_TYPES` in `packages/contracts/src/enums.ts:78-91` is heading, paragraph, list, quote, code, table, math, image, figure, transcript, keyframe, commentary.
- `SOURCE_KINDS` is web, pdf, youtube.
- There is **no "activity" block type yet**, and heading depth exists only as `#` prefixes inside `NoteBlock.markdown`.
- `packages/contracts` already pins `zod 4.6.5` and `openai 7.28.0`, and the wrapper exports `zodTextFormat`.
- The web app has `react 19.3.0` and `motion 14`. `MotionConfig reducedMotion="user"` is already set, and motion tokens live in `apps/web/lib/motion-tokens.ts` (`durations.base = 200`, `panel = 300`).
- Note writes happen in `apps/agent/src/notes/note-writer.ts`. There is already a post-capture refresh step, `refreshNoteQuality` in `packages/db/src/queries/note-quality.ts`.

---

## 0. Recommendation in one paragraph

Build the designer as **a parameterizer of one fixed, hand-built reader, not a generator of UI**:
- **Contract.** A closed-vocabulary `LayoutSpec` (enums only, no strings, no numbers the renderer would interpolate) is defined once in Zod in `packages/contracts`. The four presets are typed constants in the same file.
- **Baseline.** A pure, deterministic rules engine in `packages/observer/src/designer/` turns a metadata-only `NoteStructure` into a preset plus a spec. It also returns a confidence margin. Its spec is written **in the same transaction as the capture's quality refresh**, so the reader almost always opens with the final layout and never swaps.
- **Model call.** `gpt-6-luna` is called only when the rules margin is low and the note is long enough to matter. It goes through the single wrapper with `store:false`, a strict `json_schema` from `zodTextFormat`, minimal reasoning and a small token cap. The result is re-parsed by Zod, cached **by structure fingerprint across notes**, and applied off the hot path. The designer **fails open** to the baseline, unlike the Guard, because it is cosmetic.
- **Late refinements.** These reach an open reader through the existing event stream, not polling. They are applied with React 19.3's stable `<ViewTransition>` only if the person hasn't started reading; otherwise they wait until the next open. With reduced motion they apply instantly.
- **Config language.** Pkl and CUE are not used. JSON Schema is a *derived* artifact of Zod only.

---

## 1. Prior art in generative and adaptive UI

| System | Model | What carries over | What doesn't |
|---|---|---|---|
| **Vercel json-render** | `defineCatalog(schema, { components: { X: { props: z.object(...) } } })`. The model emits a JSON tree restricted to the catalog. Props are Zod-validated. Streams via JSON patches (`createSpecStreamCompiler`). Has `$state` / `$cond` bindings and actions. | Zod-defined catalog, validate before render, "AI can only use components in your catalog". | Tree composition, data bindings, actions and streaming are all unneeded. Our output is about 15 enum knobs, not a component tree. |
| **Google A2UI** | Declarative JSON data, not code. The client keeps a catalog of trusted components and owns styling ("not a robust styling system… client controls styling"). Flat component list with ID refs; `surfaceUpdate` / `dataModelUpdate` / `beginRendering`. | **The client owns styling and security.** The agent states intent; the renderer decides pixels. This is exactly our split. | The incremental tree protocol is unneeded. |
| **MCP Apps (SEP-1865, MCP-UI lineage) / OpenAI Apps SDK** | Arbitrary HTML in a sandboxed iframe (`ui://`, `text/html;profile=mcp-app`). The Apps SDK adds a design-token component library and UX rules (inline first, at most two primary actions). | The Apps SDK lesson: ship a token-based, accessible component kit and keep generated surfaces small. | Open-ended HTML is the opposite of what we want: it needs sandboxing, CSP review and a11y auditing per output. Rejected. |
| **CopilotKit generative-UI spectrum** | Static (agent picks a predefined component) → declarative (agent emits a spec) → open-ended (HTML). | We sit **below "static"**: the agent picks parameters of one predefined layout. That is the safest and cheapest point on the spectrum. | — |
| **Thesys C1 / Crayon** | Hosted, OpenAI-compatible middleware that returns UI components. | Confirms the "LLM picks components from a library" pattern. | A paid hosted API violates the cost constraint. Rejected. |
| **Google Generative UI (Nov 2025 blog; arXiv paper "Generative UI: LLMs are Effective UI Generators")** | Full HTML/CSS generation. Users preferred it to markdown in most comparisons. | Shows models have real layout judgment. | Google itself notes "can sometimes take a minute or more" and "occasional inaccuracies". It also needs heavy system instructions and post-processing. That latency and inaccuracy profile is unacceptable in a reader. |
| **Adaptive-UI HCI research (Gajos et al., CHI 2008)** | Accuracy and predictability of adaptation both raise satisfaction; accuracy had the stronger effect on performance. | (a) Only adapt when confident: the uncertainty gate. (b) Same structure, same layout: determinism via the fingerprint cache. (c) Never rearrange a note under someone who is reading it. | — |

**Failure modes and how this design removes each one:**

| Failure mode | How it's removed |
|---|---|
| Invalid output | Strict structured outputs, then Zod re-parse, then fall back to the baseline. |
| Ugly or inaccessible layout | A finite, pre-audited vocabulary, with every reachable value tested (§2.4). |
| Latency | Off the critical path, persisted at capture time, small output. |
| Flicker on swap | The baseline is persisted first; swaps follow a policy and use View Transitions (§5). |
| Injection | The input has no free text (§6). |

## 2. Constrained-output design

### 2.1 What OpenAI strict mode supports

Strict `json_schema` requires every field to be required and `additionalProperties: false`. It supports `enum`, `anyOf`, and (in current docs) `minimum`/`maximum` and `minItems`/`maxItems`. Composition keywords such as `allOf`, `not` and `if/then` are not supported. There are limits on property count, nesting and enum values; third-party summaries cite 5,000 properties, 10 nesting levels and 500–1,000 enum values `[unverified exact numbers]`. **The first request with a new schema has extra latency, and repeats with the same schema do not.** So keep the schema stable and versioned.

A refusal comes back in a `refusal` field rather than as schema output. Treat it as "keep the baseline".

### 2.2 Proposed vocabulary

It lives in `packages/contracts/src/note-layout.ts`, the one source of truth.

```ts
export const LAYOUT_PRESETS = ["textbook_section","lecture_video","research_paper","article"] as const;
export const LayoutSpec = z.object({
  version: z.literal(1),
  preset: z.enum(LAYOUT_PRESETS),
  density: z.enum(["comfortable","standard","compact"]),
  measure: z.enum(["narrow","standard"]),                  // maps to ~60ch / ~72ch tokens
  outline: z.enum(["none","inline_toc","rail","numbered_rail"]),
  outlineDepth: z.enum(["h2","h3"]),                       // enum, not a number
  figures: z.enum(["inline","wide","margin","gallery"]),
  tables: z.enum(["inline","scroll_card"]),
  math: z.enum(["inline","display_cards"]),
  code: z.enum(["compact","numbered"]),
  activityCallout: z.enum(["card","inset","collapsed"]),
  commentaryCallout: z.enum(["inset","margin"]),
  transcript: z.enum(["timeline_rail","interleaved","collapsed"]),
  studyPanel: z.enum(["end","side_rail","collapsed"]),
  sectionBreak: z.enum(["space","rule","card"]),
}).strict();
export const LAYOUT_PRESET_SPECS = { textbook_section: {...}, ... } as const satisfies Record<LayoutPreset, LayoutSpec>;
```

- **What the model returns.** It returns `LayoutChoice = LayoutSpec.extend({ reason: z.enum([...a dozen codes]) })`, built with `zodTextFormat`. **There is no free-text field**, so there is nothing to sanitize or display, and nothing that could carry a URL, CSS or HTML.
- **Preferred: enums over bounded numbers.** Each enum value maps to a pre-designed token bundle; a number would invite interpolation.
- **Cross-field rules.** For example, `figures:"margin"` needs the margin column. Strict mode can't express these, so they live in a pure `normalizeLayout(spec)` that coerces to the nearest valid value. Responsive collapse is the renderer's job, as `margin-callouts.tsx` already does below 1180px. The model never sees the viewport.

### 2.3 Staying inside the design system by construction

- **Exhaustive renderer mapping.** The renderer maps each enum through an exhaustive `Record<Enum, …>`. TypeScript then fails the build when a value is added without a design.
- **Data attributes, not styles.** The reader root carries `data-density="compact"` and similar, and `styles/note.css` keys off those attributes. The values are never interpolated into `style`, CSS variables or class strings built from model output.
- **No knob chooses a colour, font or duration.** Colours come from the theme tokens (glass, SF Pro stack, light/dark), and motion comes from `motion-tokens.ts`. Contrast is therefore independent of the spec.

### 2.4 WCAG compliance by construction

The vocabulary is finite, so test every reachable value:
- **Exhaustive rendering.** A Playwright fixture note is rendered for each preset × each knob value (one factor at a time, plus pairwise coverage), in light and dark.
- **Automated checks on each render:**
  - axe-core reports zero violations;
  - no horizontal overflow at 320 CSS px (SC 1.4.10 Reflow);
  - the page survives the SC 1.4.12 text-spacing overrides;
  - the measure stays within token bounds.
- **Motion.** SC 2.3.3 (Animation from Interactions) is respected via reduced motion (§5).

Under this scheme, "WCAG-compliant" means every reachable layout was tested, not that the model was trusted.

## 3. Pkl, CUE, JSON Schema or Zod

| Option | Fit | Verdict |
|---|---|---|
| **Pkl** | A typed config language with constraints and `amends` (presets amending a base is conceptually neat). However, the TS bindings (`pkl-community/pkl-typescript`) are **v0 pre-release** ("breaking changes will happen between versions") and **generate types only, not runtime validators**. Evaluation needs the Pkl binary (`PKL_EXEC`). We would still need Zod to validate model output and to produce `zodTextFormat`. That means either two sources of truth (breaks principle 6) or a Pkl → JSON Schema → Zod codegen chain, adding a JVM or native binary to the build for about 60 lines of data. | **No.** This matches D53, which already says "Pkl is not adopted". TS `as const satisfies LayoutSpec` plus object spread gives the same "amend the base" semantics with zero tooling. |
| **CUE** | Strong unification and constraint semantics, but a Go toolchain. TS export exists only through community or experimental tools (`grafana/cuetsy` is self-described "experimental"; `inngest/cuetypescript`). | **No**, for the same reasons. |
| **JSON Schema** | Needed on the wire to OpenAI. | **A derived artifact only**, via `zodTextFormat` / `z.toJSONSchema()` (Zod 4 native). Never hand-written. |
| **Zod 4** | Already the contract language, already in the wrapper. One definition gives TS types, runtime validation, the OpenAI schema, and the DB `jsonb` parse on read. | **Yes.** It is the single source of truth in `packages/contracts`. |

## 4. Deterministic baseline, when to call the model, and measurement

### 4.1 `NoteStructure` input

It is built by pure code in `packages/observer/src/designer/summarize.ts` from the note's blocks. It uses only enums, booleans and **bucketed** counts (log2 buckets). Bucketing improves caching and limits fingerprinting.

- `sourceKind` (from `SOURCE_KINDS`);
- `wordsBucket`, `blocksBucket`;
- per-`BlockType` count buckets;
- `maxHeadingDepth` (1–4), parsed from `#` prefixes locally;
- `hasCaptionedFigures`, `tableHeavy`, `mathDisplayCount` bucket, `codeLanguages` count bucket;
- `hasTimecodes` (from `anchor.tStart`);
- `activityCount` bucket.

**Gap:** there is no activity block type yet. D53a's "activity callouts" must define how an activity is recognised (a new `BlockType` or a flag) before this field can exist.

**Locally derived semantic booleans.** The rules want signals such as "has an Abstract" or "has References", but heading *text* must not leave the process. So pure code matches headings against a fixed word list and sends **booleans only**: `hasAbstractHeading`, `hasReferencesSection`, `numberedHeadings` (for example "3.2"). No text crosses the boundary.

### 4.2 Rules engine (`rules.ts`, pure, under 1 ms)

It scores each preset and returns `{ preset, spec, margin }`:
- **lecture_video:** `youtube`, or any transcript or keyframe blocks. Near-certain.
- **research_paper:** pdf, plus abstract or references booleans, figures with captions, display math or tables.
- **textbook_section:** activities > 0, or numbered headings with depth ≥ 2 on web or pdf.
- **article:** everything else.

Then deterministic refinements on top of the preset:
- `outline: "none"` for short notes;
- `math: "display_cards"` when display math exceeds a bucket;
- `tables: "scroll_card"` when tables are wide (column-count bucket);
- `studyPanel` follows the presence of the study layer.

### 4.3 When to call the model

All four conditions must hold:
1. The rules margin is below a threshold, meaning an ambiguous preset (for example a PDF lecture handout, or a web page with math but no activities).
2. The note is above a length bucket, since short notes don't benefit.
3. No cached model result exists for the same `fingerprint = sha256(bucketed NoteStructure + schema version + preset version)`.
4. The daily designer cap isn't hit.

Because the input space is finite and bucketed, **the cache converges**: model calls tend toward zero over time. A fingerprint cache needs no new table: an indexed `layout_fingerprint` column on notes, looked up `WHERE layout_source = 'model'`. Model outputs that diverge from the rules can be promoted into rules over time.

### 4.4 Measuring whether model layouts beat the baseline

Be honest about sample size: this is a one-owner, small-workspace app. A classic A/B test will not reach statistical power.

1. **Offline paired evaluation (the main gate).**
   - Corpus: about 40 real captured notes across the four source types.
   - Render the rules spec and the model spec side by side, blinded and in random order; the owner picks one (two-alternative forced choice).
   - Ship the model path only if it wins clearly on the *uncertain subset*. A starting bar of at least 60% `[proposal]`.
   - The same harness reruns when prompts or vocabulary change, like `observer-eval`: opt-in, with a spend cap.
2. **Online, within-user interleaving.**
   - On uncertain notes, flip a logged coin between rules and model.
   - The primary signal is the **manual override rate**: the person switches the preset in the reader. That is a direct "the system was wrong".
   - Secondary signals: first-scroll latency, scroll depth, and study-panel use. Treat them as directional only.
3. **Hard gates on every spec**, whatever its source: the §2.4 checks.

## 5. The delayed swap

The main mitigation is to **avoid the swap**:
- The rules spec is computed and stored in the capture's quality-refresh transaction.
- Any model refinement runs asynchronously right after capture, following the run-titler pattern: off-path, with the result applied later.
- By the time someone opens the note, the final spec is usually there.

Swaps only happen when a note is open *while* it is being captured or refined:
- **Delivery.** A `note_layout` event goes over the existing SSE run-event stream, not polling.
- **Apply now only if all hold:**
  - the person hasn't scrolled past the first viewport;
  - there is no active selection, edit, highlight or comment composer;
  - the tab is visible.

  Otherwise, keep the current layout and apply the stored spec on the next open. Never reflow text someone is reading (Gajos; CLS).
- **Mechanics.**
  - Use `startTransition(() => setSpec(next))` inside React 19.3's **stable** `<ViewTransition>`. Only transition-marked updates animate.
  - Same-document View Transitions are Baseline as of October 2025: Chrome/Edge 111+, Safari 18+, Firefox 144+.
  - Keep it to one crossfade or morph within `durations.base`/`panel` (200–300 ms). Animate opacity and transform only.
  - Name moving regions (`view-transition-name` on the study panel and outline rail) so they morph rather than pop.
  - Anchor scroll to the top-visible block id across the swap.
- **Reduced motion.** React's docs don't mention automatic `prefers-reduced-motion` handling for `<ViewTransition>`. So add a `@media (prefers-reduced-motion: reduce)` rule that sets `::view-transition-*` animation to none, giving an instant swap. Whether a View Transition's DOM change registers as a CLS layout shift is `[unverified]`; measure it in the swap test.
- **Interaction during the transition.** The `::view-transition` overlay can intercept pointer input while it runs `[unverified detail]`, which is another reason to keep it short.
- **Cache and invalidation.**
  - Stored per note: `layout_spec jsonb`, `layout_source (rules|model|user)`, `layout_fingerprint`, `layout_version`.
  - A re-capture or block edit that changes the structure changes the fingerprint, which recomputes the rules spec and re-checks model eligibility.
  - A version bump of the schema or presets invalidates lazily: recompute on read when the version differs.
  - The user override (`layout_source = 'user'`) always wins and is never auto-replaced.

## 6. Cost, latency, security and telemetry

- **Model and call shape.**
  - `gpt-6-luna` through `createOpenAI().responses.parse` with `store:false`, as D38 and Observer requirement O13 require. No new tool.
  - Reasoning effort as pinned by the D52 spike (`GUARD_REASONING`): reuse its findings on minimal/none support and latency.
  - `max_output_tokens` around 300 and a timeout of about 4 s `[proposal]`.
  - Static instructions first. The prompt is probably under the 1,024-token prompt-caching threshold `[unverified exact threshold for this model]`, so don't expect cache hits. The strict-schema first-call cost happens once per schema version.
- **Cost.**
  - About 600 input and 150 output tokens per call, on a minority of notes (uncertain and not cached).
  - Prices `[unverified]`: `MODEL_PRICES` is set by the D52 spike.
  - Charge the call to the capturing run's budget, consistent with the Guard rule that usage counts toward the run and the D46 cap.
  - Add a small global designer daily cap as a loop guard.
- **Security.**
  - The input is built by pure code and parsed by a `.strict()` Zod schema.
  - Instead of only the redaction assertion, use a stronger **"no free strings" assertion**: walk the serialized input and require every string to be a member of a known enum and every number to be in range. If not, send nothing.
  - With no text from the page, the prompt-injection surface is effectively nil. Residual risk: a hostile page can shape its *structure* (for example many tables) to steer the preset. The output space is all-safe, so the worst case is a suboptimal but safe layout.
  - The output is enum-only and re-parsed by Zod, the renderer never interpolates it, and the CSP is unchanged.
  - **Fail open.** Any timeout, error, refusal, parse failure or cap keeps the baseline. This is unlike the Guard, which fails closed, because the designer cannot cause harm.
  - Least privilege: run it in the agent beside the run titler (the only place with the wrapper and run budget). It needs no DB rights beyond writing the note's layout columns.
- **Telemetry (D50 conventions, product attribute names defined once).**
  - Span `mt.observer.design` with attributes:
    - `mt.observer.role = designer`;
    - `mt.layout.preset`, `mt.layout.source` (rules|model|cache|user);
    - `mt.layout.margin` (a bucket);
    - `mt.observer.outcome` (ok|timeout|error|invalid|capped|skipped).
  - Metrics: designs by source, model latency histogram, and **override count by source × preset**, which is the key quality metric.
  - A reader counter for swaps applied versus deferred.
  - Spend goes through `recordObserverSpend("designer", usd)`.
  - Allowlist only these attributes. No structure features beyond the preset and the margin bucket.

## 7. Module placement (no cycles)

- **`packages/contracts/src/note-layout.ts`:** `NoteStructure`, `LayoutSpec`, `LayoutChoice`, `LAYOUT_PRESET_SPECS`, `LAYOUT_VERSION`.
- **`packages/observer/src/designer/`:** contracts-only dependencies, all pure except the model call.
  - `summarize.ts`: blocks to `NoteStructure`;
  - `rules.ts`;
  - `normalize.ts`;
  - `fingerprint.ts`;
  - `designer.ts`: rules, then an optional model call through an injected `StatelessOpenAI`.
- **`apps/agent`:** calls the designer after the capture commit, writes the layout columns, and emits `note_layout`.
- **`apps/web`:** reads the spec with the note, maps it to data attributes in `components/note/layout/`, adds the CSS in `styles/note.css`, and implements the swap policy plus a manual "Layout" preset picker.
- **`packages/db`:** the layout columns on notes and an index on `layout_fingerprint`. Migration number comes after 0015.

## 8. Options considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A. Rules only, plus a manual picker | Zero cost or latency, fully predictable | No judgment on ambiguous notes | **Phase 1, ship first.** |
| B. Rules, plus the model when uncertain, fingerprint-cached (recommended) | Judgment where it matters; calls converge toward zero | Small eval and plumbing cost | **Phase 2, gated by the §4.4 offline evaluation.** |
| C. The model on every note | Simple | Cost, latency and nondeterminism hurt predictability | No. |
| D. json-render or A2UI-style component trees | Expressive | Large surface, a11y per output, flicker | No. |
| E. Open-ended HTML (MCP Apps style) | Maximal | Security, a11y, latency | No. |

## 9. Open items for the orchestrator

1. **Activity signal.** How are activities represented? A new `BlockType` or a block flag is needed before `activityCount` can exist. It also touches D53a.
2. **Model call timing.** Confirm the designer runs post-capture in the agent and is charged to the run budget, versus a separate global cap.
3. **Win-rate bar.** Confirm the bar for enabling the model path. Proposed: at least 60% blinded preference on the uncertain subset, with a corpus of about 40 notes.
4. **Mid-read swaps.** Should a deferred refinement ever show a "layout updated" affordance, or always apply silently on the next open? Recommendation: silent, for less bloat.

## Sources

- Vercel json-render: https://github.com/vercel-labs/json-render , https://json-render.dev/ , https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/
- Google A2UI: https://a2ui.org/introduction/what-is-a2ui/ , https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/ , https://github.com/google/A2UI , https://developers.googleblog.com/a2ui-and-mcp-apps/
- MCP Apps / MCP-UI: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- OpenAI Apps SDK UI guidelines: https://developers.openai.com/plugins/concepts/ui-guidelines , https://developers.openai.com/apps-sdk/concepts/ux-principles
- CopilotKit generative-UI types: https://www.copilotkit.ai/blog/the-three-kinds-of-generative-ui , https://www.copilotkit.ai/generative-ui-spectrum
- Thesys C1: https://docs.thesys.dev/guides/how-c1-works
- Google Generative UI: https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/ ; paper summary at https://awesomegenerativeui.com/papers/llms-are-effective-ui-generators (I didn't open the paper's arXiv PDF directly)
- Gajos et al., CHI 2008: https://www.microsoft.com/en-us/research/publication/predictability-and-accuracy-in-adaptive-user-interfaces/
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs , https://openai.com/index/introducing-structured-outputs-in-the-api/ ; limits discussion at https://community.openai.com/t/500-enums-limitation-in-structured-output/974416
- Zod JSON Schema: https://zod.dev/json-schema , https://zod.dev/v4
- Pkl: https://pkl-lang.org/index.html , https://github.com/pkl-community/pkl-typescript , https://github.com/apple/pkl/issues/92
- CUE to TS: https://github.com/grafana/cuetsy , https://github.com/inngest/cuetypescript
- React 19.3 ViewTransition: https://react.dev/blog/2026/09/09/react-19-3 ; Baseline status at https://www.trevorlasn.com/blog/view-transitions-api
- CLS: https://web.dev/articles/cls
- WCAG 2.2 Understanding pages (cited from knowledge, not fetched): Reflow https://www.w3.org/WAI/WCAG22/Understanding/reflow.html , Text Spacing https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html , Animation from Interactions https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
