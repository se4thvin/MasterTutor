---
run_id: 2026-10-05-16-design-3d-hero
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-12-design-apple-editorial]
---

You are a specialist in real-time 3D rendering and eye-catching 3D web elements: WebGL/Three.js, shaders, physically based materials, glass/transmission, and motion design. Your job is to design and prototype the 3D hero for the "New task" page of our agentic note-taking web app. Treat this as a design exploration: a throwaway prototype that will later be ported into the real app.

**Read first:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` (especially D17, D21, D24, D25, D28) and `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-12-design-apple-editorial/report.md` (the design language)
- The current mockup: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/mock-d-apple.html`, specifically the New task screen with its halftone sphere. The user rejected that sphere and wants a clean, delightful 3D animation instead.
- Inspiration images, viewed with the Read tool: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/design/inspiration/01.png`, which is the translucent iMac puck mouse in "Think different". Aqua-translucent polycarbonate is a strong cue.

**Brief:**
- The page background is **#FAFAFA**. The look is Apple editorial: clean, premium and calm, but eye-catching.
- The object should express what the product does. An agent captures the web faithfully into notes. Possible metaphors include:
  - a translucent glass "capture" object that refracts a page into a note card;
  - layered glass sheets (web page → note) with light passing through;
  - a softly orbiting cursor that gathers fragments.
- Propose 3 concepts briefly, then build the best one.
- **Motion:**
  - A slow idle loop.
  - A gentle parallax response to the pointer.
  - A delightful reaction when the user types in the composer or presses Start, e.g. the object "inhales" or captures.
  - Spring curves that match D21, at 60fps.
- **Constraints (bloat-free, D9):**
  - Lazy-load only on the New task page.
  - Three.js from a CDN is fine for the prototype. Note what the production bundle would cost; aim for ≤150KB gzipped of extra JS, or justify more.
  - No paid services and no external 3D assets: the geometry must be procedural or built in code.
  - Use a static, beautiful fallback (CSS or poster) under `prefers-reduced-motion`, without WebGL, and while loading.
  - Pause rendering when off-screen or the tab is hidden.
  - Cap DPR at 2.

**Output:**
Write one self-contained HTML prototype, with Three.js from cdnjs/jsdelivr allowed, to exactly:
`/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/hero-3d.html`

It should show the hero in context on a #FAFAFA New-task layout: the "Take notes on…" heading, the composer input, source chips and a Start button. Typing and pressing Start must trigger the reaction. Test it in headless Chrome if you can.

**Final reply (under 500 words):**
- the 3 concepts and the one you chose, with reasons;
- the technique (materials, lighting, geometry, motion curves);
- performance numbers and bundle estimate;
- fallbacks;
- how to port it into Next.js (a lazy client component, e.g. raw Three.js vs react-three-fiber, with your recommendation under the bloat-free rule).
