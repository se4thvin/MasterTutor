# Pip: 3D readiness note

The recommended concept is **Pip (concept A)**. This note is the handoff to the 3D designer and renderer agents. The source of truth is the three.js build in `design/mascot/src/three/`, with colours in `src/concepts.mjs`. `sheets/pip-model-sheet-{light,dark}.jpg` show the result.

**Units:** 1 u = Pip's body height (220 px on the sheet). The ground is y = 0, +z faces the viewer, and the origin sits between the feet.

## 1. Primitive breakdown

This is the build that produced the renders (`src/three/characters.js`, `BUILDERS.pip`). The app version is the same code at `setDetail("app")`.

| Part | three.js build | Size and position (u) | Material |
|---|---|---|---|
| Body | `LatheGeometry` of the egg profile `r = 0.41·sin a·(1 + 0.12·cos a)`, 24 × 16 segments (app). The seam sits at the back (phiStart π). | y 0.03 → 1.03, max radius 0.41 below the middle | Clay `#55b8b5` |
| Face pad | `SphereGeometry` scaled to (0.265, 0.225, 0.13), pressed into the front of the egg so it bulges about 0.045 | centre (0, 0.56, surface − 0.085) | Clay `#fff4e6`, lower gloss |
| Face rim | A closed `TubeGeometry` (r 0.03) through 48 points ray-cast onto the pad and body seam | rings the pad | Clay `#1f8f96` |
| Eyes, mouth, cheeks | For the renders, glossy ellipsoid "beans" and rope tubes ray-cast onto the pad (`src/three/face.js`). **In the app**, an 8-cell `CanvasTexture` atlas on the pad (UV offset per expression; a blink is a 2-cell flip). | eyes at y 0.575, ±0.105 apart | Atlas on the pad material |
| Arms ×2 | `CapsuleGeometry(0.07, 0.12)` hanging from a pivot | pivot (±0.37, 0.46, 0.03) | Body clay |
| Feet ×2 | `SphereGeometry` scaled (0.12, 0.065, 0.15) | (±0.155, 0.055, 0.05) | Rim clay |
| Sprout | Stem tube (r 0.017, 3 points) and 2 flattened ellipsoid leaves | from the crown (0, 1.03) up to about 1.16 | Clay `#34c759` |
| Contact shadow | One plane with a radial-alpha canvas texture, plus the key light's soft shadow | about 1.0 × 0.6 | `MeshBasicMaterial`, transparent |

**Measured budget (app detail, facial features excluded):** 4,392 triangles, 12 meshes and 4 clay colours. Merged by material (`BufferGeometryUtils.mergeGeometries` per colour, with the arm pivots kept separate), that is about 4–6 draw calls. It needs no glTF or texture downloads. For comparison, Mochi is 3,272 triangles, Quill 7,096 and Memo 5,460.

### Clay material (`src/three/shapes.js` → `clay()`)
- `MeshPhysicalMaterial`: `roughness 0.68`, `clearcoat 0.32`, `clearcoatRoughness 0.42`, `sheen 0.55` (sheenColor = the base colour 55% toward white), `sheenRoughness 0.55`, `metalness 0`.
- Subsurface warmth is faked with `emissive` = the base colour 35% toward `#ff9a6a`, at `emissiveIntensity 0.045`. It is cheaper than transmission and reads as warm clay.
- Studio: a `RoomEnvironment` PMREM (code-built, no HDR) at `environmentIntensity 0.3`; a key light `#fff3e6` at 3.3 from the upper left (soft PCF shadow, 1024²); a fill `#dfe9ff` at 0.22 from the right; a rim light at 1.5 from behind; and a hemisphere bounce `#ffffff`/`#c9a487` at 0.32. `NeutralToneMapping`, the same as the hero. The key-left / fill-right split gives the claymorphic top-left highlight and bottom-right inner shadow.
- For the app, reuse the hero's code-built studio (`components/hero/scene/studio.ts`), which already re-tints for dark mode, and raise the rim light in dark mode so the silhouette holds on #0b0b0c.

## 2. Rig points (an object hierarchy, not a skinned skeleton)

Pip needs no bones. Each part is an `Object3D` pivot, and squash and stretch is applied to `root.scale`.

```
root (ground, between the feet): squash/stretch, hop, lean
└─ body (y 0.43): breathing, tilt, look turn (y-rotation ±25°, so the face slides like the 3/4 view)
   ├─ face (UV-offset controller: expression, blink)
   ├─ crown        (0, 1.03, 0)
   ├─ arm.L pivot  (−0.37, 0.46, 0.03) → hand.L at the capsule tip
   ├─ arm.R pivot  ( 0.37, 0.46, 0.03) → hand.R at the capsule tip
   ├─ neck         front surface at y 0.30
   └─ lap          front surface at y 0.24
├─ foot.L (−0.155, 0.055, 0.05)
└─ foot.R ( 0.155, 0.055, 0.05)
```

The feet stay planted on `root`, so the body can lean and hop without the feet sliding.

## 3. Accessory sockets

All seven accessories in the renders (glasses, beret, headphones, bowtie, book, laptop, party hat; `src/three/accessories.js`) are built this way. Every accessory is its own small `Group`, authored around its socket's origin, and it only ever attaches to one of these sockets. One accessory therefore fits every concept and every pose, which is what the later personalisation work needs.

| Socket | Parent | Local origin (u) | Orientation | Used by | Rule |
|---|---|---|---|---|---|
| `crown` | body | (0, 1.03, 0) | +y = surface normal | beret, caps, party hat | A hat with `takesCrown: true` hides the sprout. |
| `eyes` | body (face pad) | the pad's front surface at y 0.575 | +z = out of the face | glasses, sunglasses | Moves with the look turn. Needs a z-offset of 0.01 against z-fighting. |
| `ear.L` / `ear.R` | body | the side surface at y 0.6 (about ±0.41) | ±x outward | headphones (cups) | The band is one torus arc through `crown`. |
| `hand.L` / `hand.R` | arm pivot tip | capsule tip | +y along the arm | wand, pencil, flag | Follows the arm animation. |
| `lap` | body | the front surface at y 0.24 | +z toward the viewer | laptop, book, orb | Held items use the `hold` arm pose (−50°). |
| `neck` | body | the front surface at y 0.30 | +z = the surface normal | bowtie, scarf, badge | Below the face pad, in the style of the Dots bowties. |

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
| **celebrating** | run finished | Party hat on `crown`, squash (0.9 y), then stretch and jump (0.09–0.12 u), both arms at 150°, a confetti burst, land squash, sprout grows a leaf | happy | 900 ms (squash 120, jump 300, spin 300, land 180) |
| **oops** | run error | Shrink (scale 0.94), a quick shake of ±4° × 3, arms in, sweat-drop sprite | a dedicated "oops" atlas cell (wobbly mouth) | shake 3 × 90 ms (`press`); hold until dismissed |

Transitions between states blend arm angles and the look turn with the spring. Expressions swap on the frame where the motion peaks, so a swap never shows mid-move. To keep the hero's pacing, render only while a state is animating, and drop to the hero's idle frame rate (`scene/pacing.ts`) during idle and dozing.

## 5. Notes for the renderer

- Replace `hero-3d-scene.ts`'s lens and page scene with Pip, and keep `hero-3d.tsx`, `hero-gate.ts`, the poster fallback and the idle pacing. The poster can be the front sheet view as an SVG.
- Map run events to states in one module (`mascot-state.ts`) and keep the scene free of run logic.
- Personality tint swaps must stay off the token palette's interactive colours: never `--tint`, and never `--signal` for the body.
