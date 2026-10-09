// HTML for the model sheets and the self-contained comparison page. Renders are inlined once as
// CSS custom properties (data: URLs) and reused by every element that shows them.

import { RECOMMENDED } from "./concepts.mjs";
import { ACCESSORY_SHOTS, EXPRESSIONS, SHOTS, STATES, VIEWS } from "./shots.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const pct = (v) => `${(v * 100).toFixed(2)}%`;
const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const THEMES = {
  light: "--bg:#fafafa;--bg-2:#f5f5f7;--elevated:#fff;--label:#1d1d1f;--label-2:#636366;--label-3:#86868b;--sep:rgba(0,0,0,.08);--fill:rgba(118,118,128,.12);--tint:#0071e3;--tint-text:#0066cc;--tint-wash:rgba(0,113,227,.09);--card:#ffffff;--well:linear-gradient(180deg,#ffffff,#f3f3f6);--e2:0 0 0 .5px rgba(0,0,0,.08),0 6px 16px rgba(0,0,0,.07),0 1px 3px rgba(0,0,0,.05);--seg-thumb:#fff;color-scheme:light",
  dark: "--bg:#0b0b0c;--bg-2:#161617;--elevated:#1c1c1e;--label:#f5f5f7;--label-2:#a1a1a6;--label-3:#6e6e73;--sep:rgba(255,255,255,.09);--fill:rgba(118,118,128,.24);--tint:#0071e3;--tint-text:#2997ff;--tint-wash:rgba(41,151,255,.14);--card:#1c1c1e;--well:radial-gradient(120% 90% at 50% 30%,#3a3a3e,#1c1c1e 70%);--e2:0 0 0 .5px rgba(255,255,255,.1),0 8px 24px rgba(0,0,0,.5);--seg-thumb:#5a5a5e;color-scheme:dark",
};

const CSS = `
:root{${THEMES.light}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${THEMES.dark}}}
:root[data-theme="dark"]{${THEMES.dark}}
.theme-light{${THEMES.light}} .theme-dark{${THEMES.dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--label);font:400 17px/1.47 ${FONT};letter-spacing:-.011em;-webkit-font-smoothing:antialiased}
.shot{position:relative;aspect-ratio:1;background:center/contain no-repeat;border-radius:inherit}
/* Sheet */
.sheet{background:var(--bg);color:var(--label);padding:clamp(20px,4vw,56px);font-family:${FONT}}
.sh-head{display:flex;flex-wrap:wrap;gap:24px 48px;justify-content:space-between;align-items:flex-start}
.eyebrow{margin:0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tint-text)}
.sh-name{margin:4px 0 6px;font-size:clamp(40px,6vw,72px);line-height:1;font-weight:700;letter-spacing:-.04em}
.sh-tag{margin:0;font-size:20px;line-height:1.35;color:var(--label-2);max-width:34em}
.sh-shape{margin:6px 0 0;font-size:15px;color:var(--label-3)}
.sh-palette{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px 20px;flex:1 1 420px;max-width:620px;font-size:14px;line-height:1.3}
.sh-palette li{display:flex;gap:10px;align-items:center}
.sh-palette small{display:block;color:var(--label-2);font-size:12px;font-variant-numeric:tabular-nums}
.chip{flex:none;width:30px;height:30px;border-radius:50%;box-shadow:inset 0 -3px 6px rgba(0,0,0,.18),inset 0 3px 5px rgba(255,255,255,.45),0 2px 6px rgba(0,0,0,.15)}
.sh-sec{margin:44px 0 14px;padding-top:20px;border-top:.5px solid var(--sep);font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--label-2)}
.sh-row{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:900px){.sh-row.four{grid-template-columns:repeat(4,minmax(0,1fr))}.sh-row.five{grid-template-columns:repeat(5,minmax(0,1fr))}.sh-row.six{grid-template-columns:repeat(6,minmax(0,1fr))}}
.card{margin:0;background:var(--card);border-radius:22px;overflow:hidden;box-shadow:var(--e2)}
.card .shot{background-color:transparent;border-radius:0}
.card{background:var(--well)}
.card figcaption{background:var(--card);padding:10px 16px 14px;display:flex;flex-direction:column;gap:1px}
.card strong{font-size:15px;font-weight:600}
.card span{font-size:12px;color:var(--label-2)}
.guide{position:absolute;left:0;right:0;border-top:1px dashed var(--tint-text);opacity:.55}
.guide b{position:absolute;left:8px;top:-17px;font-size:11px;font-weight:600;color:var(--tint-text)}
.width{position:absolute;height:10px;border:1.5px solid var(--tint-text);border-top:0;opacity:.8}
.width b{position:absolute;left:100%;top:-2px;margin-left:6px;font-size:11px;font-weight:600;color:var(--tint-text);white-space:nowrap}
.sock{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:2px solid var(--tint-text);background:color-mix(in srgb,var(--tint-text) 18%,transparent)}
.sock.flip b{left:auto;right:18px}
.sock b{position:absolute;left:18px;top:-3px;font-size:11px;font-weight:600;color:var(--tint-text);white-space:nowrap}
.sh-foot{margin-top:36px;padding-top:16px;border-top:.5px solid var(--sep);display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;font-size:13px;color:var(--label-2)}
`;

