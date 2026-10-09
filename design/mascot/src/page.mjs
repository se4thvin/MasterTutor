// The self-contained comparison page: three concepts in light and dark, the recommendation, and
// every model sheet inline. No external requests.

import { allDefs } from "./defs.mjs";
import { figure } from "./figure.mjs";
import { SHEET_CSS, THEME_VARS, sheet } from "./sheet.mjs";

const RECOMMENDED = "pip";

const FONT =
  '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const PAGE_VARS = {
  light:
    "--bg:#fafafa;--bg-2:#f5f5f7;--elevated:#fff;--label:#1d1d1f;--label-2:#636366;--label-3:#86868b;--sep:rgba(0,0,0,.08);--fill:rgba(118,118,128,.12);--tint:#0071e3;--tint-text:#0066cc;--tint-wash:rgba(0,113,227,.09);--e2:0 0 0 .5px rgba(0,0,0,.08),0 6px 16px rgba(0,0,0,.07),0 1px 3px rgba(0,0,0,.05);--seg-thumb:#fff",
  dark:
    "--bg:#0b0b0c;--bg-2:#161617;--elevated:#1c1c1e;--label:#f5f5f7;--label-2:#a1a1a6;--label-3:#6e6e73;--sep:rgba(255,255,255,.09);--fill:rgba(118,118,128,.24);--tint:#0071e3;--tint-text:#2997ff;--tint-wash:rgba(41,151,255,.14);--e2:0 0 0 .5px rgba(255,255,255,.1),0 8px 24px rgba(0,0,0,.5);--seg-thumb:#5a5a5e",
};
const vars = (t) => `${PAGE_VARS[t]};${THEME_VARS[t]};color-scheme:${t}`;

const SCORES = [
  ["Reads at 24–48 px", ["Strong: the cream face window is a high-contrast target", "Good: face on coral is a little lower in contrast", "Good: but the ears and hood crowd tiny sizes"]],
  ["Light and dark", ["Strong in both", "Strong in both", "Fair: the cream body fades into the light background"]],
  ["Brand fit (HIG colour roles)", ["Continues the hero's aqua and bondi; leaves --tint for controls", "Coral is --signal, which the UI keeps for live and attention cues", "The blue hood is --tint, which HIG keeps for interactive elements"]],
  ["Accessory fit", ["Symmetric egg, every socket works in every view; sprout tucks under hats", "The top curl competes with hats", "Ears and hood fight hats and headphones"]],
  ["Personality range", ["Body tint + one accessory, Dots-style", "Tint swaps, but coral is the identity", "The costume is the identity, hard to vary"]],
  ["3D cost", ["7 meshes · ≈3.2k tris · 2 materials · all code primitives", "6 meshes · ≈2.8k tris · needs a projected face decal", "13 meshes · ≈7.5k tris · authored hood mesh + emissive orb"]],
];

