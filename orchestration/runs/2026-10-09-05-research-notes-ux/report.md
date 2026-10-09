---
run_id: 2026-10-09-05-research-notes-ux
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

# MasterTutor notes redesign: research report on reading, study, highlights, rendering and motion

## Executive summary

These ten recommendations are ordered by impact. The current web app already ships client-side KaTeX 0.19, client-side highlight.js, `motion` 14, CSS `linear()` spring tokens, React Bits files under `components/bits` and a zip exporter in `packages/contracts/src/export`. The recommendations build on that.

1. **Render note Markdown to HTML on the server and cache it by block `contentSha256`.**
   - The browser then ships no JavaScript for KaTeX or code highlighting, only the KaTeX CSS and fonts.
   - This replaces the current lazy chunk in `rich-plugins-loader.ts` and is the largest latency and bundle win available.
2. **Keep KaTeX** (not MathJax). Keep highlight.js, but run it on the server. Consider Shiki only if you want VS Code-grade grammars and dual themes; once rendering is server-side it costs no client bytes.
3. **Reading column:**
   - Body text uses the system font stack (`system-ui, -apple-system`), not SF Pro served as a webfont.
   - Body size is 17px (mobile) to 19px (desktop), line-height about 1.55, and width capped at about 66ch.
   - Use `text-wrap: pretty` for body text and `balance` for headings.
   - Add `content-visibility: auto` per section instead of virtualising.
4. **Liquid Glass belongs only to the floating toolbar, outline and sheets, never to the text.** This is Apple's own rule.
5. **Highlights:**
   - Anchor to the block, then to a W3C TextQuoteSelector (with 32-character prefix and suffix), then to a TextPositionSelector within the block.
   - Re-anchor after re-capture using a content-hash match first, then fuzzy matching in the Hypothesis style with `approx-string-match` (MIT).
   - Draw highlights with the CSS Custom Highlight API, which never changes the DOM and is Baseline since Firefox 140.
6. **Spaced repetition:** use `ts-fsrs` (MIT, FSRS-6) on the server with desired retention 0.9. Leave the optimiser out of v1.
7. **Study layer grounding:**
   - One generation call per note version, under an OpenAI strict JSON schema.
   - Every item must give `{blockId, quote}` evidence.
   - The server keeps an item only if the quote appears verbatim (after normalisation) in the cited block; otherwise it drops the item.
   - Items whose cited block hash later changes are marked stale.
8. **AI content lives in its own table, on its own surface, under its own label**, and exports as an Obsidian callout. It never becomes a `NoteBlock`, not even with `origin: "model"`.
9. **The Observer layout spec is an enum-only schema**: preset, a few toggles and numeric values within fixed ranges. It never contains free CSS or class names, so the layer that reads page content cannot inject styling.
10. **Motion:**
    - Use only the existing spring tokens, plus a scroll-driven progress bar in CSS (`animation-timeline: scroll()`, no JavaScript).
    - Figure zoom reuses `motion` layout animation inside a native `<dialog>`, so it needs no lightbox dependency.
    - React Bits text reveals belong only on the library and empty states, never on note text.

---

## 1. Best-in-class reading and notes UX

### 1.1 What the reference products do

| Product | Pattern worth taking | Notes |
|---|---|---|
| **Readwise Reader** | Paragraph focus mode: the current paragraph is lit and the rest greyed. Keyboard-first: `h` highlights the focused paragraph, `n` highlights and opens a note, `[`/`]` hide the side panels, ⌘K command palette. Progress can show as %, page, or time left. Ghostreader is an AI copilot kept separate from the document. Obsidian export uses templates and stable highlight IDs. | Its paragraph-level, keyboard highlighting maps directly onto your block model. |
| **Matter** | Highlighting with no pop-up menu (drag over the text, done). Rebuilt in 2025 on Liquid Glass with native components, keeping the chrome minimal. | Shows that a reading app can adopt glass while keeping it in the chrome. |
| **Instapaper / Apple Books / Safari Reader** | A few typography presets (font, size, theme) rather than free sliders; colour-coded highlights with notes (Books). | [unverified, from product knowledge] |
| **Obsidian** | Callouts (`> [!type]±`, foldable with `+`/`-`, nestable) and `==highlight==` syntax. | Your activity callouts and AI-summary export should use callout syntax. |
| **Notion / Craft / Bear** | Notion: a toggleable TOC block and quiet hover handles on blocks. Craft: card and page nesting, very soft chrome. Bear: tag sidebar and typography-first writing. | [unverified, from product knowledge] Useful mainly for the library and organisation patterns. |
| **iA Writer** | Pick body size from reading distance; about 140% leading for screen text. Responsive type that changes size with window width rather than reflowing. | |
| **Medium** | A floating tooltip when text is selected (highlight, respond, share); "top highlight" underlines. | [unverified] Treat the selection tooltip as a pattern only. |
| **Arc reader mode** | A hidden ⌥⌘R reader that appears to have been removed. Not a useful reference. | |
| **Stripe Press web** | Editorial, book-like typography with large measure-controlled serif text and restrained motion. | [unverified]: no primary source retrieved. |
| **Distill.pub** | A layout grid of `l-body`, `l-middle`, `l-page` and `l-screen`, plus a `l-gutter` for marginalia. Footnotes and citations show as hover cards. | The best model for "research paper" and "textbook" presets. |
| **Tufte CSS** | Sidenotes and margin notes are built from a label and checkbox, so they need no JavaScript. On narrow screens they collapse into tap-to-reveal. Full-width figures and margin figures. | Gwern's survey: use Tufte-style sidenotes for lightly annotated text and JavaScript-positioned sidenotes for dense text, and avoid any pattern that forces a click to read every note. |

