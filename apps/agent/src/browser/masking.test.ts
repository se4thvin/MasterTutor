import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ControlGuard } from "./guard.ts";
import { containsSecretText, isScannableSecret, type MaskSources } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import type { BrowserSession } from "./session.ts";

type Params = Record<string, unknown> | undefined;
interface FakeOptions {
  frames?: Array<{ id: string; securityOrigin: string }>;
  ax?: Record<string, Array<{ name?: string; value?: string }>>;
  axThrowsFor?: string;
  boxModel?: (backendNodeId: number) => unknown;
  describeNode?: () => unknown;
  nodeState?: string;
  onCapture?: () => void;
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();

function fakeSession(options: FakeOptions = {}) {
  const calls: Array<{ method: string; params: Params }> = [];
  let size = { width: 1280, height: 713 };
  const frames = options.frames ?? [{ id: "main", securityOrigin: "http://a.test" }];
  const send = async (method: string, params?: Params) => {
    calls.push({ method, params });
    switch (method) {
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: frames[0],
            childFrames: frames.slice(1).map((frame) => ({ frame })),
          },
        };
      case "Accessibility.getFullAXTree": {
        const id = String(params?.frameId);
        if (id === options.axThrowsFor) throw new Error("frame not in this target");
        return {
          nodes: (options.ax?.[id] ?? []).map((node) => ({
            name: node.name === undefined ? undefined : { value: node.name },
            value: node.value === undefined ? undefined : { value: node.value },
          })),
        };
      }
      case "DOM.getBoxModel": {
        if (!options.boxModel) throw new Error("no box model");
        return options.boxModel(Number(params?.backendNodeId));
      }
      case "DOM.describeNode":
        if (options.describeNode) return options.describeNode();
        return { node: {} };
      case "DOM.resolveNode":
        return { object: { objectId: "obj-1" } };
      case "Runtime.callFunctionOn":
        return { result: { value: options.nodeState ?? "visible" } };
      case "Page.captureScreenshot": {
        const data = (await png(size.width, size.height)).toString("base64");
        options.onCapture?.();
        return { data };
      }
      default:
        throw new Error(`unexpected CDP call ${method}`);
    }
  };
  const session = {
    guard: new ControlGuard(),
    lastScale: 1,
    page: { bringToFront: async () => undefined },
    layout: async () => ({ ...size, scrollX: 0, scrollY: 0 }),
    cdp: async () => ({ send }),
    worlds: async () => ({ evaluate: async () => [] }),
  } as unknown as BrowserSession;
  return {
    session,
    calls,
    resize: (next: { width: number; height: number }) => void (size = next),
    count: (method: string) => calls.filter((call) => call.method === method).length,
  };
}

const signal = new AbortController().signal;
const sources = (nodeIds: number[] = [], secretValues: string[] = []): MaskSources => ({
  nodeIds: () => nodeIds,
  secretValues: () => secretValues,
});

