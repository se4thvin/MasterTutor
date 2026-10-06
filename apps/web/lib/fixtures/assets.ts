import { ids } from "./ids.ts";

/** Fixture images as inline SVG. Real assets come from Garage through assets.url in Phase 7. */
const svg = (body: string, w = 640, h = 360) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const FIGURE = svg(
  `<rect width="640" height="360" fill="#f5f5f7"/><path d="M60 40v280h540" fill="none" stroke="#d2d2d7" stroke-width="2"/>` +
    `<path d="M60 320 L100 50 C260 50 380 120 470 200 S600 290 600 290" fill="none" stroke="#1d1d1f" stroke-width="3"/>` +
    `<circle cx="100" cy="50" r="6" fill="#c22914"/>`,
);
const TRAINING_LOG = svg(
  `<rect width="640" height="200" fill="#111"/><text x="24" y="60" fill="#c8e6c9" font-family="monospace" font-size="20">step 1399 | loss 2.871</text>` +
    `<text x="24" y="100" fill="#c8e6c9" font-family="monospace" font-size="20">step 1400 | loss 2.913 | grad_norm 1.2e+04</text>` +
    `<text x="24" y="140" fill="#c8e6c9" font-family="monospace" font-size="20">step 1401 | loss nan</text>`,
  640,
  200,
);
const KEYFRAME = svg(
  `<rect width="640" height="360" fill="#0e1116"/><path d="M80 290 C120 290 130 80 160 70 S220 250 260 260 S560 270 600 280" fill="none" stroke="#ff5533" stroke-width="4"/>`,
);
const FAVICON = svg(
  `<rect width="32" height="32" rx="8" fill="#1d1d1f"/><circle cx="16" cy="16" r="7" fill="#fafafa"/>`,
  32,
  32,
);

const toDataUri = (markup: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

export const FIXTURE_ASSETS: ReadonlyMap<string, string> = new Map([
  [ids.asset(1), toDataUri(FIGURE)],
  [ids.asset(2), toDataUri(TRAINING_LOG)],
  [ids.asset(3), toDataUri(KEYFRAME)],
  [ids.asset(4), toDataUri(FAVICON)],
]);
