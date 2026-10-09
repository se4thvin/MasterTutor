// Draws one mascot as an SVG <g>: concept × view × expression × pose × accessories.
// Accessories attach only through each concept's sockets (crown, eyes, ears, hands, lap), the same
// contract the 3D rig will expose, so any accessory fits any concept.

const r2 = (v) => Math.round(v * 100) / 100;
const rad = (deg) => (deg * Math.PI) / 180;

/** Face offset (× half width) and horizontal squash per turnaround view. */
const VIEWS = {
  front: { dx: 0, sx: 1 },
  threeQuarter: { dx: 0.34, sx: 0.8 },
  side: { dx: 0.8, sx: 0.4 },
  back: null,
};

/** Arm angles in degrees, outward positive (0 = hanging straight down). */
export const POSES = {
  rest: { L: 16, R: 16, expr: "neutral" },
  wave: { L: 16, R: 150, expr: "happy" },
  think: { L: 16, R: -150, expr: "thinking" },
  type: { L: -38, R: -38, expr: "focused" },
  hold: { L: -50, R: -50, expr: "happy" },
  sleep: { L: 6, R: 6, expr: "sleepy", tilt: -6 },
};

export function armTip(c, side, angle) {
  const { px, py, len } = c.arms;
  return [side * (px + len * Math.sin(rad(angle))), py + len * Math.cos(rad(angle))];
}

function arm(c, side, angle, shiftX = 0) {
  const { px, py, len, t } = c.arms;
  const rot = -side * angle;
  return `<rect x="${-t / 2}" y="${r2(-t * 0.35)}" width="${t}" height="${r2(len + t * 0.35)}" rx="${t / 2}" fill="url(#${c.id}-limb)" transform="translate(${r2(side * px + shiftX)} ${py}) rotate(${r2(rot)})"/>`;
}

function foot(c, x, y, rxScale = 1) {
  const { rx, ry } = c.feet;
  return `<ellipse cx="${r2(x)}" cy="${y}" rx="${r2(rx * rxScale)}" ry="${ry}" fill="url(#${c.id}-foot)"/>`;
}

/** Wraps face-layer content in the view transform, clipped to the head silhouette. */
function onFace(c, view, inner) {
  const v = VIEWS[view];
  const t = `translate(${r2(v.dx * c.halfW)} 0) scale(${v.sx} 1)`;
  return `<g clip-path="url(#${c.id}-clip)"><g transform="${t}">${inner}</g></g>`;
}

function facePlate(c) {
  if (c.belly) {
    const b = c.belly;
    return (
      `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="${b.fill}" opacity="0.9"/>` +
      `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx - 5}" ry="${b.ry - 5}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.6" stroke-dasharray="3 5" stroke-linecap="round"/>`
    );
  }
  const w = c.window;
  const f = c.face;
  return (
    `<ellipse cx="${w.cx}" cy="${w.cy}" rx="${w.rx + 9}" ry="${w.ry + 9}" fill="none" stroke="${f.stitch}" stroke-opacity="0.85" stroke-width="1.8" stroke-dasharray="3 5" stroke-linecap="round"/>` +
    `<ellipse cx="${w.cx}" cy="${w.cy}" rx="${w.rx + 4}" ry="${w.ry + 4}" fill="${f.rim}" opacity="0.55"/>` +
    `<ellipse cx="${w.cx}" cy="${w.cy}" rx="${w.rx}" ry="${w.ry}" fill="url(#${c.id}-face)"/>`
  );
}

