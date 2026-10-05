---
run_id: 2026-10-05-12-design-apple-editorial
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-06-research-design-language, 2026-10-05-07-design-mockup-paper-ink, 2026-10-05-08-design-mockup-instrument, 2026-10-05-09-design-mockup-daylight, 2026-10-05-13-research-chatgpt-browser-ui]
---

**Mockup:** `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-d-apple.html`. It is one self-contained file using only Google Fonts. I checked it in headless Chrome at 1440, 1280, 1024, 768 and 390 wide, in light and dark: no console errors, and the approval, replay, take-over, paused, reconnecting, empty-search and side-by-side flows all work.

# Direction D: "Cutaway" (Apple editorial)

**Mood:** a 1990s Apple print spread brought to life. Lots of white space and big, tightly set headlines that end in a full stop ("Library."). Each view has one hero object: the agent's browser, the note, or the vault diagram. Thin dotted leader lines explain how things work. Everyday UI stays quiet, and a single vermilion "signal" marks whatever is live or needs you.

## How each inspiration image was used
1. **Think different.** One hero object per screen. The New task hero is a halftone sphere that nods to the puck mouse.
2. **Mouse.** Editorial captions with a bold lead-in and italic body. Multi-column headers, and reading text set to a measure.
3. **Case design.** The signature device: dotted leader lines with small italic captions, used for provenance and agent actions.
4. **Swiss poster.** A strict 12-column grid with hairlines. Signal vermilion plus poster navy, and halftone dots only on the New task hero and empty states.

