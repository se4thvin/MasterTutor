---
run_id: 2026-10-05-08-design-mockup-instrument
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language]
---

Build a throwaway, high-fidelity UI mockup as one self-contained HTML file. It is a visual exploration for the superpowers brainstorming visual companion, not product code, so use no frameworks and no build step.

**Read first:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-06-research-design-language/report.md`
  - Use direction **B "Instrument"** exactly: fonts, hex palette (dark-first, plus light), radius, density, signature details including the Cmd-K palette, and motion.
  - Section 2 covers run-view patterns and section 3 covers the reading UI.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` for product context.

**Product:** an agentic note-taking app. An AI agent drives its own browser to take faithful notes from websites, PDFs and YouTube. Notes match the source 1:1 and carry per-block provenance.

**Output file (write exactly this path):**
`/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-b-instrument.html`

**Technical requirements:**
- A full document starting with `<!DOCTYPE html>`, with inline CSS and JS only.
- Fonts may load from Google Fonts via `<link>`. No other external resources: draw images and diagrams with inline SVG or CSS, and build the fake browser screenshot from HTML/CSS.
- Floating controls at the top right: a light/dark toggle (default dark) and the label "Direction B: Instrument".
- A working Cmd-K command palette demo, opened with a key or a button.

**App shell:** a left sidebar with New task, Runs, Library, Vault and Settings. Clicking an item switches screens client-side with JS. The screens:

1. **Run view** (default, shown first; it is the most important screen):
   - A live agent browser on the left, about 60% wide: a fake browser showing a course page, with a LIVE pill, an agent cursor and a replay scrubber.
   - A step timeline on the right, styled as a trace waterfall, with 8–10 compact steps. Each step has a verb chip (Navigate / Read / Click / Fill credential `github@github.com` / Capture / Approve), a thumbnail, a mono timestamp and duration bars, and collapsible reasoning.
   - An inline approval card pinned to the bottom: "Submit form on coursera.org?", with the risk reason and Approve / Edit / Deny buttons showing their keyboard shortcuts.
   - A "Take control" button.
   - Run budget meters for steps, $ spent and time.
2. **Note reader:** a note captured from a web article.
   - A source strip header: favicon, domain, capture time and snapshot hash in mono.
   - A reading column 60–72ch wide in the serif.
   - Content: headings, a paragraph, a table, a code block, a math formula, and a diagram figure with caption.
   - A provenance gutter of markers, a hover popover on one block (snippet, "View in source", a "Verified ✓" badge), and one block flagged "OCR: needs review".
   - A side-by-side "Source | Note" toggle.
   - A small YouTube note section with timestamped chapter links and a keyframe thumbnail.
3. **Library:** a search bar, filters (Web / PDF / Video), dense note rows showing source favicon, title, date and a fidelity badge, plus an empty-state example.
4. **Vault:**
   - Credential aliases with a lock glyph and the bound domain.
   - TOTP on/off and session status, e.g. "Signed in · expires in 6d".
   - A clear note that secrets are never shown to the agent, or to you after saving.
   - Never show a password value.
5. **New task composer:** a large input ("Take notes on…"), source chips (URL / YouTube / PDF), options (allowed domains, budget, require approvals) and a Start button.

**Quality bar:**
- Realistic content, no lorem ipsum.
- Respect the specified motion, `prefers-reduced-motion`, and WCAG AA contrast.
- Make it polished and genuinely delightful. The user will judge the direction on this mockup.

**Final reply:** under 120 words, giving the file path and what is on each screen. Do not paste the HTML.