function eye(c, x, expr) {
  const { y, rx, ry } = c.eyes;
  const ink = c.ink;
  const lid = (curve) =>
    `<path d="M ${r2(x - rx - 1.5)} ${y + 1} Q ${x} ${r2(y + curve)} ${r2(x + rx + 1.5)} ${y + 1}" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  const dot = (ox, oy, sy = 1) =>
    `<ellipse cx="${r2(x + ox)}" cy="${r2(y + oy)}" rx="${rx}" ry="${r2(ry * sy)}" fill="${ink}"/>` +
    `<circle cx="${r2(x + ox - rx * 0.3)}" cy="${r2(y + oy - ry * sy * 0.42)}" r="${r2(rx * 0.4)}" fill="#fff"/>` +
    `<circle cx="${r2(x + ox + rx * 0.35)}" cy="${r2(y + oy + ry * sy * 0.35)}" r="${r2(rx * 0.17)}" fill="#fff" opacity="0.8"/>`;
  switch (expr) {
    case "happy":
      return lid(-ry - 3);
    case "sleepy":
      return lid(ry * 0.55);
    case "thinking":
      return dot(1.5, -2.5, 0.92);
    case "focused":
      return dot(0, 2.5, 0.72);
    default:
      return dot(0, 0);
  }
}

function features(c, expr) {
  const { y: cy, dx: cdx, rx: crx, ry: cry } = c.cheeks;
  const grow = expr === "happy" ? 1.15 : 1;
  const cheeks = [-1, 1]
    .map((s) => `<ellipse cx="${s * cdx}" cy="${cy}" rx="${r2(crx * grow)}" ry="${r2(cry * grow)}" fill="${c.cheek}" opacity="0.62" filter="url(#m-soft)"/>`)
    .join("");
  const eyes = eye(c, -c.eyes.dx, expr) + eye(c, c.eyes.dx, expr);
  const brow =
    expr === "thinking"
      ? `<path d="M ${c.eyes.dx - 7} ${c.eyes.y - c.eyes.ry - 9} Q ${c.eyes.dx + 1} ${c.eyes.y - c.eyes.ry - 14} ${c.eyes.dx + 9} ${c.eyes.y - c.eyes.ry - 10}" fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"/>`
      : "";
  const { y, w } = c.mouth;
  const stroke = `fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"`;
  const mouth = {
    neutral: `<path d="M ${-w / 2} ${y} Q 0 ${r2(y + w * 0.45)} ${w / 2} ${y}" ${stroke}/>`,
    focused: `<path d="M ${-w * 0.3} ${y + 1} Q 0 ${r2(y + w * 0.25)} ${w * 0.3} ${y + 1}" ${stroke}/>`,
    happy:
      `<path d="M ${r2(-w * 0.75)} ${y - 1} Q 0 ${r2(y + w * 1.25)} ${r2(w * 0.75)} ${y - 1} Z" fill="${c.mouthFill}"/>` +
      `<ellipse cx="0" cy="${r2(y + w * 0.42)}" rx="${r2(w * 0.32)}" ry="${r2(w * 0.17)}" fill="#ff8f87"/>`,
    sleepy: `<ellipse cx="0" cy="${y + 2}" rx="3.2" ry="3.8" fill="${c.mouthFill}"/>`,
    thinking: `<path d="M ${r2(-w * 0.2)} ${y + 2} L ${r2(w * 0.55)} ${y - 1}" ${stroke}/>`,
  }[expr];
  return cheeks + eyes + brow + mouth;
}

function extrasBehind(c, view) {
  if (c.extras === "curl") {
    const t = c.top;
    const sx = view === "side" ? 0.7 : 1;
    return `<path transform="scale(${sx} 1)" d="M -18 ${t + 14} C -16 ${t - 6} 0 ${t - 20} 18 ${t - 30} C 13 ${t - 14} 20 ${t + 2} 18 ${t + 14} Z" fill="url(#${c.id}-limb)"/>`;
  }
  if (c.extras === "hood") {
    const ears = {
      front: [[-50, 1], [50, 1]],
      threeQuarter: [[-36, 1], [56, 0.85]],
      side: [[4, 1]],
      back: [[-50, 1], [50, 1]],
    }[view];
    return ears
      .map(
        ([x, s]) =>
          `<circle cx="${x}" cy="-216" r="${20 * s}" fill="url(#${c.id}-hood)"/>` +
          (view === "back" ? "" : `<circle cx="${x + (view === "side" ? 4 : 0)}" cy="-214" r="${9 * s}" fill="${c.fabric.base}"/>`),
      )
      .join("");
  }
  return "";
}