### 1.2 Reading measure and line height (evidence)

**Line length**
- Dyson and Haselgrove found 55 characters per line read faster than 25 or 100 cpl.
- The literature reviews converge on 45–75 cpl. Readers prefer short to medium lines even when longer lines are scanned faster.
- WCAG 1.4.8 (AAA) caps line width at 80 characters.

**Spacing**
- WCAG 1.4.8 asks for line spacing of at least 1.5 and paragraph spacing of at least 1.5× the line spacing.
- WCAG 1.4.12 (AA) requires that layouts survive when users override spacing.

**Recommendation**
- `max-inline-size: 66ch` (range 60–72) for prose.
- Code, tables and wide figures may break out to an `l-middle` width.
- `line-height: 1.55` for body, `1.2` for headings, paragraph gap about `0.9em`.
- Do not fully justify text (WCAG 1.4.8).

### 1.3 Type scale (Apple HIG)

**Font**
- Apple's licence allows SF Pro only for UI mockups, not as a webfont. Use `font-family: system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif`. Apple devices then get real SF Pro, including optical sizing; others fall back to Inter (OFL) or the platform UI font.
- Safari supports `font: -apple-system-body` (and the other text styles), which follows iOS Dynamic Type. One option is to set `html { font: -apple-system-body }` under `@supports`, so the reader's chosen size on iPhone and iPad is respected.

**Scale.** HIG defaults are Large Title 34, Title 1 28, Title 2 22, Title 3 20, Headline 17 semibold, Body 17, Callout 16, Subhead 15, Footnote 13, Caption 12/11. For a reading surface:

| Role | Size | Weight | Line height | Letter spacing |
|---|---|---|---|---|
| Note title (H1, shown once) | clamp(28px, 4vw, 34px) | 700 | 1.15 | −0.02em |
| H2 | 22px | 650 | 1.25 | |
| H3 | 19–20px | 600 | 1.3 | |
| Body | 17px (mobile), 18px (tablet), 19px (desktop ≥1280) | 400 | 1.55 | ≈ −0.01em at 17px (Apple tracks body slightly tighter) |
| Callout, aside, sidenote | 15–16px | — | — | — |
| Provenance and caption | 13px | — | — | tabular numerals |

- A light serif option (New York is also system-only; use `ui-serif`) is a cheap, high-delight reader preference. `ui-serif` resolves to New York on Apple devices [unverified that WebKit maps `ui-serif` to New York on all OS versions].

### 1.4 Outline, TOC and scroll-spy

**NN/g guidance**
- A sticky TOC helps on long content and should highlight the current section.
- Many users fail to notice a sticky TOC at all, so it needs a visible affordance.

**Recommendation**
- **Desktop:** a left-rail outline, glass, made only of H2 and H3 entries. The active section is marked by a small bar that slides between entries (one shared element using the `--motion-spring` transform).
- **Mobile:** an outline button in the glass toolbar that opens a sheet.
- **Scroll-spy:** one `IntersectionObserver` over the headings, with `rootMargin: "0px 0px -70% 0px"`, updating state only when the active id changes. Avoid scroll listeners.
- **Mark sections that have content inside them:** show a highlight dot on sections that contain the user's highlights, and an activity dot on sections that contain activity callouts.

### 1.5 Figures and lightbox

- Number figures and tables per note; caption below the image in 13–15px secondary text.
- Show figures at `l-body`. Allow `l-middle` breakout when the asset's intrinsic width is more than about 1.3× the text column.
- **Zoom:** click opens a native `<dialog>`. The image animates from its place in the text to the dialog with the existing `motion` layout animation (`layoutId`), costing no new bytes.
  - Inside the dialog, show the image at natural resolution in a scrollable container, so pan comes free and mobile pinch-zoom is native.
  - Close with Esc, by tapping the backdrop, or by swiping down.
  - Respect `prefers-reduced-motion` (a cross-fade only). `<dialog>` provides focus trapping and top-layer rendering.
- **Library alternatives if needed:**
  - `react-medium-image-zoom` (no dependencies, single image).
  - PhotoSwipe v5 (galleries and gestures; its core can be loaded on demand).
  - Neither is needed for v1.
- **Dark mode:** transparent PNG or SVG diagrams with black strokes disappear on dark backgrounds. Put figures on a light matte (`background: #fff; border-radius: 10px; padding: 8px`) in dark mode. Do not invert images.

### 1.6 Sidenotes versus footnotes; quiet provenance

**Sidenotes or footnotes**
- **Wide screens (≥1200px):** render source footnotes and margin callouts as sidenotes in the right gutter (CSS grid column, Tufte-style, no JavaScript positioning). Your blocks are short, so sidenotes collide rarely.
- **Narrow screens:** use a tap-to-reveal inline note (Tufte checkbox pattern, or `<details>`). Never use a hover-only reveal.

