// Regenerates same-layout.webm: two lecture slides with one template that differ in one bullet
// (perceptual distance 0.88, under PERCEPTUAL_SAME), then a different slide; 5 s each, silent.
// Final review I5: keyframes must keep both same-layout slides.
// Run: node tests/fixtures/sites/site/youtube/make-same-layout.ts
// (needs ffmpeg with libvpx; sharp renders the text with the machine's sans-serif font).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
// sharp is the agent's dependency, not the repository root's.
type Sharp = (input: Buffer) => { png(): { toFile(file: string): Promise<unknown> } };
const sharp = createRequire(join(dir, "../../../../../apps/agent/package.json"))("sharp") as Sharp;
const slide = (title: string, bullets: string[]) => {
  const lines = [title, ...bullets].map(
    (line, k) =>
      `<text x="60" y="${k === 0 ? 80 : 150 + k * 50}" font-family="sans-serif" font-size="${k === 0 ? 40 : 28}" fill="#111">${k === 0 ? line : `• ${line}`}</text>`,
  );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#fff"/>${lines.join("")}</svg>`,
  );
};
const slides = [
  slide("The Calvin cycle", ["Fixes carbon dioxide", "Uses ATP and NADPH", "Makes G3P sugars"]),
  slide("The Calvin cycle", ["Fixes carbon dioxide", "Needs ATP and NADH", "Makes G3P sugars"]),
  slide("Summary", ["Light becomes stored sugar"]),
];
const files = await Promise.all(
  slides.map(async (svg, i) => {
    const file = join(dir, `same-${i}.png`);
    await sharp(svg).png().toFile(file);
    return file;
  }),
);
const result = spawnSync(
  "ffmpeg",
  [
    ...["-y", "-hide_banner", "-loglevel", "error"],
    ...files.flatMap((file) => ["-loop", "1", "-t", "5", "-i", file]),
    ...["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,fps=25,format=yuv420p[v]"],
    ...["-map", "[v]", "-c:v", "libvpx", "-b:v", "300k", "-g", "25", "same-layout.webm"],
  ],
  { cwd: dir, stdio: "inherit" },
);
for (const file of files) rmSync(file);
if (result.status !== 0) throw new Error(`ffmpeg failed (${result.status})`);