function imageVars(concepts, img) {
  const vars = [];
  for (const c of concepts) for (const s of SHOTS(c)) vars.push(`--i-${c.id}-${s.id}:url(${img(c, s.id)})`);
  return `:root{${vars.join(";")}}`;
}

const shot = (c, id, label, inner = "", cls = "") =>
  `<div class="shot ${cls}" role="img" aria-label="${esc(`${c.name}: ${label}`)}" style="background-image:var(--i-${c.id}-${id})">${inner}</div>`;
const card = (c, id, title, sub, inner = "") =>
  `<figure class="card">${shot(c, id, title, inner, "well")}<figcaption><strong>${esc(title)}</strong><span>${esc(sub)}</span></figcaption></figure>`;

function turnGuides(m, first) {
  const g = m.ground[1];
  const top = m.top[1];
  const eye = m.eyes[1];
  const eyeF = (g - eye) / (g - top);
  const line = (y, t) => `<div class="guide" style="top:${pct(y)}">${first ? `<b>${t}</b>` : ""}</div>`;
  const width = first
    ? `<div class="width" style="left:${pct(m.left[0])};width:${pct(m.right[0] - m.left[0])};top:${pct(g + 0.03)}"><b>W ${((m.right[0] - m.left[0]) / (g - top)).toFixed(2)} H</b></div>`
    : "";
  return line(top, "1.00 H") + line(eye, `eye ${eyeF.toFixed(2)}`) + line(g, "0") + width;
}

function socketMarks(m) {
  return ["crown", "eyes", "ear.L", "ear.R", "neck", "hand.R", "lap"]
    .map((k) => `<span class="sock${["lap", "ear.L"].includes(k) ? " flip" : ""}" style="left:${pct(m[k][0])};top:${pct(m[k][1])}"><b>${k}</b></span>`)
    .join("");
}

export function sheetSection(c, data) {
  const d = data[c.id];
  const chips = c.palette
    .map(([role, key, token]) => `<li><span class="chip" style="background:${c.colors[key]}"></span><span>${esc(role)}<small>${c.colors[key]} · ${esc(token)}</small></span></li>`)
    .join("");
  const turn = VIEWS.map(([v, t, s], i) => card(c, `turn-${v}`, t, s, turnGuides(d.shots[`turn-${v}`], i === 0))).join("");
  const expr = EXPRESSIONS.map(([e, t, s]) => card(c, `expr-${e}`, t, s)).join("");
  const acc =
    card(c, "acc-none", "Sockets", "crown · eyes · ears · neck · hands · lap", socketMarks(d.shots["acc-none"])) +
    ACCESSORY_SHOTS(c).map(([a, t, s]) => card(c, `acc-${a}`, t, s)).join("");
  const states = STATES.map(([s, t, sub]) => card(c, `state-${s}`, t, sub)).join("");
  const st = d.stats;
  return `<section class="sheet" aria-label="${esc(c.name)} model sheet">
<header class="sh-head"><div><p class="eyebrow">Concept ${c.letter} · Model sheet</p><h3 class="sh-name">${esc(c.name)}</h3><p class="sh-tag">${esc(c.tagline)}</p><p class="sh-shape">${esc(c.shape)}</p></div><ul class="sh-palette" aria-label="Palette">${chips}</ul></header>
<h4 class="sh-sec">Turnaround · orthographic · guides in units of height (H)</h4><div class="sh-row four">${turn}</div>
<h4 class="sh-sec">Expressions</h4><div class="sh-row four">${expr}</div>
<h4 class="sh-sec">Accessory sockets · swappable clay pieces</h4><div class="sh-row six">${acc}</div>
<h4 class="sh-sec">States</h4><div class="sh-row five">${states}</div>
<footer class="sh-foot"><span>Low-poly app build: ${st.tris.toLocaleString("en")} triangles · ${st.meshes} meshes · ${st.colors} clay colours (≈${st.colors} draw calls merged by material) · face features become a texture atlas</span><span>Rendered from the three.js build · MeshPhysicalMaterial clay · 2026-10-08</span></footer>
</section>`;
}