**Provenance should stay quiet**
- **Per block:** nothing visible at rest.
  - On hover or focus a hairline-ringed `⌁` icon appears in the left gutter. Clicking it opens the existing `provenance-popover`: source, anchor, timecode or page, verified/partial state, and an "open at source" link that uses the text fragment `#:~:text=`, which works in Chromium, Safari ≥16.1 and Firefox ≥131.
  - Partial blocks get a persistent but low-contrast dashed left rule in the gutter. Do not tint the text; fidelity should be visible without shouting.
- **Per note:** a single source strip under the title (favicon, domain, capture date, "n of m blocks verified") stands in for per-block noise.
- **Video:** timecodes sit in the left gutter as tabular-numeral chips that seek the player. This follows Distill's gutter idea.

### 1.7 Reading progress, focus mode, dark mode

**Progress**
- A 2px bar in the toolbar driven by `animation-timeline: scroll()` (Chrome 115+, Safari 26; Firefox stable still lacks it). Feature-detect with `CSS.supports`; Firefox gets a static bar or a throttled `IntersectionObserver` on headings.
- "Time left" = words remaining ÷ about 238 wpm (Brysbaert 2019 silent reading of non-fiction [figure from memory; the primary source was paywalled]).
- Persist the last read block id per note, not a scroll pixel offset, so it survives layout changes.

**Focus mode** (Readwise pattern)
- Hide the rails and dim the other blocks to 35% opacity.
- `j`/`k`/Space move the focused block; `h` highlights; `n` adds a comment. The dimming is an opacity transition, which runs on the compositor.

**Dark mode**
- Use about `#e8e8ea` text on about `#1c1c1e` (Apple secondary system background), not pure white on pure black. On OLED, pure black with pure white text blooms (halation).
- Body weight can go up slightly in dark mode. With variable SF, use `font-weight: 430–450` under `@media (prefers-color-scheme: dark)`. Evidence is mixed (one study found the weight effect non-significant), so make this a subtle tweak only.
- Readability Consortium work found light mode is read reliably faster, so default to the system setting, offer light, sepia and dark, and keep light polished.

---

## 2. Study tools

### 2.1 Spaced repetition: FSRS

**The algorithm**
- FSRS models difficulty (D, 1–10), stability (S, the interval at which recall probability is 90%) and retrievability (R).
- The FSRS-6 forgetting curve is `R(t,S) = (1 + factor·t/S)^(−w20)`, with 21 trainable parameters. Same-day reviews have their own stability update.
- Anki has shipped FSRS since 23.10.
- Benchmark: on about 10k collections and 350M reviews, FSRS-6 has lower log loss than SM-2 in 99.6% of collections. Simulations claim 20–30% fewer reviews for the same retention [secondary sources].

**Library: `ts-fsrs`** (MIT, FSRS-6, ESM/CJS, Node ≥20)
- API: `createEmptyCard()`, `fsrs(params)`, `f.repeat(card, now)` to preview all four ratings, `f.next(card, now, Rating.Good)`.
- The optimiser exists as `@open-spaced-repetition/binding` (Rust). Leave it out of v1; the default parameters are good until a user has hundreds of reviews.
- Run it in the web app's server action that records a review (it is pure functions, needs no queue, and is cheap).
- Store the card state columns (`due`, `stability`, `difficulty`, `reps`, `lapses`, `state`, `last_review`) plus a `review_log` table. The log is what a later optimiser would need.

**Settings for v1:** `request_retention: 0.9`, `enable_fuzz: true`, short-term learning steps on, `maximum_interval` default.

**Other products**
- **RemNote:** Concept/Descriptor framework; bidirectional concept cards; can schedule with SM-2 or FSRS. Worth copying: mark key terms as two-way cards.
- **Quizlet Learn:** "guidance fading", where question types move from multiple choice towards written recall as mastery grows. Worth copying for the quiz mode.
- **Khanmigo:** Socratic tutoring that withholds answers and gives hints in steps. Relevant for a later "explain it back" mode; out of scope now.
- **NotebookLM** (Sept 2025): flashcards and quizzes with adjustable topic, difficulty and count, where every item cites back to its source location. This is the bar for grounding.

### 2.2 Learning-science basis and what to generate

| Technique | Evidence | Feature it supports |
|---|---|---|
| Retrieval practice / testing effect | Roediger & Karpicke 2006: tested recall beat re-reading at one week (61% vs 40%). Adesope et al. 2017 meta-analysis (272 effect sizes): g = 0.51 versus restudy, 0.93 versus no activity; multiple choice gave strong effects; matched test formats were better. | Flashcards and quizzes, the core of the study layer |
| Distributed practice | Dunlosky et al. 2013: high utility (as is practice testing) | FSRS scheduling |
| Elaborative interrogation and self-explanation | Dunlosky: moderate utility | "Why does…?" Q&A cards; optional free-text "explain" prompts |
| Highlighting and re-reading | Dunlosky: low utility | Highlights are for capture and export, not the study engine. Offer "turn highlight into card". |
| Dual coding / multimedia principle | Mayer: people learn more from words and pictures than from words alone | Figure-occlusion cards and figure-anchored questions (use the captured figure assets) |
| Generation effect | Matuschak: you remember better what you generated yourself | Cards are AI-drafted and user-adopted. The default flow is "Review suggested cards → keep, edit or drop", not auto-adding to the deck. |

**Card quality rules** (Matuschak): focused, precise, consistent, tractable (about 90% answerable) and effortful. Use cloze for lists, definitions and formulas, with one deletion per card, and Q&A for concepts. Put these rules verbatim into the generation prompt and also check them mechanically: limit answer length, require one blank per cloze, reject an answer that appears in its own question.

