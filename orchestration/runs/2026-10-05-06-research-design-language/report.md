---
run_id: 2026-10-05-06-research-design-language
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

# Design language research: agentic note-taking app

Contrast ratios below were computed locally with the WCAG 2.x relative-luminance formula. Claims taken from secondary design teardowns, not first-party sources, are marked [unverified].

## 1. Reference breakdown: what makes each one delightful

| App | Typography | Color | Density | Motion / empty states |
|---|---|---|---|---|
| **Linear** | Inter for UI, with Inter Display added for headings to make them more expressive | Themes are built in LCH from 3 variables (base, accent, contrast), replacing 98 per theme. Less blue chrome, so it looks "more neutral and timeless" | Medium-dense. The team spent a lot of effort aligning icons and labels, which you "feel after a few minutes" | Fast and restrained. Mostly dark-first marketing [unverified: weight 510 as its signature] |
| **Raycast** | Inter (ss03) [unverified] | Near-black canvas. Elevation comes from hairline borders and inset highlights, not shadows | Tight and keyboard-first | Almost no animation, on purpose. Its principles are "fast, simple, delightful" |
| **Vercel / v0** | Geist, Geist Mono (Swiss-inspired, OFL, on Google Fonts) | Monochrome plus a semantic color only where needed | Medium | Short ease-out. Mono type for metadata |
| **Perplexity** | Sans UI. Citations are typographic superscripts inside the text flow | Single teal accent (#20808D) on warm off-white [unverified hexes] | Airy | Source strip above the answer, numbered inline chips, hover preview with fast ease-enter, "+N" for multiple sources |
| **Granola** | Quadrant slab serif for display, Melange for UI (both commercial) | Oat-green on warm cream, with yellow highlighter marks | Calm, paper-like | AI text is gray and the user's text is black. Every AI bullet links to the exact transcript moment |
| **Readwise Reader** | Serif/sans choice including Atkinson Hyperlegible. Default 20px, line-height 1.4, adjustable width | Themeable | Very airy | The user controls the reading. About 65 characters per line |
| **Things 3** | Careful system type | A discreet palette with a single blue | Spacious | Custom animation toolkit. "Unfolding" transitions keep your place. Two Apple Design Awards |
| **Dia (Arc successor)** | Plain, Chrome-like | The page color extends into the tab | Familiar | Fluid motion in the assistant bar. Built so anyone can switch "at 10am on a Tuesday" |
| **Claude / Notion / Craft** | Serif-forward reading (Claude), neutral sans (Notion), and Craft's card-based documents [unverified, from general knowledge, not re-checked] | Warm neutrals with one clay or ink accent | Medium | Quiet, generous empty states built from a single illustration or line of copy |

**Shared traits:** one accent color, warm or tinted neutrals rather than pure gray, borders instead of shadows, a separate display face or optical size for headings, motion under 300ms, and empty states that are a single helpful sentence plus a primary action.

## 2. Agent run-view patterns

- **ChatGPT agent / Operator:** live on-screen narration of each step. Before consequential actions it asks permission, and the user can edit or approve the action. "Take over browser" is used for logins. You can interrupt, pause or stop at any time. Operator added **watch mode**, which requires supervision on sensitive sites such as email and finance, and **takeover mode** for sensitive input, which pauses screen capture. Sources: https://openai.com/index/introducing-chatgpt-agent/, https://openai.com/index/operator-system-card/, https://help.openai.com/en/articles/11752874-chatgpt-agent
- **Manus:** a "Manus's Computer" pane streams pages, searches and form fills, with an optional file/log view. A **replay** scrubs back through each step, and you can jump in mid-run. https://cybernews.com/ai-tools/manus-ai-review/
- **Browserbase:** Session Inspector live view plus automatic recording, with replay as embeddable HLS or rrweb. Director is a no-code layer on top. https://docs.browserbase.com/platform/browser/observability/session-replay
- **Shape of AI patterns:** Action Plan (confirm steps before running), Stream of Thought, Controls (stop/pause/modify) and Citations. Keep three views in sync: "what will happen, what happened, what supports the result." https://www.shapeof.ai/patterns/action-plan, https://www.shapeof.ai/patterns/stream-of-thought

**Synthesis for our run view:**
- Use a split layout: the live browser on the left at about 60%, and a step timeline on the right.
- Each timeline step shows a thumbnail, a verb chip (Click / Type / Read / Capture), a one-line narration, and collapsible reasoning.
- A scrubber under the browser replays past screenshots. A "LIVE" pill returns you to the live view.
- Approval prompts are an inline card pinned to the bottom of the timeline. They state the action, the target domain and the risk reason. Buttons are Approve / Edit / Deny, with keyboard shortcuts.
- Takeover puts an accent-colored frame around the browser with a "You're in control" bar and a "Hand back" button. Capture-paused state is shown explicitly.
- Show credential fills as `alias@domain` chips, never as values.

## 3. Reading-first note UI

- **Measure:** 60–72ch (about 640–680px at 18px). Reader defaults to 20px and 1.4 line-height. For a note editor, use 17–18px with 1.6 line-height. https://docs.readwise.io/reader/docs/faqs/appearance
- **Citations:** follow Perplexity's layers.
  1. A source strip in the note header (favicon, domain, capture time, snapshot hash).
  2. A per-block provenance marker in the left gutter on hover, not inline clutter.
  3. A popover with the snippet and a "View in source" link that opens the MHTML snapshot scrolled to the text fragment.

  Granola's "every AI bullet links to the transcript moment" is the model for video timestamps. https://www.shapeof.ai/patterns/citations, https://aiuxplayground.com/teardowns/perplexity/citations/
- **Source vs note:** a toggleable side-by-side view with synced scroll. Hovering a note block highlights the matching source region. Faithfulness indicators per block: verified (matches DOM text) or paraphrased/OCR (needs review).
- **Figures:** images and diagrams are full-measure or allowed to bleed to about 840px. Captions use the UI sans at 13px. Tables are horizontally scrollable with a tabular-nums mono. KaTeX math sits at 1.05em.

## 4. Token recommendations (shared skeleton)

- **Fonts (all OFL on Google Fonts):**
  - Geist and Geist Mono: https://vercel.com/font
  - Inter / Inter Display
  - Newsreader, with an opsz axis of 6–72 and weights 200–800, built for on-screen long-form reading: https://fonts.google.com/specimen/Newsreader
  - Source Serif 4
  - IBM Plex
  - Figtree
- **Type scale:** UI 12 / 13 / 14 (base) / 16 / 20 / 24 / 32. Reading 18 / 22 / 28 / 36 (serif display). Line-heights: 1.45 for UI, 1.6 for reading, 1.15 for headings.
- **Spacing:** 4px base, using 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius:** 6 for inputs and chips, 10 for cards, 14 for dialogs. Directions adjust these.
- **Motion:**
  - Durations: 120ms (hover/press), 180ms (popover/tooltip), 240ms (panel/sheet), 320ms max (page/route).
  - Easings: enter `cubic-bezier(0.16, 1, 0.3, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`, standard `cubic-bezier(0.2, 0, 0, 1)`.
  - Animate only transform and opacity. Do not animate keyboard-repeated actions. Honor `prefers-reduced-motion` (https://emilkowal.ski/ui/great-animations).
  - The live "agent working" indicator should be a slow 1.6s opacity pulse, not a spinner.
- **Implementation:** shadcn/Tailwind v4 CSS variables in `@theme`, defined in OKLCH, following Linear's base/accent/contrast idea. https://linear.app/now/how-we-redesigned-the-linear-ui
- **Accessibility:** body text at 4.5:1 or better. UI boundaries and focus rings at 3:1 or better. Focus ring is 2px accent with a 2px offset. Never signal state by color alone: risk prompts use an icon plus a label.

## 5. Three directions

### A. "Paper & Ink" (RECOMMENDED)
**Mood:** A quiet study desk. Warm paper, ink-dark text and a single deep-green ink accent. The chrome steps back so captured content is the hero. AI-authored text and provenance markers feel like pencil annotations in a margin. It's calm and trustworthy, and the agent's run view still reads as precise rather than playful.

**Fonts:** Inter for UI (Inter Display for headings), Newsreader for note reading and display, Geist Mono for timestamps, hashes and code.

**Palette:**

| Role | Light | Dark |
|---|---|---|
| bg | #FBFAF7 | #161513 |
| surface | #F3F1EC | #1E1D1A |
| border | #E4E0D8 | #2C2A26 |
| text | #1F1D1A | #ECE8E1 |
| muted | #6B665E | #A39E94 |
| accent (ink green) | #2F5D50 | #7FB8A4 |

Danger is #B42318 and the warning/highlight is #F5E6B8.

**Contrast:** light text 16.1:1, muted 5.5:1, accent 7.2:1, white on accent 7.5:1. Dark text 14.9:1, muted 6.8:1, accent 8.1:1.

**Radius/density:** radius 6/8/12. Medium density in the library and run view, airy in the reader.

**Signature details:**
- A provenance gutter of small ink ticks.
- A highlighter-yellow wash on the block being cited.
- Source cards that look like stamped receipts (domain, timestamp, hash in mono).
- The vault shows aliases as embossed chips with a lock glyph.

**Motion:** standard easing and 180ms. The agent cursor in the stream leaves a fading ink trail.

**Draws from:** Readwise Reader, Granola, Claude, Things, Linear (alignment discipline).

**Trade-offs:**
- Warm neutrals need careful dark-mode tuning.
- Two families plus a mono add about 150KB of font weight (variable subsets mitigate this).
- It looks less "techy" in the run view.

### B. "Instrument"
**Mood:** A precision cockpit. Dark-first, near-black with hairline borders and an electric-indigo accent. It's built for watching an agent work: dense timelines, mono metadata, keyboard everything.

**Fonts:** Geist for UI, Geist Mono, Source Serif 4 for the reader only.

**Palette:**

| Role | Dark | Light |
|---|---|---|
| bg | #0B0C0E | #FFFFFF |
| surface | #141518 | #F7F7F8 |
| border | #23252A | #E6E6E9 |
| text | #EDEDEF | #16171A |
| muted | #8A8F98 | #6B6F76 |
| accent | #7C83FF (text/links); #5E6AD2 (button fill) | #5E6AD2 |

Live status is #4CC38A.

**Contrast:** dark text 16.7:1, muted 6.0:1, accent 6.1:1, white on button 4.7:1. Light muted 5.1:1, accent 4.7:1.

**Radius/density:** radius 4/6/8, compact 28px rows.

**Signature details:**
- A Command-K palette for everything.
- Inset highlight strokes instead of shadows.
- A live-pulse dot.
- A step timeline styled like a trace waterfall.

**Motion:** 120–160ms with ease-out, close to none.

**Draws from:** Linear, Raycast, Vercel/v0, Browserbase inspector.

**Trade-offs:**
- Superb for the run view, but cold and generic for long reading. "Linear clone" fatigue in 2026.
- The dark-first approach clashes with captured web pages, which are mostly light.

### C. "Daylight"
**Mood:** Friendly and bright, like a well-made consumer app. Soft lavender-gray surfaces, rounded cards, a warm orange accent and springy, playful micro-interactions. It feels approachable for non-technical users and makes notes feel like collectibles.

**Fonts:** Figtree for UI, Source Serif 4 for reading, IBM Plex Mono.

**Palette:**

| Role | Light | Dark |
|---|---|---|
| bg | #FFFFFF | #17161D |
| surface | #F6F5FA | #201F28 |
| border | #E7E5EF | #2E2C38 |
| text | #22212B | #EEEDF5 |
| muted | #696875 | #9C9AAB |
| accent | #C2410C | #FB923C |

**Contrast:** light text 15.9:1, muted 5.5:1, accent 5.2:1 (white on accent 5.2:1). Dark text 15.5:1, muted 6.5:1, accent 7.9:1.

**Radius/density:** radius 10/14/20, airy.

**Signature details:**
- Library cards with source favicons and thumbnail mosaics.
- Illustrated empty states.
- Confetti-free but bouncy "note ready" moments.

**Motion:** springs (stiffness 400, damping 30) with 240ms enters.

**Draws from:** Things, Arc/Dia, Craft, Notion.

**Trade-offs:**
- Playfulness can undercut trust in approval and vault screens.
- Rounded softness wastes space in the dense timeline.
- Higher design and animation cost.

## Recommendation
**A, "Paper & Ink"**, borrowing B's run-view density (compact timeline rows and mono metadata) inside the warm shell. The product's promise is *faithful* capture, and an editorial, citation-forward language signals fidelity and trust. It also sits naturally next to light source pages in the side-by-side comparison. Ship both light and dark from day one via OKLCH tokens.

## Sources
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://www.raycast.com/blog/a-fresh-look-and-feel
- https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md [secondary, unverified]
- https://www.shadcn.io/design/granola [secondary, unverified]
- https://www.granola.ai/blog/a-new-look-for-granola
- https://wondertools.substack.com/p/granolaguide
- https://aiuxplayground.com/teardowns/perplexity/citations/ [secondary, unverified]
- https://docs.readwise.io/reader/docs/faqs/appearance
- https://culturedcode.com/things/features/
- https://www.thurrott.com/cloud/web-browsers/322287/the-browser-company-explains-its-vision-for-dia
- https://openai.com/index/introducing-chatgpt-agent/
- https://openai.com/index/operator-system-card/
- https://cybernews.com/ai-tools/manus-ai-review/
- https://docs.browserbase.com/platform/browser/observability/session-replay
- https://www.shapeof.ai/patterns/action-plan
- https://www.shapeof.ai/patterns/citations
- https://emilkowal.ski/ui/great-animations
- https://vercel.com/font
- https://fonts.google.com/specimen/Newsreader
