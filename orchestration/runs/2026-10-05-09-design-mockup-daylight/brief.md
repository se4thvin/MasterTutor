---
run_id: 2026-10-05-09-design-mockup-daylight
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language]
---

Build a throwaway, high-fidelity UI mockup as a single self-contained HTML file. This is a visual exploration for the superpowers brainstorming visual companion, not product code, so use no frameworks and no build step.

**Read first:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-06-research-design-language/report.md`. Use direction **C "Daylight"** exactly as written: fonts, hex palette for light and dark, radius, density, signature details, and spring motion. Section 2 covers run-view patterns and section 3 covers the reading UI.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` for product context.

**Product:** an agentic note-taking app. An AI agent drives its own browser to take notes from websites, PDFs and YouTube. Notes match the source 1:1 and carry provenance for every block.

**Output file (write exactly this path):** `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-c-daylight.html`

**File requirements:**
- A full document that starts with `<!DOCTYPE html>`, with all CSS and JS inline.
- Fonts may load from Google Fonts via `<link>`. Nothing else external: draw images and diagrams with inline SVG or CSS, and build the fake browser screenshot from HTML/CSS.
- Floating controls in the top-right corner: a light/dark toggle and the label "Direction C: Daylight".

**App shell:** a left sidebar with New task, Runs, Library, Vault and Settings. Clicking an item switches screens client-side with JS. Build these screens:

1. **Run view.** This is the default screen and the most important one.
   - A live agent browser on the left, about 60% of the width: a fake browser showing a course page, with a LIVE pill, an agent cursor and a replay scrubber.
   - A step timeline on the right with 8–10 steps. Each step has a verb chip (Navigate / Read / Click / Fill credential `github@github.com` / Capture / Approve), a thumbnail, a timestamp and collapsible reasoning.
   - An inline approval card pinned to the bottom, asking "Submit form on coursera.org?". Show the reason it's risky and Approve / Edit / Deny buttons with keyboard-shortcut hints.
   - A "Take control" button.
   - Run budget meters for steps, $ spent and time.
2. **Note reader.** Show a note captured from a web article.
   - A source strip header: favicon, domain, capture time and snapshot hash.
   - A reading column 60–72 characters wide, set in the serif.
   - Content: headings, a paragraph, a table, a code block, a math formula, and a diagram figure with a caption.
   - A provenance gutter. Hovering one block opens a popover with a snippet, "View in source" and a "Verified ✓" badge. Flag one block "OCR: needs review".
   - A side-by-side "Source | Note" toggle.
   - Also add a small YouTube note section with timestamped chapter links and a keyframe thumbnail.
3. **Library.** A search bar, filters (Web / PDF / Video), and note cards. Each card shows a favicon and thumbnail mosaic, title, date and fidelity badge. Include an illustrated empty-state example.
4. **Vault.**
   - Credential aliases with a lock glyph and the domain each is bound to.
   - TOTP on/off and session status ("Signed in · expires in 6d").
   - A clear note that secrets are never shown to the agent, or to you, after saving.
   - Never show a password value.
5. **New task composer.** A large friendly input ("Take notes on…"), source chips (URL / YouTube / PDF), options (allowed domains, budget, require approvals), and a Start button.

**Quality bar:**
- Use realistic content, not lorem ipsum.
- Honor the specified spring motion, `prefers-reduced-motion`, and WCAG AA contrast.
- Make it genuinely delightful and polished. The user will judge the direction on this mockup.

**Final reply:** under 120 words. Give the file path and say what is on each screen. Don't paste the HTML.
