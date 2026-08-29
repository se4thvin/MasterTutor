// Regenerates video.webm (4 distinct 5s slides + 440 Hz tone) and black.webm (DRM stand-in).
// Run: node tests/fixtures/sites/site/youtube/make-video.ts   (needs ffmpeg with libvpx and libopus)
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const W = 640;
const H = 360;

// Each slide sits on a diagonal luminance ramp: flat stripes alone leave most DCT coefficients at
// the median, so encoder noise would flip perceptual-hash bits between frames of one slide.
const ramp = (x: number, y: number) => Math.round(((x + 2 * y) / (W + 2 * H)) * 90) - 45;
const clamp = (v: number) => Math.max(0, Math.min(255, v));

function ppm(name: string, paint: (x: number, y: number) => [number, number, number]): string {
  const header = Buffer.from(`P6\n${W} ${H}\n255\n`, "ascii");
  const pixels = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      pixels.set(
        paint(x, y).map((c) => clamp(c + ramp(x, y))),
        (y * W + x) * 3,
      );
  const file = join(dir, name);
  writeFileSync(file, Buffer.concat([header, pixels]));
  return name;
}

const slides = [
  ppm("slide-1.ppm", (x) => (Math.floor(x / 80) % 2 ? [30, 90, 200] : [240, 240, 240])),
  ppm("slide-2.ppm", (_x, y) => (Math.floor(y / 45) % 2 ? [200, 60, 40] : [250, 230, 200])),
  ppm("slide-3.ppm", (x, y) =>
    (Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [20, 140, 60] : [230, 250, 230],
  ),
  ppm("slide-4.ppm", (x, y) =>
    (x - W / 2) ** 2 + (y - H / 2) ** 2 < 120 ** 2 ? [240, 180, 0] : [40, 40, 60],
  ),
];

const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    cwd: dir,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed (${result.status})`);
};

ffmpeg([
  ...slides.flatMap((s) => ["-loop", "1", "-t", "5", "-i", s]),
  ...["-f", "lavfi", "-t", "20", "-i", "sine=frequency=440:sample_rate=48000"],
  ...["-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,fps=25,format=yuv420p[v]"],
  ...["-map", "[v]", "-map", "4:a", "-c:v", "libvpx", "-b:v", "2M", "-qmax", "8", "-g", "25"],
  ...["-c:a", "libopus", "-b:a", "48k", "-shortest", "video.webm"],
]);
ffmpeg([
  ...["-f", "lavfi", "-i", "color=c=black:s=640x360:d=6:r=25"],
  ...["-f", "lavfi", "-t", "6", "-i", "sine=frequency=440"],
  ...["-c:v", "libvpx", "-b:v", "50k", "-g", "25", "-c:a", "libopus", "-shortest", "black.webm"],
]);
for (const s of slides) rmSync(join(dir, s));
