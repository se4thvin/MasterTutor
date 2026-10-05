---
run_id: 2026-10-05-07-design-mockup-paper-ink
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language]
---

Build a throwaway, high-fidelity UI mockup as one self-contained HTML file. This is a visual exploration for the superpowers brainstorming visual companion: not product code, so no frameworks or builds.

**Read first:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-06-research-design-language/report.md`: use direction **A "Paper & Ink"** exactly (fonts, hex palette for light and dark, radius, density, signature details, motion). Its section 2 (run-view patterns) and section 3 (reading UI) apply too.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` for product context.
- A note on direction A: borrow B's dense run-view timeline (compact rows, mono metadata) inside A's warm shell.

**Product:** an agentic note-taking app. An AI agent drives its own browser to take faithful notes from websites, PDFs and YouTube. Its notes are 1:1 with the source and carry per-block provenance.

**Output file (write exactly this path):**
`/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-a-paper-ink.html`

Requirements:
- Full document starting with `<!DOCTYPE html>`. Inline CSS and JS only. You may load fonts from Google Fonts via `<link>`. No other external resources: draw images and diagrams with inline SVG or CSS, and draw the fake browser screenshot with HTML/CSS.
- Floating top-right controls: a light/dark toggle, plus a label "Direction A: Paper & Ink".
- An app shell with a left sidebar (New task, Runs, Library, Vault, Settings) that switches between these screens client-side with JS:
  1. **Run view** (default screen; show it first; it's the most important). Include:
     - a live agent browser on the left, about 60%, rendered as a fake browser showing a course page, with a LIVE pill, an agent cursor, and a replay scrubber;
     - a step timeline on the right with 8–10 compact steps: verb chips (Navigate / Read / Click / Fill credential `github@github.com` / Capture / Approve), thumbnails, mono timestamps, collapsible reasoning;
     - an inline approval card pinned at the bottom ("Submit form on coursera.org?", with risk reason and Approve / Edit / Deny with kbd hints);
     - a "Take control" button;
     - run budget meters (steps, $ spent, time).
  2. **Note reader:** a note captured from a web article. It needs:
     - a source strip header (favicon, domain, captured time, snapshot hash in mono);
     - a reading column of 60–72ch in the serif;
     - headings, a paragraph, a table, a code block, a math formula, and a diagram figure with caption;
     - a provenance gutter with ticks, plus a hover popover on one block showing a snippet, a "View in source" link and a "Verified ✓" badge, and one block flagged "OCR: needs review";
     - a toggle for side-by-side "Source | Note".
     - Also include a small YouTube note section with timestamped chapter links and a keyframe thumbnail.
  3. **Library:** search bar, filters (Web / PDF / Video), note cards or rows with source favicon, title, date, fidelity badge, and an empty-state example.
  4. **Vault:** credential aliases as chips with a lock glyph, the bound domain, TOTP on/off, a session status ("Signed in · expires in 6d"), and a clear "secrets are never shown to the agent or you after saving" note. Never show a password value.
  5. **New task composer:** a large calm input ("Take notes on…"), source chips (URL / YouTube / PDF), options (allowed domains, budget, require approvals), and a Start button.
- Use realistic content, not lorem ipsum. Respect the motion durations and easings, `prefers-reduced-motion`, and WCAG AA contrast.
- Make it genuinely delightful and polished; this is what the user will judge the direction on.

**Final reply:** under 120 words. State the file path and what's on each screen. Don't paste the HTML.
