---
run_id: 2026-10-05-12-design-apple-editorial
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language, 2026-10-05-07-design-mockup-paper-ink, 2026-10-05-08-design-mockup-instrument, 2026-10-05-09-design-mockup-daylight, 2026-10-05-13-research-chatgpt-browser-ui]
---

You are designing the final UI design language for an agentic note-taking web app and building a high-fidelity mockup of it. This is throwaway visual exploration for the superpowers brainstorming visual companion, not product code.

**Step 1 (mandatory):** invoke the Skill tool with `skill: "anthropic-skills:apple-hig-designer"` and follow its guidance throughout.

**Step 2. Read these for context:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` and `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md` (product and engineering principles).
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-06-research-design-language/report.md`, especially sections 2–3 (run-view patterns, reading UI, provenance).
- The two earlier mockups, for the *information depth* the user liked:
  - `.superpowers/brainstorm/62132-1791238228/content/mock-a-paper-ink.html`
  - `.superpowers/brainstorm/62132-1791238228/content/mock-b-instrument.html`
- The user's inspiration images. View each one with the Read tool: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/design/inspiration/01.png` through `04.png`. They are:
  1. a classic Apple "Think different." print ad (iMac puck mouse);
  2. the Apple Macintosh 20th-anniversary "Mouse." editorial spread;
  3. the "Case design." spread with an exploded/annotated Macintosh cutaway, dotted leader lines and italic callouts;
  4. a Swiss/modernist poster with bold blue/red/navy color blocks, halftone dots, thin white line geometry and a giant numeral.

**What the user asked for, verbatim intent:**
- "a more Apple-like aesthetic with a clean UI".
- "I like the depth of information, keep that, but make the UI of how it's presented more delightful".
- Use a **modern sans-serif typeface**.

**Your task: synthesize one direction ("D").** Interpret the inspiration thoughtfully rather than copying it.
- From the Apple ads and spreads take: vast whitespace, confident oversized headlines with tight tracking, a single hero object per view, and editorial multi-column composition.
- Make the **annotated-cutaway callouts** (dotted leader lines, small italic or light captions) a signature device for showing provenance and the agent's actions. For example, a note block "points" to its source, or a timeline step annotates the live browser.
- From the Swiss poster take: a strict grid, crisp hairline geometry, and one bold signature color moment, used sparingly (e.g., the live/active state, the halftone texture on empty states or the hero). Keep the day-to-day UI calm.

**HIG compliance:**
- Clarity, deference, depth. Materials and vibrancy (translucent sidebars and toolbars with backdrop blur).
- 44pt targets and Dynamic-Type-like scaling.
- SF-Symbols-style line icons drawn as inline SVG.
- Light and dark mode, `prefers-reduced-motion`, WCAG AA contrast.

**Fonts and layout:**
- Font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`, then **Inter** (Inter Display for large titles) from Google Fonts as the cross-platform fallback.
- Keep a mono for hashes and timestamps (SF Mono → Geist Mono or JetBrains Mono).
- Reading notes in the same sans at reading size. No serif unless you can justify it strongly.

**Output 1.** A self-contained HTML mockup (`<!DOCTYPE html>`, inline CSS/JS, Google Fonts only, all imagery as inline SVG/CSS), written to exactly:
`/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-d-apple.html`

The mockup must have:
- Floating label "Direction D: Apple editorial" plus a light/dark toggle.
- A Mac-app-like shell with a translucent sidebar (New task, Runs, Library, Vault, Settings) and client-side screen switching.

Screens, at the same information depth as mockups A and B:
1. **Run view** (default):
   - Live agent browser, LIVE state, agent cursor, replay scrubber.
   - Step timeline with verbs, thumbnails, mono timestamps, expandable reasoning.
   - Callout leader lines linking the current step to the element in the browser.
   - Approval sheet (HIG-style) for "Submit form on coursera.org?" with Approve / Edit / Deny and keyboard hints.
   - Take control, which shows a "You're in control" state.
   - Budget meters.
   - Credential fills shown as `github@github.com` chips, never values. Also show a PIN/OTP request card "Enter the code sent to you" (the value goes to the executor, never the model) and a passkey sign-in step.
2. **Note reader:**
   - Source strip (favicon, domain, captured time, mono snapshot hash).
   - Headings, paragraph, table, code, math, and a diagram figure with editorial caption.
   - Provenance shown with the cutaway-callout device, plus a "Verified" popover with "View in source"; one block flagged "OCR · needs review", one block "edited".
   - Source | Note side-by-side toggle.
   - YouTube section with timestamped chapters and keyframes.
3. **Library:** search, segmented control (All / Web / PDF / Video), a beautiful grid/list toggle, fidelity badges, and an empty state using the Swiss halftone motif.
4. **Vault:** aliases bound to domains, with field types (password / TOTP / PIN / OTP-via-email / passkey), session status, and a "secrets are never shown" explanation. No values ever.
5. **New task:** a hero-style composer ("Take notes on…") with source chips and options (allowed domains, budget, approvals).

Use realistic content and make it genuinely delightful: this is the direction the user will approve.

**Output 2: your final reply.** This is the design-language spec and I will save it to disk; do not write it to a file yourself. Under 900 words:
- Name and mood.
- How each inspiration image was used.
- Typography scale.
- Color tokens in hex for light and dark (neutrals, one accent, the signature bold color, semantic colors) with contrast ratios.
- Materials/blur, radius, spacing, elevation.
- Iconography.
- Motion (durations, easings, springs).
- The provenance callout device spec.
- Accessibility notes.
- The mockup path and a one-line description per screen.
