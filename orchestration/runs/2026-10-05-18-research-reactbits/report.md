---
run_id: 2026-10-05-18-research-reactbits
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: [2026-10-05-12-design-apple-editorial]
---

## React Bits evaluation for MasterTutor

**Bottom line:** use it as a source to copy from, not as a dependency. Adopt about 7 components that use only `motion`, copy them into `apps/web/components/bits/` and adapt them. Avoid all GSAP and ogl components.

### 1. What it is
- **Repo:** github.com/DavidHDev/react-bits. Checked with `gh` today: about 48.5k stars, 2.4k forks, 2 open issues, last push 2026-10-03 (Masonry and shadcn-CLI fixes), not archived. It is actively maintained.
- **License: MIT plus the Commons Clause** (LICENSE.md). We may use and modify it inside an app or product, including commercially. We may not sell or redistribute the components themselves, alone, bundled or ported. Our deployed app is fine.
  - We must keep the copyright notice: one `LICENSE-react-bits` file in `components/bits/` covers it.
  - It is source-available, not OSI open source. That does not breach CLAUDE.md's "free/open source" rule for services, but it does rule out publishing our adapted versions as a reusable kit.
  - GSAP, which many components use, has its own non-MIT "standard no-charge" license. One more reason to avoid it.
- **Distribution:**
  - No official npm package. The npm name `react-bits` is an unrelated 2022 package.
  - A jsrepo-built shadcn registry: `npx shadcn@latest add @react-bits/<Name>-TS-TW`, or `npx jsrepo@latest add https://reactbits.dev/r/<Name>-TS-TW`. I confirmed `https://reactbits.dev/r/Dock-TS-TW.json` returns 200.
  - Copy-paste from the site.
- **Variants:** four for each component: JS-CSS, JS-TW, TS-CSS, TS-TW. We want **TS-TW**.
- **Catalogue:** 213 components in 5 categories: Text 33, Animations 40, Components 47, Micro 34 (new) and Backgrounds 59.

### 2–3. Dependencies (from scanning every TS-TW import)
| Library | Components using it | Size (Bundlephobia, whole package, gzip) |
|---|---|---|
| ogl | ~60 (most backgrounds) | 34 kB (tree-shakes lower) |
| gsap | ~35 | 27 kB, plus ScrollTrigger and SplitText plugins |
| motion | ~40, including almost all of Micro | 48 kB whole; about 5–15 kB with `LazyMotion`/`m` [unverified for our build] |
| three | ~12 | 185 kB |
| @react-three/fiber | ~8 | +57 kB |
| matter-js | FallingText, FolderFloat | 26 kB |

- **Animation library: `motion` only.** It does springs natively, which matches D21's stiffness ~400 and damping ~30. It has `useReducedMotion`, and the Micro category is built on it.
- **WebGL library: three plus @react-three/fiber, lazy-loaded on New task only**, if run 16's D24 hero needs real 3D. If the hero is a single fragment shader, raw WebGL or ogl is lighter. Pick one only after run 16.
- **Porting:** ogl background shaders are plain GLSL, so they port easily into an r3f `shaderMaterial`. Never ship both ogl and three.
- **Version check needed:** the registry pins `motion@^12.23`, but npm's latest is `motion@14.0.0` [unverified for breaking changes]. Check this before installing.

### 4. Quality risks I found
- **Main-thread animation of paint or layout properties**, which breaks our rule that only transform and opacity animate:
  - BlurText, LatticeLoader, ThoughtLine and Masonry animate `filter: blur`.
  - Dock and Masonry animate `width`/`height`.
  - SpotlightCard calls `setState` on every mousemove to repaint a radial gradient. Fix it with a CSS variable set through a ref.
- **Reduced motion:** absent from almost every older component. Only Micro and a few newer ones honour `prefers-reduced-motion`.
- **SSR and hydration:**
  - Every file already has `"use client"`. No component reads `window` during render.
  - Masonry's `useMedia` initial state differs between server and client, so it will hydrate with a mismatch.
  - Stack and Masonry call `Math.random()` at render time. That is impure and can also mismatch.
- **TypeScript:** clean. No `any` in the shortlisted components (GradualBlur has 9) and no `ts-nocheck`.
- **Styling:**
  - Many components hard-code dark colours (`#120F17`, `bg-[#222]`, `neutral-900`). They need retokenising to our CSS variables.
  - Micro pulls in `@hugeicons/*`. Replace it with our SF-style icon set (D23).
- **GlassSurface** uses SVG `feDisplacementMap` in Chromium only, with a user-agent sniff and a CSS fallback for Safari and Firefox. Our glass spec is plain `backdrop-filter: saturate(180%) blur(24px)` with the reduced-transparency fallback, which is 3 lines of CSS. Skip it.