function extrasFront(c, view, hidden) {
  if (c.extras === "sprout" && !hidden.has("crown")) {
    const t = c.top;
    const sx = { front: 1, back: 1, threeQuarter: 0.8, side: 0.5 }[view];
    return (
      `<g transform="scale(${sx} 1)">` +
      `<path d="M 0 ${t + 4} C -1 ${t - 6} 2 ${t - 12} 3 ${t - 18}" fill="none" stroke="#22a447" stroke-width="4.5" stroke-linecap="round"/>` +
      `<ellipse cx="-9" cy="${t - 21}" rx="11" ry="6" fill="url(#m-leaf)" transform="rotate(-28 -9 ${t - 21})"/>` +
      `<ellipse cx="15" cy="${t - 25}" rx="13" ry="7" fill="url(#m-leaf)" transform="rotate(24 15 ${t - 25})"/>` +
      `</g>`
    );
  }
  if (c.extras === "hood" && view !== "back") {
    const strings = { front: [-15, 15], threeQuarter: [-2, 24], side: [70] }[view];
    return strings
      .map(
        (x) =>
          `<path d="M ${x} -98 C ${x + 1} -90 ${x + 3} -82 ${x + 3} -76" fill="none" stroke="${c.hood.shade}" stroke-width="3.5" stroke-linecap="round"/>` +
          `<circle cx="${x + 3}" cy="-73" r="4.6" fill="#ff5533"/>`,
      )
      .join("");
  }
  return "";
}

function backDetails(c) {
  const top = c.top + (c.hood ? 26 : 22);
  const tagX = r2(c.halfW * 0.42);
  return (
    `<path d="M 0 ${top} L 0 -24" stroke="${c.hood ? c.hood.shade : c.fabric.deep}" stroke-opacity="0.55" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>` +
    `<g transform="translate(${tagX} -40) rotate(-8)"><rect x="-11" y="-8" width="22" height="16" rx="3" fill="#ffffff"/><rect x="-7" y="-3" width="14" height="2.4" rx="1.2" fill="#0071e3"/><rect x="-7" y="1.5" width="9" height="2" rx="1" fill="#86868b"/></g>`
  );
}

