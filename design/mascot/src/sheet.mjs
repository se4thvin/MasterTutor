// Lays out one concept's model sheet: header + palette, turnaround with guides, expressions,
// accessory sockets, state poses.

import { allDefs } from "./defs.mjs";
import { armTip, figure } from "./figure.mjs";

export const SHEET_W = 1600;
export const SHEET_H = 2220;
const M = 64;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const r2 = (v) => Math.round(v * 100) / 100;

const THEME_VARS = {
  light: "--paper:#fafafa;--card:#ffffff;--ink:#1d1d1f;--ink2:#636366;--ink3:#86868b;--line:rgba(0,0,0,.08);--guide:#0071e3;--shadow:rgba(0,0,0,.16);--bubble:#ffffff;--bubble-line:#d2d2d7",
  dark: "--paper:#0b0b0c;--card:#1c1c1e;--ink:#f5f5f7;--ink2:#a1a1a6;--ink3:#8e8e93;--line:rgba(255,255,255,.09);--guide:#2997ff;--shadow:rgba(0,0,0,.6);--bubble:#2c2c2e;--bubble-line:#48484a",
};

/** Text and guide classes; the colours come from the theme variables. */
export const SHEET_CSS = `
.sheet text{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.sheet .paper{fill:var(--paper)} .sheet .card{fill:var(--card)}
.sheet .eyebrow{font-size:14px;font-weight:600;letter-spacing:.08em;fill:var(--guide)}
.sheet .name{font-size:72px;font-weight:700;letter-spacing:-.04em;fill:var(--ink)}
.sheet .tagline{font-size:22px;letter-spacing:-.011em;fill:var(--ink2)}
.sheet .shape{font-size:15px;fill:var(--ink3)}
.sheet .section{font-size:13px;font-weight:600;letter-spacing:.08em;fill:var(--ink2)}
.sheet .label{font-size:15px;font-weight:600;letter-spacing:-.006em;fill:var(--ink)}
.sheet .caption{font-size:12px;fill:var(--ink2)}
.sheet .tiny{font-size:11px;font-weight:600;fill:var(--guide)}
.sheet .hex{font-size:12px;fill:var(--ink3);font-variant-numeric:tabular-nums}
.sheet .zzz{font-weight:700;fill:var(--ink3)}
.sheet .rule{stroke:var(--line);stroke-width:1}
.sheet .guide{stroke:var(--guide);stroke-width:1;stroke-dasharray:4 5;opacity:.55}
.sheet .guide-solid{stroke:var(--guide);stroke-width:1.2;fill:none}`;

function header(c) {
  const chips = c.palette
    .map((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 820 + col * 244;
      const y = 92 + row * 66;
      return (
        `<circle cx="${x + 18}" cy="${y + 18}" r="18" fill="${p.hex}" stroke="var(--line)"/>` +
        `<text x="${x + 46}" y="${y + 14}" class="label">${esc(p.role)}</text>` +
        `<text x="${x + 46}" y="${y + 32}" class="hex">${p.hex} · ${esc(p.token)}</text>`
      );
    })
    .join("");
  return (
    `<text x="${M}" y="${M + 14}" class="eyebrow">CONCEPT ${c.letter} · MASTERTUTOR MASCOT · MODEL SHEET</text>` +
    `<text x="${M - 4}" y="${M + 86}" class="name">${esc(c.name)}</text>` +
    `<text x="${M}" y="${M + 124}" class="tagline">${esc(c.tagline)}</text>` +
    `<text x="${M}" y="${M + 152}" class="shape">${esc(c.shape)}</text>` +
    chips
  );
}

function section(y, title) {
  return `<line x1="${M}" y1="${y - 26}" x2="${SHEET_W - M}" y2="${y - 26}" class="rule"/><text x="${M}" y="${y}" class="section">${title}</text>`;
}

