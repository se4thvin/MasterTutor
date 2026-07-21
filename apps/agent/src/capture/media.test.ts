import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { AssetInput, AssetStore } from "../notes/assets.ts";
import { storeMedia, type MediaContext } from "./media.ts";
import type { PageMedia } from "./page/types.ts";

const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0f0" } })
      .png()
      .toBuffer(),
  );

function memoryAssets(): AssetStore & { puts: AssetInput[] } {
  const puts: AssetInput[] = [];
  return {
    puts,
    async put(_ws, input) {
      puts.push(input);
      return {
        assetId: `00000000-0000-4000-8000-00000000000${puts.length}`,
        sha256: "x",
        mime: input.mime,
        bytes: 1,
        width: input.width,
        height: input.height,
      };
    },
  };
}
const base: Omit<PageMedia, "index" | "kind"> = {
  url: null,
  svg: null,
  dataUrl: null,
  alt: "a",
  rect: { x: 0, y: 0, width: 200, height: 100 },
  selector: "#x",
  figure: false,
};

async function context(overrides: Partial<MediaContext> = {}) {
  const shot = await png();
  const shots: Array<{ scale: number }> = [];
  const assets = memoryAssets();
  const ctx: MediaContext = {
    workspaceId: "w",
    assets,
    fetch: async () => null,
    sanitizeSvg: async (text) => (text.includes("onload") ? null : text),
    shoot: async (_clip, scale) => (shots.push({ scale }), shot),
    signal: new AbortController().signal,
    ...overrides,
  };
  return { ctx, assets, shots, shot };
}

describe("storeMedia", () => {
  it("stores vectors and canvases, shoots figures at scale 2, and falls back to a screenshot", async () => {
    const { ctx, assets, shots, shot } = await context();
    const report = await storeMedia(ctx, [
      {
        ...base,
        index: 0,
        kind: "svg",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
        figure: true,
      },
      {
        ...base,
        index: 1,
        kind: "svg",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>',
      },
      {
        ...base,
        index: 2,
        kind: "canvas",
        dataUrl: `data:image/png;base64,${Buffer.from(shot).toString("base64")}`,
      },
      { ...base, index: 3, kind: "img", url: "blob:https://x.test/1", rect: null },
    ]);
    expect(report.stored.get(0)).toEqual({
      assetId: expect.any(String),
      screenshotAssetId: expect.any(String),
    });
    expect(report.stored.get(1)).toEqual({ assetId: null, screenshotAssetId: expect.any(String) });
    expect(report.stored.get(2)?.assetId).toEqual(expect.any(String));
    expect(report.stored.get(3)).toEqual({ assetId: null, screenshotAssetId: null });
    expect(shots[0]).toEqual({ scale: 2 });
    expect(assets.puts.map((p) => p.mime)).toContain("image/svg+xml");
    expect(report).toMatchObject({ lost: 0, withheld: 0 });
  });

  it("sanitizes fetched SVG before any parser sees it, and counts lost and withheld media", async () => {
    const hostile = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/a#b"/></svg>',
    );
    const sanitized: string[] = [];
    const { ctx } = await context({
      fetch: async (url) =>
        url.endsWith(".svg") ? { bytes: hostile, contentType: "image/png" } : null,
      sanitizeSvg: async (text) => (
        sanitized.push(text),
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'
      ),
      shoot: async () => null,
    });
    const report = await storeMedia(ctx, [
      { ...base, index: 0, kind: "img", url: "https://x.test/a.svg" },
      { ...base, index: 1, kind: "img", url: "https://x.test/missing.png" },
    ]);
    expect(sanitized).toHaveLength(1);
    expect(report.stored.get(0)?.assetId).toEqual(expect.any(String));
    expect(report.stored.get(1)).toEqual({ assetId: null, screenshotAssetId: null });
    expect(report).toMatchObject({ lost: 1, withheld: 1 });
  });
});