### Shortlist
| Component | URL | Where it goes | Deps | Reduced motion and a11y | Fit / verdict |
|---|---|---|---|---|---|
| StatusMark | reactbits.dev/micro/status-mark | Run timeline steps; sidebar run status | motion | Yes, plus aria-label | Excellent. **v1** |
| ThoughtLine | reactbits.dev/micro/thought-line | Run view "thinking" row | motion, hugeicons | Yes, plus `role=status` | Excellent. Swap its blur crossfade for opacity. **v1** |
| RubberSegment | reactbits.dev/micro/rubber-segment | Library All/Web/PDF/Video; grid/list toggle | motion | Yes; radiogroup with keyboard support | Excellent. **v1** |
| SwipeToast | reactbits.dev/micro/swipe-toast | Undo toasts for optimistic actions | motion, hugeicons | Yes; aria-live | Good. **v1** |
| CountUp (or Counter) | reactbits.dev/text-animations/count-up | Budget numerals (Run, New task) | motion | **No**, add a check; Counter uses tabular-nums | Good. **v1** |
| CodeSlots | reactbits.dev/micro/code-slots | Run view "Enter the code sent to you" card | motion, hugeicons | Yes | Good. Needs a security review: values never logged and sealed after entry. **v1** |
| SpringCheck | reactbits.dev/micro/spring-check | Vault/Note "Mark verified", approval lists | motion | Yes; `role=checkbox` | Good. **v1** |
| Folder | reactbits.dev/components/folder | Library folders (D23) | none | No; `transition-all`; animates skew | Reference only. Rebuild with motion transforms. **Maybe** |
| AnimatedList | reactbits.dev/components/animated-list | Library list, steps list | motion | No; dark colours hard-coded | Useful pattern only. **Maybe** |
| Stack | reactbits.dev/components/stack | "Note ready" fanned card moment | motion | No; impure random | Port the idea. **Maybe** |
| HoldButton | reactbits.dev/micro/hold-button | Approve a risky action? | none | Yes | It conflicts with the D/E/A approval spec. **Maybe later** |
| Magnet / ClickSpark | reactbits.dev/animations/magnet, reactbits.dev/animations/click-spark | Start button | none (ClickSpark draws on canvas) | No | Gimmicky for Apple editorial. **Maybe later** |
| SpotlightCard | reactbits.dev/components/spotlight-card | Library cards | none | No; setState on every mousemove | **Avoid**; reimplement in 10 lines if wanted |
| Dock | reactbits.dev/components/dock | — | motion | Animates layout | The sidebar stays as in mockup D. **Avoid** |
| GlassSurface / FluidGlass | reactbits.dev/components/glass-surface, reactbits.dev/components/fluid-glass | — | none / three+r3f+drei+maath | — | Use CSS glass instead. **Avoid** |
| Masonry, InfiniteMenu, FolderFloat | reactbits.dev/components/masonry, reactbits.dev/components/infinite-menu, reactbits.dev/micro/folder-float | — | gsap / gl-matrix (1.2k LOC) / matter-js | Masonry: hydration and layout problems | **Avoid** |
| BlurText / SplitText | reactbits.dev/text-animations/blur-text, reactbits.dev/text-animations/split-text | Headlines | motion / gsap | No; filter animation | **Avoid**. A motion word-stagger on opacity/y is about 15 LOC |
| Silk, ModelViewer, ogl backgrounds | reactbits.dev/backgrounds/silk, reactbits.dev/components/model-viewer | New task hero | r3f / ogl | Mostly none | Neon, dark aesthetic that clashes with #FAFAFA. Run 16's input only. **Maybe** |

Skeletons: React Bits has none. LatticeLoader is an agent-status row, not a skeleton, and animates `filter: blur`. Write our own shimmer in CSS.

### 5. Integration recommendation
1. **Copy, don't depend.** Add `"registries": {"@react-bits": "https://reactbits.dev/r/{name}.json"}` to `components.json`. Pull the TS-TW variants with `shadcn add`, and point the `aliases` at `apps/web/components/bits/`. From then on the code is ours.
2. **Adaptation pass for every component, before it lands:**
   - Swap colours for our tokens and hugeicons for our icons.
   - Use the shared spring and easing constants from one motion-tokens module, as the single source of truth.
   - Add or verify `useReducedMotion`.
   - Strip unused props, and replace blur, width or height animation with transforms.
   - Add the license header.
3. **Frontend build phase:**
   - The motion foundation goes in first: `motion` with `LazyMotion` and tokens.
   - The v1 seven are adopted inside their owning feature slices (Run, Library, Vault, toasts), not as a standalone kit.
   - The D28 animation-expert subagent audits each one against the transform/opacity rule and reduced motion.
   - The WebGL choice stays open until run 16 delivers the hero, and only that route lazy-loads it.

Unverified: whether motion 14 is compatible with the ^12 pin, real tree-shaken sizes in our build, and whether the `@react-bits` namespace appears in shadcn's public registry directory. The direct URL form works either way.
