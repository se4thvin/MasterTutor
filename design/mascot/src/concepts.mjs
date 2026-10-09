// The three mascot concepts as data. Local units: 1 = 1 px at scale 1, ground at y = 0, x centred.
// Every colour names the app token it derives from (apps/web/styles/tokens.css).

const egg = (top, bottom, half, widestY) =>
  `M 0 ${top} C ${half * 0.58} ${top} ${half} ${widestY - (widestY - top) * 0.52} ${half} ${widestY} ` +
  `C ${half} ${widestY + (bottom - widestY) * 0.6} ${half * 0.56} ${bottom} 0 ${bottom} ` +
  `C ${-half * 0.56} ${bottom} ${-half} ${widestY + (bottom - widestY) * 0.6} ${-half} ${widestY} ` +
  `C ${-half} ${widestY - (widestY - top) * 0.52} ${-half * 0.58} ${top} 0 ${top} Z`;

const INK = "#1d1d1f"; // --label (light)
const MOUTH = "#5b2626";

export const concepts = [
  {
    id: "pip",
    letter: "A",
    name: "Pip",
    tagline: "A curious little note-taker who grows a sprout of understanding with every page.",
    shape: "Plush egg with a stitched cream face window and a two-leaf sprout.",
    ink: INK,
    mouthFill: MOUTH,
    cheek: "#ff8f87",
    palette: [
      { role: "Plush highlight", hex: "#a9dcd8", token: "--hero-aqua-deep" },
      { role: "Plush body", hex: "#5cb9b6", token: "aqua-deep/bondi mix" },
      { role: "Plush shade", hex: "#1f8f96", token: "--hero-bondi" },
      { role: "Face fleece", hex: "#fff7ec", token: "warm --elevated" },
      { role: "Sprout", hex: "#34c759", token: "--switch-on" },
      { role: "Cheek", hex: "#ff8f87", token: "--signal 45% tint" },
    ],
    fabric: { hi: "#b4e3df", base: "#5cb9b6", shade: "#1f8f96", deep: "#17767c" },
    face: { hi: "#fffaf3", lo: "#f2e2cb", rim: "#1f8f96", stitch: "#d9f1ee" },
    body: egg(-226, -6, 90, -96),
    halfW: 90,
    top: -226,
    window: { cx: 0, cy: -122, rx: 60, ry: 50 },
    eyes: { y: -126, dx: 23, rx: 7.5, ry: 10 },
    cheeks: { y: -103, dx: 40, rx: 11, ry: 7 },
    mouth: { y: -107, w: 12 },
    arms: { px: 80, py: -100, len: 36, t: 27 },
    feet: { dx: 34, y: -8, rx: 28, ry: 13 },
    sockets: { crown: [0, -226], ears: 88, lap: -40, headTilt: 0 },
    extras: "sprout",
    build3d: {
      meshes: 7,
      tris: "≈3.2k",
      materials: "2 (fabric with sheen, face atlas)",
      authored: "None. Every part is a three.js primitive or a lathe.",
    },
  },
  {
    id: "mochi",
    letter: "B",
    name: "Mochi",
    tagline: "A bouncy, warm-hearted cheerleader who celebrates every finished run.",
    shape: "Soft gumdrop blob with stubby arms, a soft-serve curl and its face printed on the plush.",
    ink: INK,
    mouthFill: MOUTH,
    cheek: "#e83f6f",
    palette: [
      { role: "Plush highlight", hex: "#ffb39b", token: "--signal 45% tint" },
      { role: "Plush body", hex: "#ff7a59", token: "--signal (dark) 80%" },
      { role: "Plush shade", hex: "#e0482d", token: "--signal dark→light" },
      { role: "Belly", hex: "#ffe3d6", token: "--signal-wash, opaque" },
      { role: "Cheek", hex: "#e83f6f", token: "rose accent" },
      { role: "Ink", hex: INK, token: "--label" },
    ],
    fabric: { hi: "#ffb39b", base: "#ff7a59", shade: "#e0482d", deep: "#c22914" },
    face: null,
    belly: { cx: 0, cy: -44, rx: 62, ry: 34, fill: "#ffe3d6" },
    body: egg(-178, -4, 106, -66),
    halfW: 106,
    top: -178,
    window: { cx: 0, cy: -100, rx: 70, ry: 52 }, // face area (no visible plate)
    eyes: { y: -104, dx: 28, rx: 9, ry: 12 },
    cheeks: { y: -82, dx: 52, rx: 13, ry: 8 },
    mouth: { y: -86, w: 14 },
    arms: { px: 96, py: -72, len: 38, t: 31 },
    feet: { dx: 40, y: -6, rx: 27, ry: 11 },
    sockets: { crown: [0, -178], ears: 100, lap: -30, headTilt: 0 },
    extras: "curl",
    build3d: {
      meshes: 6,
      tris: "≈2.8k",
      materials: "2 (fabric with sheen, face decal)",
      authored: "A face decal projected onto a curved body (DecalGeometry).",
    },
  },
  {
    id: "quill",
    letter: "C",
    name: "Quill",
    tagline: "A calm, bookish scholar in a hoodie who carries a small light of knowledge.",
    shape: "Cream fleece bean in a blue bear-eared hoodie with drawstrings, holding a glowing orb.",
    ink: INK,
    mouthFill: MOUTH,
    cheek: "#ff8f87",
    palette: [
      { role: "Hood highlight", hex: "#7db8ff", token: "--tint-text (dark)" },
      { role: "Hood", hex: "#2f8cf0", token: "--tint 85%" },
      { role: "Hood shade", hex: "#0b4fb3", token: "--tint → --navy" },
      { role: "Fleece", hex: "#f5ead9", token: "warm --bg-2" },
      { role: "Orb glow", hex: "#a9dcd8", token: "--hero-aqua-deep" },
      { role: "Bead", hex: "#ff5533", token: "--signal (dark)" },
    ],
    fabric: { hi: "#fffaf2", base: "#f5ead9", shade: "#d9c3a3", deep: "#c4aa86" },
    hood: { hi: "#7db8ff", base: "#2f8cf0", shade: "#0b4fb3" },
    face: { hi: "#fffaf3", lo: "#f2e2cb", rim: "#0b4fb3", stitch: "#a9cdfb" },
    body: egg(-200, -6, 84, -86),
    hoodPath:
      "M -94 -108 C -100 -184 -60 -234 0 -234 C 60 -234 100 -184 94 -108 C 92 -90 74 -82 56 -90 " +
      "C 30 -102 -30 -102 -56 -90 C -74 -82 -92 -90 -94 -108 Z",
    halfW: 94,
    top: -234,
    window: { cx: 0, cy: -152, rx: 54, ry: 44 },
    eyes: { y: -154, dx: 21, rx: 7, ry: 9.5 },
    cheeks: { y: -134, dx: 36, rx: 10, ry: 6.5 },
    mouth: { y: -138, w: 11 },
    arms: { px: 76, py: -82, len: 34, t: 25 },
    feet: { dx: 32, y: -8, rx: 26, ry: 12 },
    sockets: { crown: [0, -234], ears: 96, lap: -36, headTilt: 0 },
    extras: "hood",
    build3d: {
      meshes: 13,
      tris: "≈7.5k",
      materials: "4 (hood fabric, fleece, face atlas, emissive orb)",
      authored: "The hood with a face opening needs a modelled mesh (Blender → glTF).",
    },
  },
];