/** A card with a figure placed by its ground point; `clip` crops the card for close-ups. */
function card(c, id, x, y, w, h, label, caption, inner) {
  const clipId = `${c.id}-card-${id}`;
  return (
    `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22"/></clipPath>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" class="card"/>` +
    `<g clip-path="url(#${clipId})">${inner}<rect x="${x}" y="${y + h - 64}" width="${w}" height="64" class="card"/></g>` +
    `<text x="${x + 20}" y="${y + h - 38}" class="label">${esc(label)}</text>` +
    `<text x="${x + 20}" y="${y + h - 18}" class="caption">${esc(caption)}</text>`
  );
}

const place = (x, y, s, body) => `<g transform="translate(${r2(x)} ${r2(y)}) scale(${s})">${body}</g>`;

function turnaround(c, y0) {
  const x0 = 128;
  const gap = 20;
  const w = (SHEET_W - M - x0 - gap * 3) / 4;
  const h = 420;
  const s = 1.2;
  const ground = y0 + 348;
  const H = -c.top; // full height in units
  const eyeF = -c.eyes.y / H;
  const guides = [
    [1, "1.00 H"],
    [eyeF, `eye ${eyeF.toFixed(2)}`],
    [0.5, "0.50"],
    [0, "0"],
  ]
    .map(([f, t]) => {
      const gy = r2(ground - f * H * s);
      return `<line x1="${x0 - 8}" y1="${gy}" x2="${SHEET_W - M}" y2="${gy}" class="guide"/><text x="${M}" y="${gy + 4}" class="tiny">${t}</text>`;
    })
    .join("");
  const views = [
    ["front", "Front", "0°"],
    ["threeQuarter", "Three-quarter", "35°, face turns with the head"],
    ["side", "Side", "90°, silhouette unchanged"],
    ["back", "Back", "180°, seam and fabric tag"],
  ];
  const cards = views
    .map(([v, label, cap], i) => {
      const x = x0 + i * (w + gap);
      return card(c, `t${i}`, x, y0, w, h, label, cap, place(x + w / 2, ground, s, figure(c, { view: v })));
    })
    .join("");
  const fx = x0 + w / 2;
  const half = c.halfW * s;
  const wy = ground + 16;
  const width = `<path d="M ${r2(fx - half)} ${wy - 5} v 10 M ${r2(fx - half)} ${wy} H ${r2(fx + half)} M ${r2(fx + half)} ${wy - 5} v 10" class="guide-solid"/>` +
    `<text x="${r2(fx + half + 6)}" y="${wy + 4}" class="tiny">W ${((c.halfW * 2) / H).toFixed(2)} H</text>`;
  return cards + guides + width;
}

function expressions(c, y0) {
  const gap = 20;
  const w = (SHEET_W - M * 2 - gap * 3) / 4;
  const h = 280;
  const s = 1.7;
  const items = [
    ["neutral", "Neutral", "Default, listening"],
    ["happy", "Happy", "Run finished, greeting"],
    ["sleepy", "Sleepy", "Idle for a while"],
    ["thinking", "Thinking", "Planning the next step"],
  ];
  return items
    .map(([e, label, cap], i) => {
      const x = M + i * (w + gap);
      const gx = x + w / 2;
      const gy = y0 + 112 - c.eyes.y * s;
      return card(c, `e${i}`, x, y0, w, h, label, cap, place(gx, gy, s, figure(c, { expr: e })));
    })
    .join("");
}

function sockets(c, y0) {
  const gap = 18;
  const w = (SHEET_W - M * 2 - gap * 4) / 5;
  const h = 390;
  const s = 0.95;
  const ground = y0 + 300;
  const extra = c.extras === "hood" ? ["orb", "Orb (signature)", "lap · held by both hands"] : ["book", "Book", "lap · held by both hands"];
  const items = [
    [[], "Sockets", "crown · eyes · ears · hands · lap"],
    [["glasses"], "Glasses", "eyes socket · follows the face"],
    [["beret"], "Beret", "crown socket · tilts 12°"],
    [["headphones"], "Headphones", "ears socket · band over crown"],
    [[extra[0]], extra[1], extra[2]],
  ];
  return items
    .map(([acc, label, cap], i) => {
      const x = M + i * (w + gap);
      const pose = acc[0] === "book" || acc[0] === "orb" ? "hold" : "rest";
      const expr = acc.length ? (pose === "hold" ? "happy" : "neutral") : "neutral";
      let body = figure(c, { acc, pose, expr, ghost: acc.length === 0 });
      if (!acc.length) body += socketMarks(c);
      return card(c, `a${i}`, x, y0, w, h, label, cap, place(x + w / 2, ground, s, body));
    })
    .join("");
}