**What to generate per note** (one call, cached by note version hash):
1. **Summary:** 3–6 bullet points, each with its cited block ids.
2. **Key terms:** term, definition and cited block. Each becomes an optional two-way card.
3. **Cards:** Q&A and cloze, about 1 per 150–250 words of source, capped at about 30.
   - Math cards keep TeX; KaTeX renders it.
   - Figure cards reference an `assetId` and never generate an image.
4. **Quiz:** 5–10 items, mostly multiple choice (best supported for the testing effect) plus some short answer, each with an explanation and a cited block.

### 2.3 Grounding: preventing hallucination

1. **Input.**
   - Send only verified and partial blocks as a numbered list (`[b:<id>] text`). Partial blocks are marked so the model can down-weight them.
   - Activity callouts and agent commentary are excluded; they are not source text.
2. **Prompt-injection hygiene** (page text is untrusted).
   - The text sits inside a clearly delimited, data-only section.
   - The call has no tools, no browsing and no URLs in its output.
   - Output is constrained by the schema, and the renderer treats every generated string as plain text plus KaTeX only. No raw HTML, no links.
3. **Output schema** (OpenAI Structured Outputs, `strict: true`).
   - Every item has `evidence: [{blockId, quote}]` with `minItems: 1` and a short `quote` length cap.
   - Constrained decoding guarantees the shape of the output, not that it is true.
4. **Server check.**
   - Normalise whitespace, Unicode and Markdown markup, then require `quote` to be a substring of the cited block's plain text. Use a small fuzzy tolerance, at most about 3% edits, via the same Myers matcher as highlights.
   - The cited block must belong to this note version.
   - Drop items that fail. Optionally re-ask once for that item only.
5. **Answer check.** For cloze and key-term items, also require the answer span to occur inside the quote. This is a cheap, deterministic way to catch made-up answers.
6. **Staleness.** Store the cited block `contentSha256` on each item. If the user edits a block or a re-capture changes it, mark the items that cite it stale ("Source changed — regenerate?"). Never update them silently.
7. **Display.** Every summary bullet, card back and quiz explanation carries a citation chip that scrolls to and flashes the source block.

### 2.4 Labelling AI content honestly

- **Separate surface:** a "Study" tab or right panel, never mixed into the note column.
  - A permanent `✦ AI-generated from this note` label.
  - The model name and generation date in the panel footer.
  - The surface has a distinct tint (for example a faint accent wash), and the faithful note never uses that tint.
- **Separate data:** a `study_set` table with an item table. Study items are never `NoteBlock`s. The existing `origin: "model"` block origin does not apply here, and reusing it would blur the "faithful 1:1" guarantee.
- **Separate export:**
  - The AI summary exports as `> [!abstract]- AI summary (generated <date>, <model>)` in Obsidian.
  - Cards export as a separate file (an Anki-importable TSV or CSV is a cheap option).
- **When the user edits a generated item,** it stays AI-labelled with an "edited" marker. This mirrors `edited` / `originalMarkdown` on blocks.
- **Regulation:** EU AI Act Article 50(4) applies from 2 Aug 2026 and covers AI text *published to inform the public on matters of public interest*. Private study material most likely falls outside it [legal interpretation, unverified]. The provider marking duty in 50(2) falls on OpenAI, not you. Labelling everything anyway costs nothing and fits D53.

---

## 3. Highlights and comments

### 3.1 Anchoring model (W3C Web Annotation plus your blocks)

- **Standard:** the W3C Web Annotation Data Model (Recommendation, Feb 2017) defines `TextQuoteSelector` (`exact`, `prefix`, `suffix`), `TextPositionSelector`, `RangeSelector` (with `startSelector` and `endSelector`), `refinedBy`, the State types, and motivations including `highlighting`, `commenting` and `bookmarking`.
- **How Hypothesis re-anchors** (it stores three selectors and tries four strategies):
  1. RangeSelector (XPath) checked against the quote.
  2. TextPositionSelector.
  3. Context-first fuzzy match: find the prefix and suffix fuzzily, then check the text between them.
  4. Fuzzy match on the quote alone.
  - It uses diff-match-patch (Bitap) and Myers diff with 32-character context. Its current client uses `approx-string-match` (MIT, Myers bit-parallel) by Robert Knight.
- **Apache Annotator** has been inactive for about 5 years. Don't depend on it; the logic is small enough to own.

**Recommended contract** (defined once in `packages/contracts`, compatible with W3C so export is trivial):

```ts
Annotation = {
  id, noteId, motivation: "highlighting" | "commenting",
  color: enum(5), body?: string (comment, sanitized, max len),
  target: {
    start: { blockId, blockSha256, offset },   // offset in block plain text
    end:   { blockId, blockSha256, offset },   // same block for most highlights
    quote: { exact, prefix /*32*/, suffix /*32*/ } // W3C TextQuoteSelector
  },
  state: "anchored" | "fuzzy" | "orphaned", createdAt, updatedAt
}
```