/** A standalone page holding one sheet, for the JPEG exports. */
export function sheetDocument(c, data, img, theme) {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${CSS}${imageVars([c], img)} .sheet{width:1600px;padding:56px}</style></head><body>${sheetSection(c, data)}</body></html>`;
}

const SCORES = {
  "Purpose": ["A learner that grows: the sprout is a ready-made progress motif", "Pure cheer, with no link to notes or learning", "A scholar with a light of knowledge: a strong story", "Literally a note: on the nose, less of a character"],
  "Reads at 24–48 px": ["Strong: the cream face pad is a high-contrast target", "Good: the face sits on coral, so contrast is a little lower", "Good, but the ears and hood crowd tiny sizes", "Strong, though at small sizes it reads like an app icon"],
  "Light and dark": ["Strong in both", "Strong in both", "Fair: the cream body fades on the light background", "Good: the pale blue sits close to light backgrounds"],
  "Brand fit (HIG colour roles)": ["Continues the hero's aqua and bondi, and leaves --tint to controls", "Coral is --signal, which the UI keeps for live and attention cues", "The blue hood is --tint, which HIG keeps for interactive elements", "Folder blue ties to the Library, but a blue square reads as a file or control"],
  "Accessory fit": ["Symmetric egg, so every socket works in every view; the sprout tucks under hats", "The top tip competes with hats", "The ears crowd hats and headphones", "The flat top takes hats well; the clip competes with them"],
};

function scoreTable(concepts, data) {
  const rec = (c) => (c.id === RECOMMENDED ? ' class="rec"' : "");
  const head = concepts.map((c) => `<th scope="col"${rec(c)}>${esc(c.name)}</th>`).join("");
  const rows = Object.entries(SCORES)
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th>${v.map((t, i) => `<td${rec(concepts[i])}>${esc(t)}</td>`).join("")}</tr>`)
    .join("");
  const cost = concepts
    .map((c) => {
      const s = data[c.id].stats;
      return `<td${rec(c)}>${s.tris.toLocaleString("en")} tris · ${s.meshes} meshes · ${s.colors} colours</td>`;
    })
    .join("");
  return `<div class="table-wrap"><table><thead><tr><td></td>${head}</tr></thead><tbody>${rows}<tr><th scope="row">3D cost (low-poly app build)</th>${cost}</tr></tbody></table></div>`;
}

function conceptCard(c, data) {
  const s = data[c.id].stats;
  const panel = (theme) =>
    `<div class="panel theme-${theme}"><span class="panel-label">${theme === "light" ? "Light" : "Dark"}</span><div class="pair">${shot(c, "turn-front", "front")}${shot(c, "state-waving", "waving")}</div>` +
    `<div class="avatars">${[24, 32, 48, 64].map((n) => `<span class="avatar" style="width:${n}px;height:${n}px;background-image:var(--i-${c.id}-expr-neutral)"></span>`).join("")}</div></div>`;
  const rec = c.id === RECOMMENDED;
  return `<article class="concept${rec ? " recommended" : ""}" aria-labelledby="h-${c.id}">
<header><p class="eyebrow">Concept ${c.letter}${rec ? ' · <span class="badge">Recommended</span>' : ""}</p><h3 id="h-${c.id}">${esc(c.name)}</h3><p class="tagline">${esc(c.tagline)}</p></header>
<div class="panels">${panel("light")}${panel("dark")}</div>
<dl><dt>Body</dt><dd>${esc(c.shape)}</dd><dt>3D</dt><dd>${s.tris.toLocaleString("en")} triangles · ${s.meshes} meshes · ${s.colors} clay colours</dd></dl>
</article>`;
}

