---
run_id: 2026-10-05-16-design-3d-hero
date: 2026-10-05
agent_type: general-purpose
phase: design
status: completed
depends_on: [2026-10-05-12-design-apple-editorial]
---

I built the prototype as one file, `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/.superpowers/brainstorm/62132-1791238228/content/hero-3d.html`. In headless Chrome it ran at a steady 60fps at 1440 and 390px wide, and typing and Start both trigger the reaction. Add `?debug` for an fps readout or `?hero=poster` to force the fallback. The page is light-only (#FAFAFA); I didn't add dark mode.

**The three concepts**
1. **Capture Lens (chosen):** a frosted aqua puck, a nod to the iMac mouse, floats between a web page behind it and a note card in front. You see the page refracted through the glass, so the object itself shows "page → note".
2. **Glass strata:** three stacked glass sheets (page, snapshot, note) with light passing through. It looked good but read as generic "layers", and stacking glass is the most expensive kind of transparency to render.
3. **Orbiting cursor:** a cursor circles the scene and gathers fragments. It's charming but busy, and it repeats the agent cursor already on the Run screen.

I picked the lens because it's one calm hero object (mockup D's "one hero object per screen" rule), it ties directly to the inspiration image, and it has a natural story for the Start reaction.

**Technique**
- **Geometry, all built in code:**
  - the puck is a lathed profile with a rounded rim and a slightly domed top;
  - the cards are extruded rounded rectangles;
  - the page is a canvas-drawn texture: browser chrome, "Logistic regression" heading, a sigmoid figure and a highlighted region being captured.
- **Materials:**
  - the puck is clear glass with a slight frost, an aqua tint inside, a glossy outer coat and a little rainbow edge;
  - inside it sit a teal ring and a soft vermilion dot, like the Apple logo under the mouse's plastic.
- **Lighting:** a studio built in code (softboxes, a dark floor, an aqua kicker light) plus one key light. No HDR file is downloaded.
- **Motion:**
  - **Idle:** slow float, wobble and breathing.
  - **Pointer:** gentle camera parallax on a softer spring so it feels calm.
  - **Focus:** the lens leans toward the composer.
  - **Typing:** each keystroke pulls a small fragment from the page into the lens along an arc, and the lens gives a small pulse.
  - **Start, over about 2.4s:**
    - the lens inhales to 95.5%;
    - the page and a shower of fragments flow into it;
    - it swells back, the dot flashes and a ripple spreads;
    - a new note springs out and writes its lines in at a 35ms stagger;
    - a fresh page springs back in behind.
- **Curves:** every spring uses the D21 constants (stiffness 400, damping 30), and the tweens reuse the mockup's cubic-bezier curves.

**Performance (headless Chrome, Apple M4 Pro)**
- A steady 60fps at pixel ratio 2, using 30 draw calls, about 23.6k triangles and about 0.5–0.7ms of script time per frame.
- Pixel ratio is capped at 2 and steps down to 1.5, then 1, if frames run slow.
- Rendering stopped while the hero was off-screen (1 frame in 0.8s); hidden tabs and a lost graphics context also pause it.
- Shaders compile before the canvas fades in, so the reveal doesn't stutter.

**Bundle cost (measured with esbuild)**
| Piece | Gzipped | Brotli |
|---|---|---|
| Three.js r170, only the parts used | 133KB | 110KB |
| Scene code | 5.6KB | — |
| **Total** | **about 139KB** | **about 115KB** |

That is under the 150KB target. The full Three.js build would be 171KB gzipped.

**Fallbacks**
A CSS poster of the same composition is shown while loading, under reduced motion, without WebGL2 and after a lost graphics context. It fakes the refraction with a background blur and crossfades to the 3D over 700ms. Under reduced motion and without WebGL2, Three.js is never downloaded (checked for reduced motion), and Start only blinks the dot's opacity.

**Porting to Next.js**
Use raw Three.js, not react-three-fiber. React-three-fiber plus its helper library adds roughly 40–60KB gzipped and a second render loop, for one non-interactive scene. Under the bloat-free rule I'd do this:
- Put the scene in its own `hero-3d-scene.ts` that exports `createHero(el)` and `destroy()`. It imports only the Three.js classes it uses.
- A small `<Hero3D>` client component renders the poster and the canvas. On mount it waits until the hero is near the viewport and the browser is idle, checks for reduced motion and WebGL2, then loads the scene with a dynamic `import()`. It calls `destroy()` on unmount.
- The composer sends `hero:type`, `hero:focus` and `hero:start` DOM events, so it never imports any 3D code.
- Bundle Three.js locally rather than from a CDN, and keep it out of the shared chunk.