**Re-anchoring after re-capture or edit**, done on the server once per new note version (not on every render):
1. Find a block in the new version with the same `contentSha256`. If found, reuse the offsets (exact match).
2. Otherwise, find a block at the same position or of the same type whose text contains `exact` with matching prefix and suffix. Score as Hypothesis does.
3. Otherwise, run a fuzzy search over the whole note: `approx-string-match`, maximum errors about `min(32, ⌊len/4⌋)`, with prefix and suffix as tie-breakers. Mark the result `fuzzy` and show a small "re-attached" badge.
4. If nothing matches, the annotation becomes `orphaned`. Orphans appear in an "Unattached highlights" tray with their quote and comment, never silently deleted.

**Rendering**
- Use the **CSS Custom Highlight API** (`CSS.highlights.set(name, new Highlight(...ranges))` with `::highlight(name)`). It is supported in Chrome 105+, Safari 17.2+ and Firefox 140+.
- It adds no `<mark>` wrappers, so React reconciliation, KaTeX HTML and copy-paste of the faithful text are untouched.
- Caveat: Firefox ignores `text-decoration` on highlights, so use `background-color` only.
- **Hit-testing:** `highlightsFromPoint()` is not Baseline. Use `document.caretPositionFromPoint` (or `caretRangeFromPoint`) and compare against the stored ranges, or show the comment marker in the gutter.

### 3.2 UX patterns

- **Making a highlight:**
  - Select text and a small glass pill appears above the selection (five colour dots, comment, "make card").
  - Keyboard: `h` highlights the focused block (Readwise), `n` highlights and comments.
  - On touch, use the native selection then the pill. Matter's no-menu drag is desirable but conflicts with native selection on the web [design judgement].
- **Comments:**
  - Wide screens: margin cards in the right gutter, aligned to the block, sharing the sidenote column.
  - Narrow screens: a dot in the gutter that opens a bottom sheet.
- **"Highlight → card":** prefills a cloze from the highlighted span, tying low-utility highlighting into high-utility retrieval.
- **Note header:** a highlights count and filter ("show only my highlights").

### 3.3 Export to Obsidian

Readwise's export uses blockquotes plus a stable `^id` per highlight for block references. Recommended note export, extending `buildNoteMarkdown`:
- **Faithful body unchanged by default.** Optionally (a user setting), wrap highlighted spans inline with `==…==`. Only do this when the span sits within a single paragraph and contains no math or code.
- **A `## Highlights` section** after the body. Each entry is:
  - `> quote` followed by ` ^hl-<shortid>`;
  - the comment on the next line;
  - a link back to the heading: `[[#Heading]]`.
- **Comments on the inline option** can also become footnotes `[^c1]`.
- **The AI summary** goes in a folded `[!abstract]-` callout, labelled as generated.

---

## 4. Rendering technology (bloat-aware)

| Need | Options | Recommendation |
|---|---|---|
| **Math** | KaTeX: about 277 kB min JS, 24 kB CSS, about 350 kB fonts (loaded per glyph set); fast, synchronous, server-side rendering friendly. MathJax: much larger (about 1.6 MB per one comparison); broader LaTeX, MathML-first, good screen readers. Native MathML Core: shipped in browsers but output varies across engines. | **Keep KaTeX, render on the server** (`renderToString` via rehype-katex in an RSC or at block write time), with `output: "htmlAndMathml"` (already set) so screen readers get MathML. The client loads only the CSS and fonts. Caveat: server-rendered KaTeX HTML is verbose (one example: 10 kB → 50 kB), but it compresses well. |
| **Code** | highlight.js: core about 8 kB gzip, about 0.3–2.5 kB per language, regex-based. Prism: about 2 kB core, regex, client-oriented. Shiki: TextMate/VS Code grammars, best accuracy, CSS-variable dual themes; heavy on the client (about 695 kB gzip web bundle, a 145 kB WASM engine or a 20 kB JS engine, 5–16 kB per language) but **no client JS when rendered on the server**. | **Run highlight.js on the server** (current language allow-list, `detect: false`), with tokens styled by your CSS tokens for light and dark. Switch to Shiki (`shiki/core` with the JS regex engine and a fine-grained language set) only if fidelity complaints appear; the swap affects the server only. |
| **Where Markdown renders** | Current: client react-markdown, with heavy plugins loaded lazily per block. | Use a **React Server Component** that renders `markdown → sanitised HTML` and memoises by `contentSha256` (an LRU in process, or a cached `html` column). Client islands remain only for the interactive parts: provenance button, highlights layer, zoom. This removes about 300+ kB of potential client JS and the flash where math appears late. Sanitisation (`rehype-sanitize`) stays before KaTeX and highlighting, as now. |
| **Figure zoom** | medium-zoom, react-medium-image-zoom, PhotoSwipe v5 | **None.** Use native `<dialog>` plus the existing `motion` `layoutId`. |
| **Long documents** | Virtualisation (TanStack Virtual etc.) breaks find-in-page, anchor links, scroll-spy, text fragments, highlights and screen-reader navigation, and needs measured heights for KaTeX and figures. | **`content-visibility: auto; contain-intrinsic-size: auto 600px`** per section wrapper (H2 group). It is Baseline since Sept 2024 and keeps content in the DOM and accessibility tree, available to find-in-page. Reported restyle and layout savings range from about 87% to hundreds of milliseconds. Virtualise only if a note exceeds about 5k blocks (measure first). |
| **Print / PDF** | Paged.js (MIT, a paged-media polyfill, adds weight); server-side Chromium `page.pdf()` (you have browser slots, but that crosses a privilege boundary); a print stylesheet. | **Print stylesheet plus the browser's own "Save as PDF".** In `@media print`: hide the chrome, glass and study panel; `break-inside: avoid` on figures, tables, code and math; sidenotes become footnotes; `a[href]::after` shows the domain; serif option; `@page { margin: 18mm }`. No dependency. |
| **Text wrapping polish** | `text-wrap: balance` (all browsers); `pretty` (Chrome 117, Firefox 134, Safari 26) | Use `balance` on headings and captions, `pretty` on paragraphs; both degrade gracefully. |