## Typography
- **Stack:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter…`. Inter's opsz axis gives the Display cut at large sizes. Mono is `ui-monospace, "SF Mono", "Geist Mono"`.
- **Sizes, in rem so text scales:**
  - Hero 44–72/1.0, −0.04em
  - Large Title 40/1.08, −0.032em
  - Title 1 28/1.15
  - Title 2 22/1.25
  - Title 3 17/1.3 semibold
  - UI body 14
  - Reading lede 21/1.5; reading body 17/1.65 at about 68ch
  - Callout 13
  - Caption 12 italic
  - Eyebrow 11 caps +0.08em
  - Mono 12, tabular
- No serif anywhere; the side-by-side source pane only shows the captured page as it was.

## Colour tokens (light / dark)
| Token | Light | Dark | Contrast (light / dark) |
|---|---|---|---|
| bg | #FFFFFF | #0B0B0C | |
| bg-2 | #F5F5F7 | #161617 | |
| elevated | #FFFFFF | #1C1C1E | |
| label | #1D1D1F | #F5F5F7 | 16.8 / 18.1 |
| label-2 | #6E6E73 | #A1A1A6 | 5.07 (4.66 on bg-2) / 7.65 |
| label-3 (decorative only) | #86868B | #6E6E73 | |
| hairline | #D2D2D7 | #38383A | |
| Accent fill (interactive only) | #0071E3 | #0071E3 | 4.70 with white text |
| Accent text | #0066CC | #2997FF | 5.57 / 6.53 |
| Signal | #D9301A | #FF5533 | 4.79 white on it / 6.18 with dark text |
| Navy | #0B1A66 | #2B3A8F | |
| ok | #1A7F37 | #30D158 | 5.08 / 9.73 |
| warn | #B25000 | #FFB340 | 5.20 / 11.0 |
| danger | #D70015 | #FF453A | 5.38 / 5.78 |

## Materials, shape, space, elevation
- **Glass** is used on the sidebar, toolbars, browser chrome, caption bar, banners and the mobile sheets only: `saturate(180%) blur(24px)` at 72% fill. It falls back to opaque under `prefers-reduced-transparency`.
- **Radius:** 6 / 8 / 12 / 18 / 26 / pill, kept concentric. The browser frame is 14.
- **Spacing:** 4pt steps on an 8pt rhythm.
- **Elevation:** a 0.5px hairline plus a soft shadow (e1/e2/e3). Dark mode relies on the hairline.

## Iconography
SF-Symbols-style inline SVG on a 24 grid with a 1.6 stroke and round caps. Every icon has a text label or an aria-label.

## Provenance callout device
- **Line:** 1.25px dotted (`dasharray 0 4`, round caps) in label-3, ending in a 2.75px dot on the target. It turns label colour when its block is hovered or focused.
- **Caption:** 12px italic with a bold lead-in.
- **Note margin:** a 15rem column. Collisions push captions down and the leader goes diagonal, as in the cutaway.
- **Live or needs-you leaders** use signal colour plus a 7px ring.
- **Run view:** the current step points into the exact element on the page.
- **Popover:** status badge, a highlighted snippet, selector, snapshot hash, and **View in source**.
- **Hidden** below 1180px wide, where the gutter badges carry the status.

## Agent browser (from run 13 §6)
- **Frame:** 14px radius, a 44px glass toolbar with three neutral dots. A centred origin pill shows the **bold registrable domain** with the path dimmed, plus a lock. A green key-shield "Filled securely" badge appears only while `fill_credential` owns a field.
- **Viewport:** a 1280×800 frame scaled to fit, with a neutral letterbox.
- **Cursor:** a 20px arrow with a white outline. It follows a quadratic arc eased with cubic-bezier(.2,.8,.2,1) over 250–450ms depending on distance. A 24→44px click ring fades from 0.35 over 400ms, and the cursor drifts ±2px while the agent thinks.
- **Caption:** one line, verb first, crossfading in 220ms, `aria-live`.
- **Steps:** a collapsible list. Clicking a step replays its screenshot.
- **States** (switchable from a dashed "Demo state" control):
  - Live
  - Agent acting: an inner ring that animates opacity only
  - Awaiting approval: viewport dimmed to 40% with a spotlight on the target, and a centred `alertdialog` sheet (Deny D / Edit E / Approve A, no Return default)
  - You're in control: "You're in control · Agent paused · screenshots off", with Hand back and an optional note to the agent
  - Paused/sleeping: desaturated, with Resume
  - Reconnecting: last frame blurred 8px, a ticking spinner and the retry countdown
  - Replaying: a scrubber, "Replay · step 4/11" and Jump to live
- **⌘⇧T** takes over and hands back. Esc stays with the page.
  - **Decision for you:** browsers reserve ⌘⇧T to reopen a closed tab, so it will only fire in an installed PWA or app shell. A non-conflicting alternative (for example ⌃⌥T) needs choosing; the visible button works everywhere.
- **PiP:** a 240px live thumbnail docked in the note reader. It springs up to 560px; only transform is animated.

## Motion and responsiveness
- **Spring:** stiffness about 400, damping about 30, as a CSS `linear()` curve settling in about 450ms (taken from mock C). It drives the sheets, cards (popIn with 35ms stagger), new timeline steps, segmented knobs, switches, the PiP and the "Note ready" moment (a fanned card stack with a bouncing check).
- **Press feedback** within 60–90ms: scale 0.96, or 0.92 for icon buttons.
- **Optimistic UI:** approvals, Mark verified, removing a chip (with Undo) and starting a task all update before any confirmation.
- **Skeletons, not spinners:** shimmer on library cards and a "thinking" row in the timeline.
- **Performance:** only transform and opacity animate (meters use scaleX), to hold 60fps.
- **Durations:** 120ms micro, 200ms base, 300ms panels, 450ms spring. Easing out is (.16,1,.3,1); easing in is (.4,0,1,1).
- **Breakpoints:**
  - Over 1180px: full sidebar, browser and timeline side by side.
  - 1180px and below: icon-rail sidebar, browser stacked above the timeline.
  - 820px and below: bottom tab bar. The timeline becomes a draggable bottom sheet and approvals become a bottom sheet.
  - 420px and below: path and hash are trimmed.

## Accessibility
- All text pairs meet AA; the ratios are in the colour table.
- Targets are 44px. Smaller controls extend their hit area with `::after`, and everything is 44px under `pointer: coarse`.
- Everything is in rem, with an A/A/A text-size demo.
- Focus ring: 2px accent with a 2px offset.
- Status never relies on colour alone; there is always an icon plus a word.
- `aria-live` on the caption and toasts, `alertdialog` for approval, and the viewport is labelled "Remote browser, <origin>".
- Reduced motion: the cursor jumps, the click ring becomes a static dot, and fades replace movement.
- Secrets never render: OTP boxes seal to dots, and vault fields only say "sealed".

## Screens
1. **Run:** live browser with cutaway callouts, the step-to-element leader, approval spotlight sheet, take over and hand back, replay, budget numerals, and credential steps (vault fill chip, passkey step, interactive "Enter the code sent to you" card showing You → Executor → site, with the model struck out).
2. **Note:** source strip, editorial headline, lede, maths, table, code, figure with an italic caption, an OCR block that needs review (with Mark verified), an edited block, margin cutaway provenance with popovers, Source | Note side by side, YouTube chapters and keyframes, and the PiP.
3. **Library:** search with ⌘K, segmented All/Web/PDF/Video, grid and list views on a spring knob, cards in "product-shot" style with fidelity badges, and a halftone "0" empty state.
4. **Vault:** a cutaway diagram (agent → vault → origin), alias rows with password/TOTP/PIN/email-OTP/passkey field types, session status, and a "Secrets are never shown" panel.
5. **New task:** a "Take notes on…" hero with a halftone sphere, a composer with source chips, ⌘↵ to start, and a 01/02/03 grid for allowed domains, budget and approvals.
