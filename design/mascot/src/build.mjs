// Renders every concept from its three.js build, then writes the sheets and the comparison page.
//   node design/mascot/src/build.mjs [--only pip] [--renders-only]
// Needs `three` and `@playwright/test` from apps/web (pnpm install), or MASCOT_DEPS=<path to apps/web/package.json>.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { concepts } from "./concepts.mjs";
import { comparisonPage, sheetDocument } from "./page.mjs";
import { SHOTS } from "./shots.mjs";

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, "..");
const req = createRequire(process.env.MASCOT_DEPS ?? join(SRC, "../../../apps/web/package.json"));
const THREE = join(dirname(req.resolve("three")), "..");
const { chromium } = req("@playwright/test");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };

function serve() {
  const server = createServer((rq, rs) => {
    const path = normalize(decodeURIComponent(new URL(rq.url, "http://x").pathname));
    const file = path.startsWith("/vendor/three/") ? join(THREE, path.slice(14)) : join(SRC, path);
    if (!file.startsWith(THREE) && !file.startsWith(SRC)) return rs.writeHead(403).end();
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return rs.writeHead(404).end();
    }
    rs.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const server = await serve();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu"] });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
page.on("response", (r) => r.status() >= 400 && console.error("http", r.status(), r.url()));
page.on("pageerror", (e) => console.error("page:", e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/render.html`);
await page.waitForFunction(() => window.ready === true);

mkdirSync(join(OUT, "renders"), { recursive: true });
const dataPath = join(OUT, "renders", "data.json");
let data = {};
try {
  data = JSON.parse(readFileSync(dataPath, "utf8"));
} catch {}
for (const c of concepts) {
  if (only && c.id !== only) continue;
  const entry = { stats: await page.evaluate((id) => window.countTriangles(id), c.id), shots: {} };
  for (const shot of SHOTS(c)) {
    const t = Date.now();
    const r = await page.evaluate((s) => window.renderShot(s), { concept: c.id, ...shot });
    writeFileSync(join(OUT, "renders", `${c.id}-${shot.id}.webp`), Buffer.from(r.url.split(",")[1], "base64"));
    entry.shots[shot.id] = r.marks;
    console.log(`${c.id}-${shot.id} ${Date.now() - t}ms`);
  }
  data[c.id] = entry;
}
writeFileSync(dataPath, JSON.stringify(data, null, 1));

if (!args.includes("--renders-only")) {
  const img = (c, id) => `data:image/webp;base64,${readFileSync(join(OUT, "renders", `${c.id}-${id}.webp`)).toString("base64")}`;
  writeFileSync(join(OUT, "index.html"), comparisonPage(concepts, data, img));
  mkdirSync(join(OUT, "sheets"), { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1200 });
  for (const c of concepts) {
    for (const theme of ["light", "dark"]) {
      await page.setContent(sheetDocument(c, data, img, theme));
      await page.waitForLoadState("load");
      await page.locator(".sheet").screenshot({ path: join(OUT, "sheets", `${c.id}-model-sheet-${theme}.jpg`), type: "jpeg", quality: 86 });
    }
  }
}
await browser.close();
server.close();
