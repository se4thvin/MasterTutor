import { spawnSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PIXELS, MAX_RENDER_PIXELS } from "../protocol.ts";
import { pdfReferenceText } from "./layout.ts";
import { runInSandbox, SandboxFailed, workerFlags } from "./sandbox.ts";

const bytes = async () =>
  new Uint8Array(
    await readFile(
      new URL("../../../../../tests/fixtures/sites/site/pdf/paper.pdf", import.meta.url),
    ),
  );
const signal = new AbortController().signal;
const png = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

describe("runInSandbox (pdf.js in a permission-restricted child)", () => {
  it("reads text with top-left coordinates, image flags, the title and the renders capture needs", async () => {
    const out = await runInSandbox({ render: "auto", scale: 2 }, await bytes(), signal);
    if (!out.ok) throw new Error(out.error);
    expect(out.pages.map((p) => [p.page, p.hasImages, p.items.length > 0])).toEqual([
      [1, true, true],
      [2, false, true],
      [3, true, false],
    ]);
    const title = out.pages[0]!.items.find((i) => i.str.startsWith("Photosynthesis: A Short"))!;
    expect(title.y).toBeLessThan(80);
    expect(title.height).toBeGreaterThan(20);
    expect(pdfReferenceText(out.pages)).toContain("rubisco attaches carbon dioxide");
    expect(out.title).toBe("Photosynthesis: A Short Primer");
    expect(out.renders.map((r) => `${r.page}@${r.scale}`).sort()).toEqual(["1@1", "1@2", "3@2"]);
    for (const render of out.renders)
      expect(png(render.png).slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });
  it("keeps renders under the pixel cap", async () => {
    const out = await runInSandbox({ render: [2], scale: 10 }, await bytes(), signal);
    if (!out.ok) throw new Error(out.error);
    const meta = await sharp(png(out.renders[0]!.png)).metadata();
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });
  it("never decodes an image past MAX_IMAGE_PIXELS (I-2)", async () => {
    const width = 5_000;
    const height = Math.ceil(MAX_IMAGE_PIXELS / width) + 10;
    const jpeg = await sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawImage(await doc.embedJpg(jpeg), { x: 0, y: 0, width: 200, height: 200 });
    const out = await runInSandbox({ render: [1], scale: 1 }, await doc.save(), signal);
    if (!out.ok) throw new Error(out.error);
    const { channels } = await sharp(png(out.renders[0]!.png))
      .flatten({ background: "#ffffff" })
      .stats();
    // The image was skipped, not painted: the page stays white instead of red.
    expect(channels[1]!.mean).toBeGreaterThan(240);
  });
  it("decodes a JPEG 2000 image, as scanned archives use (QA-111)", async () => {
    // A 64×64 red JP2 (made with macOS sips), as the page's only content.
    const jp2 = await readFile(
      new URL("../../../../../tests/fixtures/pdf-images/red-64.jp2", import.meta.url),
    );
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const image = doc.context.register(
      doc.context.stream(jp2, {
        Type: "XObject",
        Subtype: "Image",
        Width: 64,
        Height: 64,
        Filter: "JPXDecode",
      }),
    );
    page.node.setXObject(PDFName.of("Im0"), image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(200, 0, 0, 200, 0, 0),
      drawObject("Im0"),
      popGraphicsState(),
    );
    const out = await runInSandbox({ render: [1], scale: 1 }, await doc.save(), signal);
    if (!out.ok) throw new Error(out.error);
    const { channels } = await sharp(png(out.renders[0]!.png))
      .flatten({ background: "#ffffff" })
      .stats();
    // Painted red, not left white: the JPX decoder (pdf.js's OpenJPEG wasm) ran.
    expect(channels[0]!.mean).toBeGreaterThan(180);
    expect(channels[1]!.mean).toBeLessThan(60);
  });
  it("refuses a page with more text items than MAX_PAGE_ITEMS as too large (I-3)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    // Each call on its own baseline, so pdf.js keeps every one as a separate item.
    for (let i = 0; i < 100_050; i++)
      page.drawText("a", { x: Math.floor(i / 7_800) * 40, y: (i % 7_800) * 0.1, size: 2 });
    const out = await runInSandbox({ render: [], scale: 1 }, await doc.save(), signal);
    expect(out).toEqual({ ok: false, error: "too_large" });
  }, 120_000);
  it("kills a parse that runs past its time limit (I-2)", async () => {
    await expect(
      runInSandbox({ render: "auto", scale: 2 }, await bytes(), signal, 1),
    ).rejects.toBeInstanceOf(SandboxFailed);
  });
  it("rejects bytes that are not a PDF", async () => {
    expect(
      await runInSandbox({ render: "auto", scale: 2 }, new TextEncoder().encode("<html>"), signal),
    ).toEqual({ ok: false, error: "not_pdf" });
  });
  it("runs where it can read no other file and start no process (S3)", () => {
    const read = spawnSync(
      process.execPath,
      [...workerFlags(), "-e", "require('node:fs').readFileSync('/etc/hosts')"],
      { env: {}, encoding: "utf8" },
    );
    expect(read.status).not.toBe(0);
    expect(read.stderr).toMatch(/ERR_ACCESS_DENIED/);
    const exec = spawnSync(
      process.execPath,
      [...workerFlags(), "-e", "require('node:child_process').execSync('true')"],
      { env: {}, encoding: "utf8" },
    );
    expect(exec.status).not.toBe(0);
    expect(exec.stderr).toMatch(/ERR_ACCESS_DENIED/);
  });
  it("can write no file and compile no code from strings (QA-106)", () => {
    const write = spawnSync(
      process.execPath,
      [...workerFlags(), "-e", "require('node:fs').writeFileSync('/tmp/mt-sandbox-write', 'x')"],
      { env: {}, encoding: "utf8" },
    );
    expect(write.status).not.toBe(0);
    expect(write.stderr).toMatch(/ERR_ACCESS_DENIED/);
    for (const code of ["eval('1 + 1')", "new Function('return 1')()"]) {
      const run = spawnSync(process.execPath, [...workerFlags(), "-e", code], {
        env: {},
        encoding: "utf8",
      });
      expect(run.status, code).not.toBe(0);
      expect(run.stderr, code).toMatch(/Code generation from strings disallowed/);
    }
  });
  it("reads no package outside its own through node_modules links (QA-105)", () => {
    const agent = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const roots = workerFlags()
      .filter((flag) => flag.startsWith("--allow-fs-read="))
      .map((flag) => flag.slice("--allow-fs-read=".length));
    // No root is a top-level node_modules or an ancestor of one: links there lead anywhere.
    for (const modules of [resolve(agent, "node_modules"), resolve(agent, "../../node_modules")])
      for (const root of roots)
        expect(modules === root || modules.startsWith(root + sep)).toBe(false);
    for (const linked of ["@mastertutor/contracts/package.json", "sharp/package.json"]) {
      const read = spawnSync(
        process.execPath,
        [
          ...workerFlags(),
          "-e",
          `require('node:fs').readFileSync(${JSON.stringify(resolve(agent, "node_modules", linked))})`,
        ],
        { env: {}, encoding: "utf8" },
      );
      expect(read.stderr, linked).toMatch(/ERR_ACCESS_DENIED/);
    }
  });
});