async function pixel(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

describe("MaskSources.nodeIds", () => {
  const border = [100, 100, 200, 100, 200, 150, 100, 150];

  it("masks a registered node by its box model", async () => {
    const fake = fakeSession({ boxModel: () => ({ model: { border } }) });
    const shot = await captureModelScreenshot(fake.session, sources([7]), signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(1);
    expect(await pixel(shot.png, 150, 125)).toEqual([0, 0, 0]);
    expect(await pixel(shot.png, 500, 400)).toEqual([255, 255, 255]);
  });

  it("drops the frame when a registered node has no box and might still be shown", async () => {
    for (const fake of [
      fakeSession({ nodeState: "visible" }),
      fakeSession({
        describeNode: () => {
          throw new Error("no node with that id in this target");
        },
      }),
    ]) {
      const shot = await captureModelScreenshot(fake.session, sources([7]), signal);
      expect(shot.dropped).toBe(true);
    }
  });

  it("keeps the frame when a registered node is provably detached or hidden", async () => {
    for (const nodeState of ["detached", "hidden"]) {
      const fake = fakeSession({ nodeState });
      const shot = await captureModelScreenshot(fake.session, sources([7]), signal);
      expect(shot.dropped).toBe(false);
      expect(shot.masked).toBe(0);
    }
  });
});

describe("MaskSources.secretValues and containsSecretText", () => {
  const frames = [
    { id: "main", securityOrigin: "http://a.test" },
    { id: "child", securityOrigin: "http://a.test" },
  ];

  it("drops the frame when a secret appears in the accessibility tree", async () => {
    const fake = fakeSession({ frames, ax: { main: [{ name: "Memo", value: "hunter2-secret" }] } });
    const shot = await captureModelScreenshot(
      fake.session,
      sources([], ["hunter2-secret"]),
      signal,
    );
    expect(shot.dropped).toBe(true);
  });

  it("scans the accessibility tree of every frame, not only the root", async () => {
    const fake = fakeSession({
      frames,
      ax: { main: [{ name: "clean" }], child: [{ value: "hunter2-secret" }] },
    });
    expect(await containsSecretText(fake.session, ["hunter2-secret"])).toBe(true);
    expect(
      fake.calls
        .filter((call) => call.method === "Accessibility.getFullAXTree")
        .map((call) => call.params?.frameId),
    ).toEqual(["main", "child"]);
  });

  it("fails closed when a frame's tree cannot be read", async () => {
    const fake = fakeSession({ frames, axThrowsFor: "child", ax: { main: [] } });
    expect(await containsSecretText(fake.session, ["hunter2-secret"])).toBe(true);
  });

  it("delivers the frame when no secret appears", async () => {
    const fake = fakeSession({
      frames,
      ax: { main: [{ name: "clean" }], child: [{ value: "other" }] },
    });
    const shot = await captureModelScreenshot(
      fake.session,
      sources([], ["hunter2-secret"]),
      signal,
    );
    expect(shot.dropped).toBe(false);
  });

  it("skips only all-digit secrets shorter than 4 characters", async () => {
    expect([isScannableSecret("12"), isScannableSecret("123")]).toEqual([false, false]);
    expect([
      isScannableSecret("1234"),
      isScannableSecret("ab"),
      isScannableSecret("a1"),
      isScannableSecret("pw!"),
      isScannableSecret(""),
    ]).toEqual([true, true, true, true, false]);
    const ax = { main: [{ value: "12" }, { name: "ab" }] };
    expect(await containsSecretText(fakeSession({ ax }).session, ["12"])).toBe(false);
    expect(await containsSecretText(fakeSession({ ax }).session, ["ab"])).toBe(true);
  });

  it("does not treat srcdoc or about:blank frames as cross-origin", async () => {
    const inherited = [
      { id: "main", securityOrigin: "http://a.test", url: "http://a.test/" },
      { id: "x", securityOrigin: "://", url: "about:srcdoc" },
    ];
    const fake = fakeSession({ frames: inherited as never });
    expect(
      (await captureModelScreenshot(fake.session, sources([], ["hunter2-secret"]), signal)).dropped,
    ).toBe(false);
  });

  it("drops frames with cross-origin iframes only while secrets or nodes are registered", async () => {
    const cross = [
      { id: "main", securityOrigin: "http://a.test" },
      { id: "x", securityOrigin: "http://b.test" },
    ];
    expect(
      (await captureModelScreenshot(fakeSession({ frames: cross }).session, sources(), signal))
        .dropped,
    ).toBe(false);
    expect(
      (
        await captureModelScreenshot(
          fakeSession({ frames: cross }).session,
          sources([], ["hunter2-secret"]),
          signal,
        )
      ).dropped,
    ).toBe(true);
    expect(
      (await captureModelScreenshot(fakeSession({ frames: cross }).session, sources([9]), signal))
        .dropped,
    ).toBe(true);
  });
});

describe("resize between layout and capture", () => {
  it("retakes instead of masking a misaligned image", async () => {
    let flipped = false;
    const fake = fakeSession({
      onCapture: () => {
        if (flipped) return;
        flipped = true;
        // The window resizes inside the first capture, after the layout was read.
        fake.resize({ width: 1000, height: 700 });
      },
    });
    const shot = await captureModelScreenshot(fake.session, sources(), signal);
    expect(flipped).toBe(true);
    expect(fake.count("Page.captureScreenshot")).toBe(2);
    expect(shot.dropped).toBe(false);
    expect([shot.width, shot.height]).toEqual([1000, 700]);
  });
});
