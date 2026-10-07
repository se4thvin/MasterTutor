import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { AssetRejected, type AssetInput, type AssetStore } from "../notes/assets.ts";
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
  fixed: false,
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
    secrets: NO_MASK_SOURCES,
    ocrCheck: null,
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
  it("takes one element screenshot at a time: each scrolls the same page", async () => {
    let active = 0;
    let overlap = 0;
    const { ctx } = await context();
    const shot = await png();
    ctx.shoot = async () => {
      active++;
      if (active > 1) overlap++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return shot;
    };
    const items = [0, 1, 2, 3, 4, 5].map((index) => ({
      ...base,
      index,
      kind: "img" as const,
      figure: true,
    }));
    const report = await storeMedia(ctx, items);
    expect(overlap).toBe(0);
    expect([...report.stored.values()].every((m) => m.screenshotAssetId !== null)).toBe(true);
  });
  it("counts an asset the store rejects as lost, but a secret in its URL stops the capture", async () => {
    const { ctx } = await context({ shoot: null });
    const shot = await png();
    ctx.fetch = async () => ({ bytes: shot, contentType: "image/png" });
    ctx.assets = {
      put: async () => {
        throw new AssetRejected("asset too large");
      },
    };
    const report = await storeMedia(ctx, [
      { ...base, index: 0, kind: "img", url: "https://x.test/a.png" },
    ]);
    expect(report).toMatchObject({ lost: 1 });
    ctx.assets = {
      put: async () => {
        throw Object.assign(new Error("secret"), { code: "secret_on_page" });
      },
    };
    await expect(
      storeMedia(ctx, [{ ...base, index: 0, kind: "img", url: "https://x.test/a.png" }]),
    ).rejects.toMatchObject({ code: "secret_on_page" });
  });
  it("loses one item on a failed shot or store, and stops starting new items on a fatal error (M1)", async () => {
    const { ctx } = await context();
    let shots = 0;
    ctx.shoot = async () => {
      shots += 1;
      if (shots === 1) throw new Error("tile vanished");
      return png();
    };
    const items = [0, 1, 2].map((index) => ({
      ...base,
      index,
      kind: "img" as const,
      figure: true,
    }));
    const report = await storeMedia(ctx, items);
    expect(report.stored.size).toBe(3);
    expect(report.lost).toBe(1);

    const started: number[] = [];
    const { ctx: fatal } = await context({ shoot: null });
    fatal.fetch = async (url) => {
      started.push(Number(url.slice(-1)));
      if (url.endsWith("0")) throw Object.assign(new Error("secret"), { code: "secret_on_page" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return null;
    };
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...base,
      index,
      kind: "img" as const,
      url: `https://x.test/${index}`,
    }));
    await expect(storeMedia(fatal, many)).rejects.toMatchObject({ code: "secret_on_page" });
    expect(started.length).toBeLessThan(9);
  });

  it("never shoots fixed or sticky media: the shot would scroll away from it (M8)", async () => {
    const { ctx, shots } = await context();
    const report = await storeMedia(ctx, [
      { ...base, index: 0, kind: "canvas", dataUrl: null, figure: true, fixed: true },
    ]);
    expect(shots).toEqual([]);
    expect(report.stored.get(0)).toEqual({ assetId: null, screenshotAssetId: null });
  });
  it("screens SVG text against the vault before storing it (5-8 review I1)", async () => {
    const { ctx, assets } = await context({
      secrets: {
        nodeIds: () => [],
        hasSecrets: () => true,
        redact: (text) => text.replaceAll("hunter2", "[secret]"),
      },
    });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><text>pw hunter2</text></svg>';
    await expect(
      storeMedia(ctx, [{ ...base, index: 0, kind: "svg", svg, figure: true }]),
    ).rejects.toMatchObject({ code: "secret_on_page" });
    expect(assets.puts).toEqual([]);
  });
  it("checks canvas pixels with OCR before storing them while the run holds secrets (re-review I1)", async () => {
    const shot = await png();
    const canvas = {
      ...base,
      index: 0,
      kind: "canvas" as const,
      dataUrl: `data:image/png;base64,${Buffer.from(shot).toString("base64")}`,
      figure: true,
    };
    const secrets = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2", "[secret]"),
    };
    // OCR reads the secret: the capture is refused and nothing is stored.
    const leaking = await context({ secrets, ocrCheck: async () => "pw hunter2" });
    await expect(storeMedia(leaking.ctx, [canvas])).rejects.toMatchObject({
      code: "secret_on_page",
    });
    expect(leaking.assets.puts).toEqual([]);
    // OCR unavailable or failing: the image is withheld, never stored unchecked.
    const failing = await context({
      secrets,
      ocrCheck: async () => {
        throw new Error("upstream 503");
      },
    });
    const report = await storeMedia(failing.ctx, [canvas]);
    expect(failing.assets.puts).toEqual([]);
    expect(report.stored.get(0)).toEqual({ assetId: null, screenshotAssetId: null });
    const none = await context({ secrets, ocrCheck: null });
    await storeMedia(none.ctx, [canvas]);
    expect(none.assets.puts).toEqual([]);
    // Clean OCR text: stored as before.
    const clean = await context({ secrets, ocrCheck: async () => "Quarterly results" });
    const ok = await storeMedia(clean.ctx, [canvas]);
    expect(ok.stored.get(0)?.assetId).toEqual(expect.any(String));
  });
});