const ACCESSORIES = {
  glasses(c) {
    const { y, dx, ry } = c.eyes;
    const r = r2(ry * 1.65);
    const ink = c.ink;
    return (
      [-1, 1].map((s) => `<circle cx="${s * dx}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity="0.2" stroke="${ink}" stroke-width="3.2"/>`).join("") +
      `<path d="M ${r2(-dx + r)} ${y - 2} Q 0 ${y - 8} ${r2(dx - r)} ${y - 2}" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`
    );
  },
  beret(c) {
    const [x, y] = c.sockets.crown;
    return (
      `<g transform="translate(${x + 10} ${y + 14}) rotate(-12)">` +
      `<rect x="3" y="-47" width="6" height="11" rx="3" fill="#0b1a66"/>` +
      `<path d="M -54 0 C -60 -28 -22 -42 8 -40 C 42 -38 62 -22 54 -2 C 40 7 -40 9 -54 0 Z" fill="url(#m-beret)"/>` +
      `<path d="M -52 -1 C -20 7 30 7 53 -2" fill="none" stroke="#0b1a66" stroke-width="3.5" stroke-linecap="round"/>` +
      `<path d="M -36 -20 C -26 -30 -8 -34 6 -33" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="3" stroke-linecap="round"/>` +
      `</g>`
    );
  },
  headphones(c) {
    const ex = c.sockets.ears;
    const y = c.eyes.y;
    const top = c.sockets.crown[1] - 14;
    return (
      `<path d="M ${-ex + 2} ${y - 14} C ${-ex + 2} ${top - 10} ${ex - 2} ${top - 10} ${ex - 2} ${y - 14}" fill="none" stroke="url(#m-graphite)" stroke-width="10" stroke-linecap="round"/>` +
      `<path d="M ${-ex + 8} ${y - 26} C ${-ex + 12} ${top - 2} ${ex - 12} ${top - 2} ${ex - 8} ${y - 26}" fill="none" stroke="#aeaeb2" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/>` +
      [-1, 1]
        .map(
          (s) =>
            `<rect x="${s * ex - 12}" y="${y - 22}" width="24" height="44" rx="11" fill="url(#m-graphite)"/>` +
            `<rect x="${s * ex - 3 - s * 9}" y="${y - 18}" width="6" height="36" rx="3" fill="#1c1c1e"/>` +
            `<rect x="${s * ex - 3}" y="${y - 12}" width="6" height="10" rx="3" fill="#2997ff" opacity="0.85"/>`,
        )
        .join("")
    );
  },
  laptop(c) {
    const L = c.sockets.lap;
    return (
      `<ellipse cx="0" cy="${L - 58}" rx="50" ry="16" fill="#2997ff" opacity="0.32" filter="url(#m-blur)"/>` +
      `<rect x="-47" y="${L - 48}" width="94" height="48" rx="7" fill="url(#m-alu)" stroke="#aeaeb2" stroke-width="1"/>` +
      `<path d="M 0 ${L - 29} c -4 -6 -1 -10 3 -11 c 0 5 -1 9 -3 11 z" fill="#ffffff" opacity="0.9"/>` +
      `<rect x="-54" y="${L - 2}" width="108" height="9" rx="4.5" fill="#d2d2d7"/>` +
      `<rect x="-13" y="${L - 2}" width="26" height="3" rx="1.5" fill="#aeaeb2"/>`
    );
  },
  book(c) {
    const L = c.sockets.lap;
    return (
      `<path d="M 22 ${L - 2} l 0 14 l 4 -4 l 4 4 l 0 -14 z" fill="#0071e3"/>` +
      `<rect x="-44" y="${L - 60}" width="88" height="60" rx="6" fill="url(#m-book)"/>` +
      `<rect x="-44" y="${L - 60}" width="10" height="60" rx="4" fill="#a3200f" opacity="0.7"/>` +
      `<rect x="-20" y="${L - 44}" width="44" height="5" rx="2.5" fill="#ffe3d6"/>` +
      `<rect x="-20" y="${L - 34}" width="28" height="4" rx="2" fill="#ffe3d6" opacity="0.75"/>`
    );
  },
  orb(c) {
    const cy = c.sockets.lap - 32;
    return (
      `<circle cx="0" cy="${cy}" r="50" fill="url(#m-orb-glow)"/>` +
      `<circle cx="0" cy="${cy}" r="23" fill="url(#m-orb)"/>` +
      `<ellipse cx="-8" cy="${cy - 9}" rx="7" ry="4.5" fill="#ffffff" opacity="0.9" transform="rotate(-30 -8 ${cy - 9})"/>`
    );
  },
};

/** Where each accessory sits in the stack. */
const LAYER = { glasses: "face", beret: "head", headphones: "head", laptop: "over", book: "under", orb: "under" };
const CROWN_TAKERS = new Set(["beret"]);

function props(c, pose) {
  const t = c.top;
  const h = c.halfW;
  if (pose === "think") {
    const cloud = [
      [h * 1.42, t - 70, 22], [h * 1.72, t - 76, 26], [h * 2.0, t - 66, 21], [h * 1.58, t - 52, 20], [h * 1.88, t - 50, 20],
    ];
    const small = [[h * 0.66, t + 10, 4], [h * 0.86, t - 10, 6.5], [h * 1.1, t - 30, 9]];
    const circles = (attrs, grow) => [...small, ...cloud].map(([x, y, r]) => `<circle cx="${r2(x)}" cy="${y}" r="${r + grow}" ${attrs}/>`).join("");
    const dots = [-14, 0, 14].map((d) => `<circle cx="${r2(h * 1.72 + d)}" cy="${t - 62}" r="3.6" fill="var(--ink3)"/>`).join("");
    return circles(`fill="var(--bubble-line)"`, 1.5) + circles(`fill="var(--bubble)"`, 0) + dots;
  }
  if (pose === "sleep") {
    return [[h * 0.62, t + 6, 18], [h * 0.86, t - 18, 24], [h * 1.14, t - 50, 32]]
      .map(([x, y, s]) => `<text x="${r2(x)}" y="${y}" font-size="${s}" class="zzz" transform="rotate(-12 ${r2(x)} ${y})">z</text>`)
      .join("");
  }
  if (pose === "wave") {
    const [x, y] = armTip(c, 1, POSES.wave.R);
    const arc = (o) =>
      `<path d="M ${r2(x + 18 + o)} ${r2(y - 16 - o * 0.4)} Q ${r2(x + 28 + o * 1.3)} ${r2(y)} ${r2(x + 18 + o)} ${r2(y + 16 + o * 0.4)}" fill="none" stroke="var(--ink3)" stroke-width="3" stroke-linecap="round"/>`;
    return arc(0) + arc(12);
  }
  if (pose === "type") {
    const L = c.sockets.lap;
    return [-1, 1]
      .map((s) => `<path d="M ${s * 64} ${L - 52} l ${s * 8} -8 M ${s * 68} ${L - 40} l ${s * 11} -2" stroke="var(--ink3)" stroke-width="2.6" stroke-linecap="round"/>`)
      .join("");
  }
  return "";
}

