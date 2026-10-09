# Pip: 3D readiness note

The recommended concept is **Pip (concept A)**. This note is the handoff to the 3D designer and renderer agents. The source of truth for shapes and colours is `design/mascot/src/concepts.mjs`, and `pip-model-sheet.svg` shows the result.

**Units:** 1 u = Pip's body height (220 px on the sheet). The ground is y = 0, +z faces the viewer, and the origin sits between the feet.

## 1. Primitive breakdown

| Part | three.js build | Size (u) | Material | Notes |
|---|---|---|---|---|
| Body | `LatheGeometry` from the egg profile (sheet path `concepts.pip.body`), 32 radial × 24 profile segments | height 1.00 (y 0.027 → 1.027), max radius 0.409 at y 0.436 | Fabric | Widest below the middle. The egg is rotationally symmetric, so one profile serves every view. |
| Face window | Same mesh, with no extra geometry. A UV region on the front of the body (ellipse centre y 0.555, rx 0.273, ry 0.227) | — | Face atlas (second material group, or one shader with a mask) | Cream fleece, a darker rim ring 0.018 wide, and a dashed stitch 0.04 outside the rim. All three are painted into the atlas. |
| Eyes, mouth, cheeks | Painted into a `CanvasTexture` expression atlas: 8 cells of 256², one per expression | eyes at y 0.573, ±0.105 apart, 0.068 × 0.091 | Face atlas | Swapping expression = offsetting the UV. There are no blend shapes and no extra draw calls. Blinks are a 2-cell flip. |
| Arms ×2 | `CapsuleGeometry(r 0.061, length 0.164, 4, 12)` | pivot (±0.364, 0.455, 0.05) | Fabric | Pivot at the top cap. Rest angle is 16° outward. |
| Feet ×2 | `SphereGeometry(16, 12)` scaled (0.127, 0.059, 0.15) | centre (±0.155, 0.036, 0.04) | Fabric, darker tone (`--hero-bondi` → #17767c) | Half buried under the body. |
| Sprout stem | `TubeGeometry` along a 3-point curve, r 0.01 | from the crown (0, 1.027) up to (0.014, 1.11) | Leaf | |
| Leaves ×2 | `SphereGeometry(12, 8)` scaled flat (0.05, 0.012, 0.027) | (−0.04, 1.12), (0.068, 1.14), rolled −28° and +24° | Leaf | Hidden whenever a hat uses the crown. |
| Contact shadow | One `PlaneGeometry` with a radial-alpha texture | 0.7 × 0.08 | `MeshBasicMaterial`, transparent | Cheaper than shadow maps. |

**Budget:** 7 meshes, about 3.2k triangles, 2–3 materials and 5–7 draw calls. It has no textures to download (the atlas and the shadow are drawn on a canvas at start) and no glTF. With `InstancedMesh` for the limbs it drops to 5 draw calls.

### Materials
- **Fabric:** `MeshPhysicalMaterial` with `color #5cb9b6`, `roughness 0.85`, `sheen 1`, `sheenRoughness 0.6`, `sheenColor #b4e3df`. Sheen is what makes the plush read as plush, and it is built into three.js. Add a tiling 128² normal-noise texture (made on a canvas) at `normalScale 0.15` for the fuzz. Leave out clearcoat and transmission.
- **Face atlas:** `MeshStandardMaterial`, roughness 0.9, with the map set to the expression atlas.
- **Leaf:** `MeshStandardMaterial #34c759` (`--switch-on`), roughness 0.6.
- **Lighting:** reuse the hero's code-built PMREM studio (`components/hero/scene/studio.ts`), which already re-tints for dark mode. Add one key light and one soft rim light, the rim brighter in dark mode so the silhouette holds on #0b0b0c. Use the same `NeutralToneMapping` as the hero.

## 2. Rig points (an object hierarchy, not a skinned skeleton)

Pip needs no bones. Each part is an `Object3D` pivot, and squash and stretch is applied to `root.scale`.

```
root (ground, between the feet): squash/stretch, hop, lean
└─ body (y 0.43): breathing, tilt, look turn (y-rotation ±25°, so the face slides like the 3/4 view)
   ├─ face (UV-offset controller: expression, blink)
   ├─ crown        (0, 1.027, 0)
   ├─ arm.L pivot  (−0.364, 0.455, 0.05) → hand.L at the capsule tip
   ├─ arm.R pivot  ( 0.364, 0.455, 0.05) → hand.R at the capsule tip
   └─ lap          (0, 0.18, 0.36)
├─ foot.L (−0.155, 0.036, 0.04)
└─ foot.R ( 0.155, 0.036, 0.04)
```

The feet stay planted on `root`, so the body can lean and hop without the feet sliding.

## 3. Accessory sockets

Every accessory is its own small `Group`, authored around its socket's origin, and it only ever attaches to one of these sockets. One accessory therefore fits every concept and every pose, which is what the later personalisation work needs.

| Socket | Parent | Local origin (u) | Orientation | Used by | Rule |
|---|---|---|---|---|---|
| `crown` | body | (0, 1.027, 0) | +y = surface normal | beret, caps, party hat | A hat with `takesCrown: true` hides the sprout. |
| `eyes` | body (face plane) | (0, 0.573, 0.33) | +z = out of the face | glasses, sunglasses | Moves with the look turn. Needs a z-offset of 0.01 against z-fighting. |
| `ear.L` / `ear.R` | body | (±0.4, 0.573, 0) | ±x outward | headphones (cups) | The band is one torus arc through `crown`. |
| `hand.L` / `hand.R` | arm pivot tip | capsule tip | +y along the arm | wand, pencil, flag | Follows the arm animation. |
| `lap` | body | (0, 0.18, 0.36) | +z toward the viewer | laptop, book, orb | Held items use the `hold` arm pose (−50°). |
| `neck` (spare) | body | (0, 0.36, 0.3) | +z | bowtie, scarf, badge | Below the face window, in the style of the Dots bowties. |

**Accessory contract (for the later code):** `{ id, socket, takesCrown?, pose?, build(): Group }`. A personality is `{ bodyTint, accessories: id[] }`; it changes only the fabric `color`/`sheenColor` and the attached groups.

## 4. Animation list

Timings follow `apps/web/lib/motion-tokens.ts`. Loops use sine easing. One-shots use `springs.spring` (400/30), or `springSoft` (260/30) for large moves. Under `prefers-reduced-motion`, the loops stop and every state change is an expression swap plus a crossfade of `durations.base` (200 ms).

| State | Trigger (run events) | Motion | Expression | Timing |
|---|---|---|---|---|
| **idle** | nothing for 4 s | Breathing: body scale y 1 ↔ 1.015, x 1 ↔ 0.992. Blink every 3–6 s (random). | neutral | 3.2 s loop; blink 120 ms (`micro`) |
| **dozing** | idle for 60 s | Head lean of −6°, slower breath, "z" sprites rising and fading (3, staggered) | sleepy | 4.8 s loop; z every 1.6 s (`pulse`) |
| **waving** | page load, sign-in | arm.R from 16° to 150°, then 3 wiggles of ±18°; root hop of 0.03 u | happy | 1.2 s total (spring in, 3 × 260 ms wiggles, spring out) |
| **working** | the agent is acting (navigate, extract, write note) | Laptop at `lap`, arms at −38° alternating ±6° (typing), look down, screen glow pulse | focused | 180 ms per key alternation; glow 1.6 s loop |
| **thinking** | the model is planning (no tool call yet) | arm.R at −150° (hand to cheek), body tilt of 4°, 3 bubbles that pop in one after another, then a cloud with dots cycling | thinking | bubbles staggered 120 ms; dots 1.3 s loop (`shimmer`) |
| **reading** | the agent is reading a page or PDF | Book at `lap`, look turn sweeping left → right, page flip every few seconds | focused | 2.6 s sweep (`drift`); flip 300 ms (`panel`) |
| **curious / looking** | a new source opens or the live view focuses | Body turns ±20° toward the activity, rises onto its toes (root y +0.02) | neutral, pupils offset | spring 455 ms |
| **waiting for you** | an approval is needed | Faces the viewer and does a small hop every 2.4 s. A small hand raise (arm.R to 60°) | neutral, eyebrow up | hop 300 ms; repeats every 2.4 s (`flash`) until resolved |
| **celebrating** | run finished | Squash (0.9 y), then stretch and jump (0.12 u), both arms at 150°, spin of 360° about y, land squash, sprout grows a leaf | happy | 900 ms (squash 120, jump 300, spin 300, land 180) |
| **oops** | run error | Shrink (scale 0.94), a quick shake of ±4° × 3, arms in, sweat-drop sprite | a dedicated "oops" atlas cell (wobbly mouth) | shake 3 × 90 ms (`press`); hold until dismissed |

Transitions between states blend arm angles and the look turn with the spring. Expressions swap on the frame where the motion peaks, so a swap never shows mid-move. To keep the hero's pacing, render only while a state is animating, and drop to the hero's idle frame rate (`scene/pacing.ts`) during idle and dozing.

## 5. Notes for the renderer

- Replace `hero-3d-scene.ts`'s lens and page scene with Pip, and keep `hero-3d.tsx`, `hero-gate.ts`, the poster fallback and the idle pacing. The poster can be the front sheet view as an SVG.
- Map run events to states in one module (`mascot-state.ts`) and keep the scene free of run logic.
- Personality tint swaps must stay off the token palette's interactive colours: never `--tint`, and never `--signal` for the body.