---

## 5. Delight within the motion budget

Use what you already have: `--motion-spring` and `--motion-spring-soft` (`linear()` springs, about 455–480ms), the press scales, and the reduced-motion fallback in `motion.css`. Everything below animates only `transform` or `opacity`, or uses CSS scroll timelines.

| Moment | Interaction | How |
|---|---|---|
| Reading progress | 2px bar in the glass toolbar | `animation-timeline: scroll(root)` on `scaleX`; static in Firefox |
| Outline scroll-spy | Active marker slides between entries | One element, `transform: translateY`, `--motion-spring` |
| Highlight applied | Highlight colour wipes in once | Animate a `::highlight` pseudo-layer? Not animatable. Instead fade in an overlay span absolutely positioned from `range.getClientRects()` for 300ms, then remove it so the Highlight API takes over. |
| Card flip | 3D Y-rotation of the card | `transform: rotateY` with `backface-visibility`; under reduced motion, a cross-fade |
| Card rating | Card exits on a spring in the rating's direction; next card rises | `motion` `AnimatePresence`; haptic-like press scale 0.96 |
| Quiz correct | Small success mark, count goes up | Existing `bits/spring-check`, `bits/rolling-number` |
| Citation chip clicked | Smooth scroll to the block, block outline pulses once | `scrollIntoView({behavior:"smooth", block:"center"})`; outline opacity pulse via the existing `--motion-dur-flash` |
| Figure zoom | Shared-element zoom | `motion` `layoutId` in `<dialog>` |
| Library | Cards lift on hover; folder float; filter segmented control | Existing `folder-float` and `rubber-segment`; `content-visibility` on grid rows |
| Study set ready | Title reveal on the Study panel header only | React Bits Blur Text or Split Text (both use `motion`). **Never apply text reveals to faithful note text**: they delay reading and harm find-in-page and assistive technology. |

**React Bits that fit**
- Count Up (stats, streaks), Animated List (library and review queue) and Blur Text (study panel header, empty states).
- **Avoid** Scroll Reveal and Scroll Float on note text. They gate content behind scroll animation, and several React Bits scroll components depend on GSAP ScrollTrigger [unverified for Scroll Reveal specifically], which would add a dependency.

**Licence note:** React Bits is MIT + Commons Clause (already vendored with `LICENSE-react-bits`). Self-hosted use inside your app is allowed; redistributing the components themselves is not. That is fine, but keep the licence file next to each vendored component.

**Liquid Glass rules** (WWDC25 "Meet Liquid Glass"):
- Glass only on the floating navigation and control layer: toolbar, outline rail, selection pill, sheets.
- Never on content cards or text; never glass on glass.
- Honour Reduce Transparency, which becomes a frostier or opaque fill (`@media (prefers-reduced-transparency: reduce)` where supported, plus a user toggle), Increase Contrast (`prefers-contrast: more` gives a solid fill and border) and Reduce Motion.
- On the web: `backdrop-filter: blur(20px) saturate(1.6)` over a translucent tint, a 1px inner hairline and a soft shadow. Keep glass surfaces few and small, because backdrop-filter is GPU work during scroll.

---

## 6. Observer "document designer": presets and spec shape

The designer sees structure only (D53b). The output should be a closed, schema-validated spec, for example:

```ts
LayoutSpec = {
  preset: "article" | "textbook" | "lecture" | "paper",
  outline: "none" | "rail" | "rail-numbered",
  notes: "inline" | "sidenotes",
  figures: { numbering: boolean, width: "body" | "middle" },
  math: { equationNumbers: boolean },
  timecodeGutter: boolean,          // video only
  measureCh: int(60..72), bodyScale: enum(-1,0,1),
  studyPanel: "collapsed" | "open",
}
```

| Preset | Signals (structure only) | Layout |
|---|---|---|
| **Article** | Few headings, prose-heavy, few figures | Single column, no rail below 4 headings, inline notes |
| **Textbook section** | Deep heading tree, many figures and math, activity callouts | Numbered rail, sidenotes, numbered figures and equations, key terms in the margin |
| **Lecture video** | Transcript and keyframe blocks, timecodes | Timecode gutter, keyframes at `l-middle` beside transcript paragraphs, chapter outline from captions or headings |
| **Research paper** | Abstract-like first section, equations, tables, references | Numbered sections, equation numbers, figure and table lists, references as hover or sidenotes (Distill-style) |

Tie-breaks:
- The user's manual choice always wins.
- The spec is versioned with the note version.
- A missing or invalid spec falls back to `article`.
- The designer can choose only values in the closed vocabulary, so it can never introduce styles.

---

## 7. Suggested decisions to record

