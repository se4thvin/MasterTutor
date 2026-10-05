---
run_id: 2026-10-05-18-research-reactbits
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-12-design-apple-editorial]
---

This is a research task: web research plus npm/GitHub checks. Return the report as your final reply. Do not write any files in the repo. Today is 2026-10-05.

**Read first for context:**
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md`: decisions D17, D21, D23–D28. In short: Apple editorial "Cutaway" design, #FAFAFA background, glass UI, Daylight-style springs, a 3D hero on New task, takeover by clicking into the preview, and delightful motion everywhere.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/CLAUDE.md`: be strict about bloat-free, decoupled and readable code.
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-12-design-apple-editorial/report.md`: the design-language spec.

Stack: Next.js 16 (App Router, React 19), Tailwind v4, shadcn/ui, TypeScript.

The user says https://reactbits.dev/ has many components we can use directly. Evaluate it thoroughly:
1. **What React Bits is.** Cover:
   - license, and whether it is safe for our deployed app;
   - how components are distributed: copy-paste, the shadcn registry / `jsrepo` CLI, or an npm package;
   - the variants on offer (JS/TS × CSS/Tailwind);
   - maintenance, stars and activity as of 2026.
2. **Catalogue.** Go through the categories: text animations, animations, components, backgrounds. Shortlist the components that fit our product and design language. Candidates to look at include:
   - the glass components (e.g. GlassSurface / FluidGlass);
   - Dock;
   - SpotlightCard;
   - Magnet / ClickSpark / animated lists;
   - counters for budget numerals;
   - text reveals for headlines;
   - folder components (D23 folders);
   - Stack, Masonry, InfiniteMenu;
   - 3D or shader backgrounds that could support the 3D hero (D24);
   - skeleton or loader components.

   For each shortlisted component, give: where in our UI it would go (Run view, Note reader, Library, Vault, New task, sidebar), its dependencies (motion/framer-motion, GSAP, three, ogl, @react-three/fiber, matter-js, etc.) with approximate bundle cost, accessibility and `prefers-reduced-motion` handling, and fit with the Apple editorial plus #FAFAFA look.
3. **Dependency hygiene.** Many components use different animation libraries (GSAP vs motion vs ogl vs three). Recommend a maximum of **one** animation library (probably `motion`) and at most one WebGL lib, and keep only components compatible with that choice. Alternatively, recommend porting a component to our chosen lib.
4. **Quality risks.** Look for performance problems (box-shadow or filter animations, layout thrash), SSR/`"use client"` issues with Next 16, and TypeScript quality.
5. **Integration recommendation.**
   - Copy into `apps/web/components/bits/` via the shadcn registry, owned and adapted by us, or install as a dependency.
   - Which components to adopt for v1, maybe-later, and avoid.
   - How they feed into the frontend build phase.

Final reply: a report under 900 words, with a table of shortlisted components, URLs, and [unverified] flags.