/**
 * @param {object} c concept
 * @param {{view?: string, expr?: string, pose?: string, acc?: string[], ghost?: boolean}} o
 */
export function figure(c, o = {}) {
  const view = o.view ?? "front";
  const pose = POSES[o.pose ?? "rest"];
  const expr = o.expr ?? pose.expr;
  const acc = o.acc ?? [];
  const hidden = new Set(acc.filter((a) => CROWN_TAKERS.has(a)).map(() => "crown"));
  const layer = (name) => acc.filter((a) => LAYER[a] === name).map((a) => ACCESSORIES[a](c)).join("");
  const { dx: fdx, rx: frx } = c.feet;
  const fy = c.feet.y;

  // Arms and feet per view: [behind, front].
  let armsBehind = "";
  let armsFront = "";
  let feetSvg = "";
  if (view === "front" || view === "back") {
    armsFront = arm(c, -1, pose.L) + arm(c, 1, pose.R);
    feetSvg = foot(c, -fdx, fy) + foot(c, fdx, fy);
  } else if (view === "threeQuarter") {
    armsBehind = arm(c, 1, 12, -10);
    armsFront = arm(c, -1, 16, 16);
    feetSvg = foot(c, fdx - 10, fy - 2) + foot(c, -fdx + 12, fy + 1);
  } else {
    armsFront = arm(c, -1, 6, c.arms.px - 4);
    feetSvg = foot(c, -10, fy - 2, 0.9) + foot(c, 16, fy + 1, 1.25);
  }

  const bodyFill = `<path d="${c.body}" fill="url(#${c.id}-body)"/><path d="${c.body}" fill="url(#m-vignette)"/>`;
  const hood = c.hood
    ? `<path d="${c.hoodPath}" fill="url(#${c.id}-hood)"/><path d="${c.hoodPath}" fill="url(#m-vignette)"/>`
    : "";
  const front = VIEWS[view] !== null;
  const plate = front ? onFace(c, view, facePlate(c)) : backDetails(c);
  const sheenY = c.window.cy - c.window.ry * 0.9;
  const sheen = `<ellipse cx="${r2(-c.halfW * 0.5)}" cy="${r2(sheenY)}" rx="${r2(c.halfW * 0.24)}" ry="${r2(c.halfW * 0.34)}" fill="url(#m-sheen)" transform="rotate(24 ${r2(-c.halfW * 0.5)} ${r2(sheenY)})" opacity="0.7"/>`;
  const face = front ? onFace(c, view, features(c, expr) + layer("face")) : "";

  const tilt = pose.tilt ? ` transform="rotate(${pose.tilt}) scale(1.02 0.97)"` : "";
  return (
    `<g${o.ghost ? ' opacity="0.42"' : ""}>` +
    `<ellipse cx="0" cy="2" rx="${r2(c.halfW * 0.86)}" ry="9" fill="var(--shadow)" filter="url(#m-shadow)"/>` +
    `<g${tilt}>` +
    `<g filter="url(#m-fuzz)">${armsBehind}${extrasBehind(c, view)}${feetSvg}${bodyFill}${hood}${plate}</g>` +
    sheen +
    face +
    extrasFront(c, view, hidden) +
    layer("under") +
    `<g filter="url(#m-fuzz)">${armsFront}</g>` +
    layer("over") +
    layer("head") +
    props(c, o.pose) +
    `</g></g>`
  );
}