- **R1** Server-render Markdown, KaTeX and highlight.js per block, cached by hash; remove the client lazy rich-plugin chunk.
- **R2** Reader typography: system-ui (SF on Apple, Inter elsewhere), 66ch, 1.55 line height, a `-apple-system-body` hook, `text-wrap` polish, `content-visibility` per section.
- **R3** Annotations contract: W3C-compatible quote and position selectors scoped to a block, server-side re-anchoring, CSS Custom Highlight rendering, an orphan tray.
- **R4** Study layer: `ts-fsrs` (MIT), a study-set table separate from blocks, an evidence-quote check, staleness by block hash, cards adopted by the user.
- **R5** Print CSS only; no PDF service.
- **R6** No new UI dependencies: zoom via `<dialog>` + `motion`, progress via CSS scroll timeline, React Bits limited to non-content surfaces.

---

## Sources

**Reading UX and typography**
- [Dyson, How physical text layout affects reading from screen (PDF)](https://stu.westga.edu/~ssynan1/literacy/Dyson.pdf)
- [Dyson & Haselgrove, line length and reading speed](https://www.researchgate.net/publication/220106760_The_Influence_of_Reading_Speed_and_Line_Length_on_the_Effectiveness_of_Reading_from_Screen)
- [Optimal Line Length literature review (ERIC)](https://eric.ed.gov/?id=EJ749012)
- [Line length (Wikipedia)](https://en.wikipedia.org/wiki/Line_length)
- [WCAG 1.4.8 Visual Presentation](https://www.w3.org/WAI/GL/WCAG20/WD-UNDERSTANDING-WCAG20-20080310/visual-audio-contrast-visual-presentation.html)
- [WCAG 1.4.8 summary (accessibility.build)](https://accessibility.build/wcag/1-4-8)
- [Apple HIG Typography](https://developers.apple.com/design/human-interface-guidelines/foundations/typography/)
- [WebKit: Using the system font in web content (-apple-system-body)](https://webkit.org/blog/3709/using-the-system-font-in-web-content/)
- [Apple Developer Forums: SF fonts as web fonts](https://developer.apple.com/forums/thread/127350)
- [Apple Community: SF font on websites](https://discussions.apple.com/thread/8535378)
- [iA: Responsive Typography basics](https://ia.net/topics/responsive-typography-the-basics)
- [iA: 100E2R](https://ia.net/topics/100e2r)
- [NN/g: Table of Contents guide](https://www.nngroup.com/articles/table-of-contents/)
- [NN/g: In-page links](https://www.nngroup.com/articles/in-page-links-content-navigation/)
- [Tufte CSS](https://edwardtufte.github.io/tufte-css/)
- [Gwern: Sidenotes survey](https://gwern.net/sidenote)
- [Distill guide](https://distill.pub/guide/)
- [Obsidian Callouts](https://obsidian.md/help/callouts)
- [Readwise Reader docs (FAQs)](https://docs.readwise.io/reader/docs/faqs)
- [Readwise highlights, tags, notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)
- [Readwise WiseUp Vol. 10 (focus mode)](https://wiseup.readwise.io/wiseup-vol-10-drop-into-flow-with-focus-mode-translate-quotes-and-more/)
- [Readwise Obsidian export](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)
- [Readwise Obsidian V2 export](https://readwise.io/changelog/obsidian-v2-export)
- [Readwise highlight_id as block refs](https://medium.com/obsidian-observer/using-readwises-highlight-id-as-a-single-source-of-truth-in-obsidian-b1de98a8b87c)
- [MacStories: Matter review](https://www.macstories.net/reviews/matter-a-fresh-take-on-read-later-apps/)
- [Matter on the App Store](https://apps.apple.com/us/app/matter-save-read-grow/id1501592184)
- [Arc reader mode note](https://akashgoswami.com/notes/arc-reader-mode/)
- [Readability Consortium: font grade in light and dark](https://thereadabilityconsortium.org/wp-content/uploads/2023/07/How-bold-can-we-be-The-impact-of-adjusting-font-grade-on-readability-in-light-and-dark-polarities-1.pdf)
- [ACM: dark mode readability](https://dl.acm.org/doi/abs/10.1007/978-3-031-34866-2_2)
- [Design Shack: dark mode typography](https://designshack.net/articles/typography/dark-mode-typography/)
- [WebKit: Safari 26.0 features (text-wrap: pretty)](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [MDN text-wrap](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-wrap)

**Study tools and learning science**
- [ts-fsrs GitHub](https://github.com/open-spaced-repetition/ts-fsrs)
- [ts-fsrs npm](https://www.npmjs.com/package/ts-fsrs)
- [FSRS algorithm wiki](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)
- [FSRS benchmark](https://github.com/ankitects/fsrs-benchmark)
- [Anki (Wikipedia)](https://en.wikipedia.org/wiki/Anki)
- [RemNote: creating flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
- [RemNote: Concept/Descriptor framework](https://help.remnote.com/en/articles/6026154-structuring-knowledge-with-the-concept-descriptor-framework)
- [Quizlet: Studying with Learn](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn)
- [Quizlet: Introducing the new Learn](https://quizlet.com/blog/introducing-the-new-quizlet-learn)
- [Khanmigo case study](https://www.buildmvpfast.com/blog/ai-tutoring-khanmigo-case-study-2026)
- [arXiv: LLM tutor that withholds the answer](https://arxiv.org/pdf/2608.12292)
- [Google Workspace Updates: NotebookLM flashcards and quizzes](https://workspaceupdates.googleblog.com/2025/09/flashcards-quizzes-reports-notebook-lm-google-education.html)
- [9to5Google: NotebookLM flashcards and quizzes](https://9to5google.com/2025/09/08/notebooklm-flashcards-quizzes/)
- [Dunlosky et al. 2013 (SAGE)](https://journals.sagepub.com/doi/abs/10.1177/1529100612453266)
- [Dunlosky et al. 2013 (PDF)](https://www.whz.de/fileadmin/lehre/hochschuldidaktik/docs/dunloskiimprovingstudentlearning.pdf)
- [Adesope et al. 2017 meta-analysis](https://www.researchgate.net/publication/315706448_Rethinking_the_Use_of_Tests_A_Meta-Analysis_of_Practice_Testing)
- [Roediger & Karpicke 2006](http://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Roediger-Karpicke-2006_PPS.pdf)
- [Mayer & Moreno: nine ways to reduce cognitive load](https://faculty.washington.edu/farkas/WDFR/MayerMoreno9WaysToReduceCognitiveLoad.pdf)
- [Elaborative interrogation (Wikipedia)](https://en.wikipedia.org/wiki/Elaborative_interrogation)
- [Matuschak: How to write good prompts](https://andymatuschak.org/prompts/)
- [Gorgun 2025: LLMs for item quality control](https://onlinelibrary.wiley.com/doi/abs/10.1111/emip.12663)
- [Evaluating LLM-generated Q&A tests](https://dl.acm.org/doi/10.1007/978-3-031-98417-4_20)
- [Simon Willison: OpenAI Structured Outputs](https://simonwillison.net/2024/Aug/6/openai-structured-outputs/)
- [Azure: structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)
- [EU AI Act Article 50](https://artificialintelligenceact.eu/article/50/)
- [Bird & Bird: final Transparency Code of Practice](https://www.twobirds.com/en/insights/2026/taking-the-eu-ai-act-to-practice-the-final-transparency-code-of-practice)
- [Reed Smith: Article 50 guidelines](https://www.reedsmith.com/our-insights/blogs/viewpoints/102nbz0/transparency-obligations-for-ai-generated-content-the-code-of-practice-adequacy/)
- Brysbaert 2019 reading rate: https://doi.org/10.1016/j.jml.2019.104047 (could not be fetched, HTTP 403; the 238 wpm figure is from memory)

**Highlights and anchoring**
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [Hypothesis: Fuzzy Anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)
- [approx-string-match (MIT)](https://github.com/robertknight/approx-string-match-js)
- [Apache Annotator DOM module](https://annotator.apache.org/docs/api/modules/dom.html)
- [MDN: CSS Custom Highlight API in Firefox 140](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/140)
- [caniuse: Highlight API](https://caniuse.com/mdn-api_highlight)
- [MDN highlightsFromPoint](https://developer.mozilla.org/en-US/docs/Web/API/HighlightRegistry/highlightsFromPoint)
- [caniuse: Scroll to Text Fragment](https://caniuse.com/url-scroll-to-text-fragment)
- [TidBITS: text fragments](https://tidbits.com/2025/04/23/text-fragments-enable-deep-linking-on-web-pages/)

**Rendering**
- [KaTeX vs MathJax (BigGo)](https://biggo.com/news/202511040733_KaTeX_MathJax_Web_Rendering_Comparison)
- [KaTeX history](https://cuberoot.me/dev/language/katex)
- [HN: server-rendered KaTeX size](https://news.ycombinator.com/item?id=31440148)
- [Shiki bundles](https://shiki.matsu.io/guide/bundles)
- [Shiki best performance](https://shiki.style/guide/best-performance)
- [Shiki with Next.js](https://shiki.style/packages/next)
- [Comparing web code highlighters](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)
- [PkgPulse: Shiki vs Prism vs highlight.js](https://www.pkgpulse.com/guides/shiki-vs-prismjs-vs-highlightjs-syntax-highlighting-2026)
- [MDN content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)
- [DebugBear: content-visibility](https://www.debugbear.com/blog/content-visibility-api)
- [PhotoSwipe v5](https://photoswipe.com/v5/docs/getting-started)
- [react-medium-image-zoom](https://www.npmjs.com/package/react-medium-image-zoom)

**Delight and motion**
- [Smashing: CSS scroll-driven animations](https://www.smashingmagazine.com/2024/12/introduction-css-scroll-driven-animations/)
- [Mozilla Connect: scroll-driven animations in Firefox](https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idi-p/116931)
- [React Bits repo (licence)](https://github.com/DavidHDev/react-bits)
- [React Bits: Blur Text](https://reactbits.dev/text-animations/blur-text)
- [WWDC25: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- [WWDC25: Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)
- [Liquid Glass guide (community)](https://github.com/giorgio-a11y/liquid-glass-guide/blob/main/LIQUID-GLASS-GUIDE.md)
- [WWDC23: Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/)

**Unverified items, gathered in one place**
- Matter's 2025 Liquid Glass rebuild is from a secondary source.
- Stripe Press, Craft, Notion, Bear, Medium and Apple Books specifics are from product knowledge.
- Brysbaert's 238 wpm is from memory (the source returned 403).
- That `ui-serif` maps to New York on all Apple OS versions.
- That React Bits Scroll Reveal depends on GSAP.
- That private study material falls outside the EU AI Act Article 50(4) labelling duty is my legal reading.
- The search budget ran out before I could get a primary source for Safari's `content-visibility` version or Firefox's View Transitions support. Neither changes the recommendations.