function socketMarks(c) {
  const [cx, cy] = c.sockets.crown;
  const [hx, hy] = armTip(c, 1, 16);
  const ex = c.sockets.ears;
  const marks = [
    [cx, cy, "crown", 8, -10],
    [0, c.eyes.y, "eyes", -14, -18],
    [-ex, c.eyes.y, "ear.L", -40, 26],
    [ex, c.eyes.y, "ear.R", 6, 26],
    [hx, hy, "hand.R", -6, 30],
    [0, c.sockets.lap - 24, "lap", 16, 18],
  ];
  return marks
    .map(
      ([x, y, t, tx, ty]) =>
        `<circle cx="${r2(x)}" cy="${r2(y)}" r="7" fill="none" stroke="var(--guide)" stroke-width="2"/>` +
        `<path d="M ${r2(x - 12)} ${r2(y)} h 24 M ${r2(x)} ${r2(y - 12)} v 24" stroke="var(--guide)" stroke-width="1.4"/>` +
        `<text x="${r2(x + tx)}" y="${r2(y + ty)}" class="tiny" font-size="13">${t}</text>`,
    )
    .join("");
}

function states(c, y0) {
  const gap = 20;
  const w = (SHEET_W - M * 2 - gap * 3) / 4;
  const h = 440;
  const s = 1;
  const ground = y0 + 350;
  const items = [
    [{ pose: "type", acc: ["laptop"] }, "Working", "Typing on a tiny laptop, eyes on the screen", 0],
    [{ pose: "sleep" }, "Idle", "Dozes off, zzz drifts up", -40],
    [{ pose: "think" }, "Thinking", "Hand to cheek, thought bubbles", -56],
    [{ pose: "wave" }, "Waving", "Hello and goodbye", -14],
  ];
  return items
    .map(([o, label, cap, shift], i) => {
      const x = M + i * (w + gap);
      return card(c, `s${i}`, x, y0, w, h, label, cap, place(x + w / 2 + shift, ground, s, figure(c, o)));
    })
    .join("");
}

function footer(c) {
  const b = c.build3d;
  return (
    `<line x1="${M}" y1="${SHEET_H - 78}" x2="${SHEET_W - M}" y2="${SHEET_H - 78}" class="rule"/>` +
    `<text x="${M}" y="${SHEET_H - 48}" class="caption">3D estimate: ${b.meshes} meshes · ${esc(b.tris)} triangles · ${esc(b.materials)} · ${esc(b.authored)}</text>` +
    `<text x="${SHEET_W - M}" y="${SHEET_H - 48}" class="caption" text-anchor="end">2D concept v1 · 2026-10-08 · not final art</text>`
  );
}

/**
 * @param {object} c concept
 * @param {{standalone: boolean}} o standalone sheets carry their own defs and theme styles
 */
export function sheet(c, { standalone }) {
  const style = standalone
    ? `<style>.sheet{${THEME_VARS.light}}@media (prefers-color-scheme:dark){.sheet{${THEME_VARS.dark}}}${SHEET_CSS}</style>${allDefs([c])}`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="sheet" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}" height="${SHEET_H}" role="img" aria-label="${esc(c.name)} model sheet">` +
    style +
    `<rect class="paper" width="${SHEET_W}" height="${SHEET_H}"/>` +
    header(c) +
    section(300, "TURNAROUND · DIMENSIONS IN UNITS OF HEIGHT (H)") +
    turnaround(c, 322) +
    section(812, "EXPRESSIONS") +
    expressions(c, 834) +
    section(1176, "ACCESSORY SOCKETS · SWAPPABLE PIECES") +
    sockets(c, 1198) +
    section(1650, "STATES") +
    states(c, 1672) +
    footer(c) +
    `</svg>`
  );
}

export { THEME_VARS };
