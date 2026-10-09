// Shared SVG <defs>: plush gradients per concept, the fuzz filter and soft blurs.
// The comparison page includes these once; each standalone sheet includes them itself.

const radial = (id, stops, { cx = 0.38, cy = 0.3, r = 0.85, fx, fy } = {}) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${fx ? ` fx="${fx}" fy="${fy}"` : ""}>` +
  stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("") +
  `</radialGradient>`;

function conceptDefs(c) {
  const f = c.fabric;
  const out = [
    radial(`${c.id}-body`, [[0, f.hi], [0.5, f.base], [1, f.shade]]),
    radial(`${c.id}-limb`, [[0, f.hi], [0.6, f.base], [1, f.shade]], { cx: 0.4, cy: 0.25, r: 0.95 }),
    radial(`${c.id}-foot`, [[0, f.base], [1, f.deep]], { cx: 0.45, cy: 0.2, r: 0.9 }),
    `<clipPath id="${c.id}-clip"><path d="${c.hoodPath ?? c.body}"/></clipPath>`,
  ];
  if (c.face) out.push(radial(`${c.id}-face`, [[0, c.face.hi], [0.7, c.face.hi], [1, c.face.lo]], { cx: 0.45, cy: 0.4, r: 0.65 }));
  if (c.hood) out.push(radial(`${c.id}-hood`, [[0, c.hood.hi], [0.5, c.hood.base], [1, c.hood.shade]]));
  return out.join("");
}

const shared = `
<radialGradient id="m-vignette" cx="0.5" cy="0.42" r="0.6">
  <stop offset="0.62" stop-color="#2a1a0a" stop-opacity="0"/><stop offset="1" stop-color="#2a1a0a" stop-opacity="0.2"/>
</radialGradient>
<radialGradient id="m-sheen" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
<radialGradient id="m-orb" cx="0.4" cy="0.35" r="0.6">
  <stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#e4f5f3"/><stop offset="1" stop-color="#5cc3bd"/>
</radialGradient>
<radialGradient id="m-orb-glow" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#a9dcd8" stop-opacity="0.9"/><stop offset="1" stop-color="#a9dcd8" stop-opacity="0"/>
</radialGradient>
<linearGradient id="m-alu" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f5f5f7"/><stop offset="1" stop-color="#c7c7cc"/>
</linearGradient>
<linearGradient id="m-graphite" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#636366"/><stop offset="1" stop-color="#2c2c2e"/>
</linearGradient>
<linearGradient id="m-beret" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3b4a9a"/><stop offset="1" stop-color="#0b1a66"/>
</linearGradient>
<linearGradient id="m-book" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#c22914"/>
</linearGradient>
<linearGradient id="m-leaf" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7ee29a"/><stop offset="1" stop-color="#22a447"/>
</linearGradient>
<filter id="m-fuzz" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" result="fluffy"/>
  <feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="1" seed="3" result="grain"/>
  <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.7 0 0 0 -0.36" result="light"/>
  <feComposite in="light" in2="fluffy" operator="in" result="lightIn"/>
  <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0 0  0 0.7 0 0 -0.38" result="dark"/>
  <feComposite in="dark" in2="fluffy" operator="in" result="darkIn"/>
  <feMerge><feMergeNode in="fluffy"/><feMergeNode in="lightIn"/><feMergeNode in="darkIn"/></feMerge>
</filter>
<filter id="m-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
<filter id="m-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="m-shadow" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>`;

export function allDefs(concepts) {
  return `<defs>${shared}${concepts.map(conceptDefs).join("")}</defs>`;
}