const PAGE_CSS = `
.bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px max(16px,calc((100vw - 1240px)/2));background:color-mix(in srgb,var(--bg) 72%,transparent);backdrop-filter:saturate(180%) blur(24px);-webkit-backdrop-filter:saturate(180%) blur(24px);border-bottom:.5px solid var(--sep)}
.bar strong{font-size:15px;font-weight:600}
main{max-width:1240px;margin:0 auto;padding:0 16px 96px}
@media (min-width:820px){main{padding:0 32px 96px}}
h1{font-size:clamp(34px,5vw,56px);line-height:1.05;letter-spacing:-.04em;font-weight:700;margin:56px 0 12px}
h2{font-size:28px;letter-spacing:-.024em;line-height:1.2;margin:72px 0 8px;font-weight:700}
h3{font-size:28px;letter-spacing:-.024em;margin:2px 0 4px;font-weight:700}
.lede{font-size:20px;line-height:1.4;color:var(--label-2);max-width:42em;margin:0}
.sub{color:var(--label-2);margin:0 0 24px;max-width:46em}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--tint);color:#fff;letter-spacing:0;text-transform:none}
.grid{display:grid;gap:20px;grid-template-columns:minmax(0,1fr)}
@media (min-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.concept{background:var(--elevated);border-radius:26px;padding:24px;box-shadow:var(--e2);display:flex;flex-direction:column;gap:16px}
.concept.recommended{outline:2px solid var(--tint);outline-offset:-2px}
.tagline{margin:0;color:var(--label-2);font-size:15px;line-height:1.4}
.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.panel{position:relative;background:var(--well);border-radius:18px;padding:30px 6px 12px;color:var(--label);box-shadow:inset 0 0 0 .5px var(--sep)}
.panel-label{position:absolute;top:9px;left:12px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--label-2)}
.pair{display:grid;grid-template-columns:1fr 1fr}
.avatars{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:center;gap:8px;margin-top:4px}
.avatar{display:inline-block;border-radius:50%;background:var(--fill) center 42%/150% no-repeat}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:15px}
dt{color:var(--label-2);font-weight:600} dd{margin:0}
.reasons{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media (min-width:820px){.reasons{grid-template-columns:repeat(2,minmax(0,1fr))}}
.reason{background:var(--elevated);border-radius:20px;padding:20px 22px;box-shadow:var(--e2)}
.reason h3{font-size:17px;letter-spacing:-.011em;margin:0 0 6px}
.reason p{margin:0;color:var(--label-2);font-size:15px;line-height:1.47}
.table-wrap{overflow-x:auto;margin-top:24px;border-radius:20px;box-shadow:var(--e2);background:var(--elevated)}
table{border-collapse:collapse;width:100%;min-width:820px;font-size:14px;line-height:1.4}
th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:.5px solid var(--sep)}
tbody tr:last-child>*{border-bottom:0}
thead th{font-size:15px}
tbody th{color:var(--label-2);font-weight:600;width:16%}
.rec{background:var(--tint-wash)}
.seg{display:inline-flex;padding:2px;border-radius:9px;background:var(--fill)}
.seg button{font:inherit;font-size:13px;font-weight:500;min-height:28px;min-width:44px;padding:4px 12px;border:0;border-radius:7px;background:none;color:var(--label);cursor:pointer}
.seg button[aria-pressed="true"],.seg button[aria-selected="true"]{background:var(--seg-thumb);box-shadow:0 0 0 .5px rgba(0,0,0,.06),0 2px 6px rgba(0,0,0,.1);font-weight:600}
.seg button:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
.sheet-wrap{margin-top:16px;border-radius:24px;overflow:hidden;box-shadow:var(--e2)}
.files{font-size:15px;color:var(--label-2)}
.files code{font:13px ui-monospace,"SF Mono",Menlo,monospace;color:var(--label)}
@media (prefers-reduced-motion:no-preference){.seg button{transition:background .2s cubic-bezier(.16,1,.3,1)}}`;

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