const REASONS = [
  ["Purpose", "An egg with a sprout is a learner: it hatches and grows. The sprout is a built-in progress motif (it can sprout a leaf as notes are finished), and the face window acts as a small soft screen, so every state reads at the sizes the activity stream will use."],
  ["Brand fit", "Its plush is the hero's own --hero-aqua-deep and --hero-bondi, so it inherits the art direction it replaces. It leaves --tint to controls and --signal to alerts, as HIG asks. The cream face holds contrast on #fafafa and on #0b0b0c."],
  ["Accessories and personalities", "The egg is rotationally symmetric, so sockets sit at the same place in every view and every pose. The crown has one small feature that tucks away under hats. Personalities come cheap, the way Dots does them: a body tint plus one accessory (Professor Pip: glasses and a book; Studio Pip: headphones)."],
  ["3D cost", "One LatheGeometry from the egg profile, a face region on the same mesh with a canvas-texture expression atlas, MeshPhysicalMaterial sheen for the plush, and capsules and spheres for limbs. About 3.2k triangles, 2 materials and 5–7 draw calls, built entirely in code like today's hero, with no Blender asset."],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A small inline scene: front figure + one state, in the panel's theme. */
function preview(c) {
  return (
    `<svg viewBox="-150 -300 520 330" class="preview" role="img" aria-label="${esc(c.name)}, front and working">` +
    `<g transform="translate(-20 0)">${figure(c, {})}</g>` +
    `<g transform="translate(250 6) scale(0.82)">${figure(c, { pose: "type", acc: ["laptop"] })}</g>` +
    `</svg>`
  );
}

function avatars(c) {
  return [24, 32, 48, 64]
    .map(
      (s) =>
        `<span class="avatar" style="width:${s}px;height:${s}px"><svg viewBox="-125 ${c.top - 18} 250 ${-c.top + 34}" aria-hidden="true">${figure(c, {})}</svg></span>`,
    )
    .join("");
}

function conceptCard(c) {
  const rec = c.id === RECOMMENDED;
  const chips = c.palette
    .map((p) => `<li><span class="chip" style="background:${p.hex}"></span><span>${esc(p.role)}<small>${p.hex} · ${esc(p.token)}</small></span></li>`)
    .join("");
  return `
<article class="concept${rec ? " recommended" : ""}" aria-labelledby="h-${c.id}">
  <header><p class="eyebrow">Concept ${c.letter}${rec ? ' · <span class="badge">Recommended</span>' : ""}</p>
  <h3 id="h-${c.id}">${esc(c.name)}</h3><p class="tagline">${esc(c.tagline)}</p></header>
  <div class="panels">
    <div class="panel theme-light"><span class="panel-label">Light</span>${preview(c)}<div class="avatars">${avatars(c)}</div></div>
    <div class="panel theme-dark"><span class="panel-label">Dark</span>${preview(c)}<div class="avatars">${avatars(c)}</div></div>
  </div>
  <dl><dt>Body</dt><dd>${esc(c.shape)}</dd><dt>3D</dt><dd>${c.build3d.meshes} meshes · ${esc(c.build3d.tris)} triangles · ${esc(c.build3d.materials)}</dd></dl>
  <ul class="palette" aria-label="Palette">${chips}</ul>
</article>`;
}

function scoreTable(concepts) {
  const head = concepts.map((c) => `<th scope="col"${c.id === RECOMMENDED ? ' class="rec"' : ""}>${esc(c.name)}</th>`).join("");
  const rows = SCORES.map(
    ([k, v]) => `<tr><th scope="row">${esc(k)}</th>${v.map((t, i) => `<td${concepts[i].id === RECOMMENDED ? ' class="rec"' : ""}>${esc(t)}</td>`).join("")}</tr>`,
  ).join("");
  return `<div class="table-wrap"><table><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const CSS = `
:root{${vars("light")}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${vars("dark")}}}
:root[data-theme="dark"]{${vars("dark")}}
.theme-light{${vars("light")}} .theme-dark{${vars("dark")}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--label);font:400 17px/1.47 ${FONT};letter-spacing:-.011em;-webkit-font-smoothing:antialiased}
.bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px max(16px,calc((100vw - 1240px)/2));background:color-mix(in srgb,var(--bg) 72%,transparent);backdrop-filter:saturate(180%) blur(24px);-webkit-backdrop-filter:saturate(180%) blur(24px);border-bottom:.5px solid var(--sep)}
.bar strong{font-size:15px;font-weight:600}
main{max-width:1240px;margin:0 auto;padding:0 16px 96px}
@media (min-width:820px){main{padding:0 32px 96px}}
h1{font-size:clamp(34px,5vw,56px);line-height:1.05;letter-spacing:-.04em;font-weight:700;margin:56px 0 12px}
h2{font-size:28px;letter-spacing:-.024em;line-height:1.2;margin:72px 0 8px;font-weight:700}
h3{font-size:28px;letter-spacing:-.024em;margin:2px 0 4px;font-weight:700}
.lede{font-size:20px;line-height:1.4;color:var(--label-2);max-width:42em;margin:0}
.sub{color:var(--label-2);margin:0 0 24px;max-width:46em}
.eyebrow{margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tint-text)}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--tint);color:#fff;letter-spacing:0;text-transform:none}
.grid{display:grid;gap:20px;grid-template-columns:minmax(0,1fr)}
@media (min-width:1100px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.concept{background:var(--elevated);border-radius:26px;padding:24px;box-shadow:var(--e2);display:flex;flex-direction:column;gap:16px}
.concept.recommended{outline:2px solid var(--tint);outline-offset:-2px}
.tagline{margin:0;color:var(--label-2);font-size:15px;line-height:1.4}
.panels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.panel{position:relative;background:var(--bg);border-radius:18px;padding:28px 6px 10px;color:var(--label);box-shadow:inset 0 0 0 .5px var(--sep)}
.panel-label{position:absolute;top:8px;left:12px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--label-2)}
.preview{display:block;width:100%;height:auto}
.avatars{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:center;gap:8px;margin-top:6px}
.avatar{display:inline-grid;border-radius:50%;background:var(--fill);overflow:hidden}
.avatar svg{width:100%;height:100%}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:15px}
dt{color:var(--label-2);font-weight:600} dd{margin:0}
.palette{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px;font-size:13px;line-height:1.3}
.palette li{display:flex;gap:8px;align-items:center}
.palette small{display:block;overflow-wrap:anywhere;color:var(--label-2);font-size:11px;font-variant-numeric:tabular-nums}
.chip{flex:none;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 .5px var(--sep)}
.reasons{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media (min-width:820px){.reasons{grid-template-columns:repeat(2,minmax(0,1fr))}}
.reason{background:var(--elevated);border-radius:20px;padding:20px 22px;box-shadow:var(--e2)}
.reason h3{font-size:17px;letter-spacing:-.011em;margin:0 0 6px}
.reason p{margin:0;color:var(--label-2);font-size:15px;line-height:1.47}
.table-wrap{overflow-x:auto;margin-top:24px;border-radius:20px;box-shadow:var(--e2);background:var(--elevated)}
table{border-collapse:collapse;width:100%;min-width:720px;font-size:14px;line-height:1.4}
th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:.5px solid var(--sep)}
tbody tr:last-child>*{border-bottom:0}
thead th{font-size:15px}
tbody th{color:var(--label-2);font-weight:600;width:18%}
.rec{background:var(--tint-wash)}
.seg{display:inline-flex;padding:2px;border-radius:9px;background:var(--fill)}
.seg button{font:inherit;font-size:13px;font-weight:500;min-height:28px;min-width:44px;padding:4px 12px;border:0;border-radius:7px;background:none;color:var(--label);cursor:pointer}
.seg button[aria-pressed="true"],.seg button[aria-selected="true"]{background:var(--seg-thumb);box-shadow:0 0 0 .5px rgba(0,0,0,.06),0 2px 6px rgba(0,0,0,.1);font-weight:600}
.seg button:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
.sheet-wrap{margin-top:16px;border-radius:22px;overflow:hidden;box-shadow:var(--e2)}
.sheet-wrap svg{display:block;width:100%;height:auto}
.files{font-size:15px;color:var(--label-2)}
.files code{font:13px ui-monospace,"SF Mono",Menlo,monospace;color:var(--label)}
@media (prefers-reduced-motion:no-preference){.seg button{transition:background .2s cubic-bezier(.16,1,.3,1)}}
${SHEET_CSS}`;

const SCRIPT = `
const root = document.documentElement;
for (const b of document.querySelectorAll("[data-set-theme]")) {
  b.addEventListener("click", () => {
    const t = b.dataset.setTheme;
    if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
    for (const o of document.querySelectorAll("[data-set-theme]")) o.setAttribute("aria-pressed", String(o === b));
  });
}
const tabs = [...document.querySelectorAll('[role="tab"]')];
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
  });
  tab.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    next.focus(); next.click();
  });
}`;

export function comparisonPage(concepts) {
  const rec = concepts.find((c) => c.id === RECOMMENDED);
  const tabs = concepts
    .map(
      (c, i) =>
        `<button role="tab" id="tab-${c.id}" aria-controls="sheet-${c.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(c.name)}</button>`,
    )
    .join("");
  const sheets = concepts
    .map(
      (c, i) =>
        `<div role="tabpanel" id="sheet-${c.id}" aria-labelledby="tab-${c.id}" class="sheet-wrap"${i === 0 ? "" : " hidden"}>${sheet(c, { standalone: false })}</div>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MasterTutor Mascot Concepts</title>
<meta name="description" content="Three plush mascot concepts for MasterTutor, compared in light and dark, with model sheets and a recommendation.">
<style>${CSS}</style></head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${allDefs(concepts)}</svg>
<div class="bar"><strong>MasterTutor mascot</strong>
<div class="seg" role="group" aria-label="Appearance">
<button data-set-theme="system" aria-pressed="true">Auto</button><button data-set-theme="light" aria-pressed="false">Light</button><button data-set-theme="dark" aria-pressed="false">Dark</button>
</div></div>
<main>
<h1>Three plush concepts</h1>
<p class="lede">Soft, toy-like characters built from a few round parts. Every accessory clips onto the same five sockets, so personalities can come later without redrawing the body. Each card shows the same art on both app themes, plus avatar sizes from 24 to 64 px.</p>

<h2>Side by side</h2>
<p class="sub">Front pose and the working state, on the app's light and dark backgrounds.</p>
<div class="grid">${concepts.map(conceptCard).join("")}</div>

<h2>Recommendation: ${esc(rec.name)}</h2>
<p class="sub">${esc(rec.tagline)} It is the clearest at small sizes, it stays within the app's colour roles, it takes accessories in every view, and it is the cheapest to build in three.js.</p>
<div class="reasons">${REASONS.map(([h, p]) => `<section class="reason"><h3>${esc(h)}</h3><p>${esc(p)}</p></section>`).join("")}</div>
${scoreTable(concepts)}

<h2>Model sheets</h2>
<p class="sub">Turnaround with height guides, expressions, accessory sockets and state poses. The sheets follow the appearance switch above.</p>
<div class="seg" role="tablist" aria-label="Concept">${tabs}</div>
${sheets}

<h2>Files</h2>
<p class="files">Standalone sheets: <code>pip-model-sheet.svg</code>, <code>mochi-model-sheet.svg</code>, <code>quill-model-sheet.svg</code>. Build notes for ${esc(rec.name)}: <code>3d-readiness.md</code>. Regenerate with <code>node design/mascot/src/build.mjs</code>.</p>
</main>
<script>${SCRIPT}</script>
</body></html>
`;
}
