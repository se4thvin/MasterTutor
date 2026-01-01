---
run_id: 2026-10-05-09-design-mockup-daylight
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language]
---

The Daylight mockup is written: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-c-daylight.html`. The script parses and all five screens render in headless Chrome. I didn't click through the interactions.

- **Run view (default):** a live fake course page with an agent cursor, a working replay scrubber and Take control. On the right, 10 timeline steps with collapsible reasoning. The approval card answers to A/E/D, and approving ends in a "Note ready" pop-up. Budget meters for steps, $ spent and time.
- **Note reader:** a full attention article with the requested blocks. Hover popovers, the OCR flag, Source | Note view, and a YouTube note with chapters.
- **Library:** working search, filters, mosaic cards and an illustrated empty state.
- **Vault:** aliases, TOTP toggles, session status and the sealed-secrets note; no password value appears.
- **New task:** composer with all requested options.

A light/dark toggle sits top-right, and adding `#vault`, `#reader` etc. to the URL opens that screen.