export function comparisonPage(concepts, data, img) {
  const rec = concepts.find((c) => c.id === RECOMMENDED);
  const rs = data[rec.id].stats;
  const reasons = [
    ["Purpose", "An egg with a sprout is a learner: it hatches and grows. The sprout is a built-in progress motif (it can grow a leaf as notes are finished), and the cream face pad works like a soft little screen, so every state reads at the sizes the activity stream will use."],
    ["Brand fit", "Its clay is the hero's own --hero-aqua-deep and --hero-bondi, so it inherits the art direction it replaces. It leaves --tint to controls and --signal to alerts, as HIG asks, and the cream face holds contrast on #fafafa and on #0b0b0c."],
    ["Accessories and personalities", "The egg is rotationally symmetric, so the renders show every socket landing cleanly in every view and pose, and the sprout is the only crown piece and tucks away under hats. Personalities come cheap, the way Dots does them: a clay tint plus one accessory (Professor Pip: glasses and a book; Studio Pip: headphones)."],
    ["3D cost", `These renders come from Pip's actual three.js build: one lathe egg, an ellipsoid face pad, a rolled-rim tube, and capsules and ellipsoids for the limbs and sprout. The low-poly app build is ${rs.tris.toLocaleString("en")} triangles in ${rs.meshes} meshes and ${rs.colors} clay colours, so ${rs.colors} draw calls once merged by material, with no glTF to download.`],
  ];
  const tabs = concepts
    .map((c, i) => `<button role="tab" id="tab-${c.id}" aria-controls="sheet-${c.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(c.name)}</button>`)
    .join("");
  const sheets = concepts
    .map((c, i) => `<div role="tabpanel" id="sheet-${c.id}" aria-labelledby="tab-${c.id}" class="sheet-wrap"${i === 0 ? "" : " hidden"}>${sheetSection(c, data)}</div>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MasterTutor Mascot Concepts</title>
<meta name="description" content="Four claymorphic mascot concepts for MasterTutor, rendered from three.js builds and compared in light and dark, with model sheets and a recommendation.">
<style>${CSS}${PAGE_CSS}${imageVars(concepts, img)}</style></head>
<body>
<div class="bar"><strong>MasterTutor mascot</strong>
<div class="seg" role="group" aria-label="Appearance"><button data-set-theme="system" aria-pressed="true">Auto</button><button data-set-theme="light" aria-pressed="false">Light</button><button data-set-theme="dark" aria-pressed="false">Dark</button></div></div>
<main>
<h1>Four clay concepts</h1>
<p class="lede">Every image here is rendered from the concept's real three.js build: code-built spheres, capsules, lathes and tubes in a matte clay material, under soft key, fill and rim lights with contact shadows. Accessories clip onto the same named sockets, so personalities can come later without remodelling the body.</p>

<h2>Side by side</h2>
<p class="sub">The front view and the waving state on the app's light and dark surfaces, plus avatar sizes from 24 to 64 px. Memo is a new variant.</p>
<div class="grid">${concepts.map((c) => conceptCard(c, data)).join("")}</div>

<h2>Recommendation: ${esc(rec.name)}</h2>
<p class="sub">${esc(rec.tagline)} It reads most clearly at small sizes, stays inside the app's colour roles, takes accessories in every view, and is among the cheapest to build.</p>
<div class="reasons">${reasons.map(([h, p]) => `<section class="reason"><h3>${esc(h)}</h3><p>${esc(p)}</p></section>`).join("")}</div>
${scoreTable(concepts, data)}

<h2>Model sheets</h2>
<p class="sub">Each sheet has an orthographic turnaround with height guides, expressions, the accessory sockets with clay accessories, and five states. The sheets follow the appearance switch above.</p>
<div class="seg" role="tablist" aria-label="Concept">${tabs}</div>
${sheets}

<h2>Files</h2>
<p class="files">The sheets are also exported as images: <code>sheets/&lt;concept&gt;-model-sheet-{light,dark}.jpg</code>. The raw renders are in <code>renders/</code>, and the build notes for ${esc(rec.name)} are in <code>3d-readiness.md</code>. To rebuild everything, run <code>node design/mascot/src/build.mjs</code>.</p>
</main>
<script>${SCRIPT}</script>
</body></html>
`;
}
