// The mascot concepts as data, shared by the three.js builder (browser) and the page build (node).
// Each colour names the app token it derives from (apps/web/styles/tokens.css).

export const INK = { eye: "#1d1d1f", mouth: "#5b2626", tongue: "#ff8f87" };

export const concepts = [
  {
    id: "pip",
    letter: "A",
    name: "Pip",
    tagline: "A curious little note-taker who grows a sprout of understanding with every page.",
    shape: "Clay egg with a puffy cream face pad, a rolled rim and a two-leaf sprout.",
    colors: { body: "#55b8b5", shade: "#1f8f96", face: "#fff4e6", leaf: "#34c759", cheek: "#ff8f87" },
    palette: [
      ["Clay body", "body", "--hero-aqua-deep → --hero-bondi"],
      ["Rim and feet", "shade", "--hero-bondi"],
      ["Face pad", "face", "warm --elevated"],
      ["Sprout", "leaf", "--switch-on"],
      ["Cheek", "cheek", "--signal, 45% tint"],
    ],
  },
  {
    id: "mochi",
    letter: "B",
    name: "Mochi",
    tagline: "A bouncy, warm-hearted cheerleader who celebrates every finished run.",
    shape: "Squat clay gumdrop with a soft-serve tip, a peach belly and stubby arms.",
    colors: { body: "#ff7f5e", shade: "#e0482d", belly: "#ffe3d6", cheek: "#f0457a" },
    palette: [
      ["Clay body", "body", "--signal (dark), 80%"],
      ["Feet", "shade", "--signal, dark → light"],
      ["Belly", "belly", "--signal-wash, opaque"],
      ["Cheek", "cheek", "rose accent"],
    ],
  },
  {
    id: "quill",
    letter: "C",
    name: "Quill",
    tagline: "A calm, bookish scholar in a hoodie who carries a small light of knowledge.",
    shape: "Cream clay bean in a bear-eared blue hood with drawstrings, holding a glowing orb.",
    colors: { hood: "#2f8cf0", hoodShade: "#0b4fb3", fleece: "#f5ead9", fleeceShade: "#e3cfb2", bead: "#ff5533", cheek: "#ff8f87" },
    palette: [
      ["Hood", "hood", "--tint, 85%"],
      ["Hood rim", "hoodShade", "--tint → --navy"],
      ["Fleece", "fleece", "warm --bg-2"],
      ["Bead", "bead", "--signal (dark)"],
      ["Cheek", "cheek", "--signal, 45% tint"],
    ],
  },
  {
    id: "memo",
    letter: "D",
    name: "Memo",
    tagline: "A tidy, helpful sticky note that writes itself while you watch. (New variant)",
    shape: "Pillowy rounded square in folder blue, with ruled clay lines and a chunky paper clip.",
    colors: { body: "#8fc1f3", shade: "#74aeeb", lines: "#ffffff", clip: "#c7c7cc", cheek: "#ff8f87" },
    palette: [
      ["Clay body", "body", "--folder-front"],
      ["Feet", "shade", "--folder-back"],
      ["Ruled lines", "lines", "--folder-paper"],
      ["Clip", "clip", "neutral metal"],
      ["Cheek", "cheek", "--signal, 45% tint"],
    ],
  },
];

export const RECOMMENDED = "pip";
