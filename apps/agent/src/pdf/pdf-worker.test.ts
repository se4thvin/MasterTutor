import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { pdfReferenceText } from "./layout.ts";
import { analyzePdf, MAX_RENDER_PIXELS, workerFlags } from "./pdf-worker.ts";

const bytes = async () =>
  new Uint8Array(
    await readFile(new URL("../../../../tests/fixtures/sites/site/pdf/paper.pdf", import.meta.url)),
  );
const signal = new AbortController().signal;

describe("analyzePdf (pdf.js outside the agent process)", () => {
  it("reads text with top-left coordinates, image flags, the title and the renders capture needs", async () => {
    const out = await analyzePdf(await bytes(), { render: "auto", scale: 2 }, signal);
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
      expect(render.png.slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  });
  it("keeps renders under the pixel cap", async () => {
    const out = await analyzePdf(await bytes(), { render: [2], scale: 10 }, signal);
    const meta = await sharp(out.renders[0]!.png).metadata();
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
  });
  it("rejects bytes that are not a PDF", async () => {
    await expect(
      analyzePdf(new TextEncoder().encode("<html>"), { render: "auto", scale: 2 }, signal),
    ).rejects.toMatchObject({ code: "not_pdf" });
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
  });
});
