import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ControlGuard } from "./guard.ts";
import { SECRET_REDACTION, containsSecretText, redactDeep, type MaskSources } from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import type { BrowserSession } from "./session.ts";

type Params = Record<string, unknown> | undefined;
type AxSample = { name?: string; value?: string };
interface FakeOptions {
  frames?: Array<{ id: string; securityOrigin: string; url?: string }>;
  ax?: Record<string, AxSample[]>;
  axThrowsFor?: string;
  /** Trees of out-of-process frames, readable only through their own target. */
  oopif?: Record<string, AxSample[]>;
  boxModel?: (backendNodeId: number) => unknown;
  describeNode?: () => unknown;
  resolveNodeError?: string;
  nodeState?: string;
  onCapture?: () => void;
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();

const axNodes = (samples: readonly AxSample[]) =>
  samples.map((node) => ({
    name: node.name === undefined ? undefined : { value: node.name },
    value: node.value === undefined ? undefined : { value: node.value },
  }));

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
        return { nodes: axNodes(options.ax?.[id] ?? []) };
      }
      case "DOM.getBoxModel": {
        if (!options.boxModel) throw new Error("no box model");
        return options.boxModel(Number(params?.backendNodeId));
      }
      case "DOM.describeNode":
        if (options.describeNode) return options.describeNode();
        return { node: {} };
      case "DOM.resolveNode":
        if (options.resolveNodeError) throw new Error(options.resolveNodeError);
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
  const cdp = { send };
  const session = {
    guard: new ControlGuard(),
    lastScale: 1,
    page: { bringToFront: async () => undefined },
    layout: async () => ({ ...size, scrollX: 0, scrollY: 0 }),
    cdp: async () => cdp,
    frameCdp: async (frameId: string) => {
      const tree = options.oopif?.[frameId];
      if (!tree) return null;
      return {
        send: async (method: string) => {
          if (method !== "Accessibility.getFullAXTree") throw new Error(`unexpected ${method}`);
          return { nodes: axNodes(tree) };
        },
      };
    },
    worlds: async () => ({ evaluate: async () => [] }),
    outOfProcessFrames: async () => new Map(),
  } as unknown as BrowserSession;
  return {
    session,
    cdp,
    calls,
    resize: (next: { width: number; height: number }) => void (size = next),
    count: (method: string) => calls.filter((call) => call.method === method).length,
  };
}

const signal = new AbortController().signal;
/** A stand-in for the vault's matcher: plain substring replacement. */
const sources = (nodeIds: number[] = [], secrets: string[] = []): MaskSources => ({
  nodeIds: () => nodeIds,
  hasSecrets: () => secrets.length > 0,
  redact: (text) => secrets.reduce((out, secret) => out.split(secret).join(SECRET_REDACTION), text),
});

async function pixel(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

describe("MaskSources.nodeIds", () => {
  const border = [100, 100, 200, 100, 200, 150, 100, 150];

  it("masks a registered node by its box model, asking for the page session's nodes", async () => {
    const fake = fakeSession({ boxModel: () => ({ model: { border } }) });
    const asked: unknown[] = [];
    const shot = await captureModelScreenshot(
      fake.session,
      { ...sources(), nodeIds: (cdp) => (asked.push(cdp), [7]) },
      signal,
    );
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(1);
    expect(asked.every((cdp) => cdp === fake.cdp)).toBe(true);
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
      fakeSession({ resolveNodeError: "some other CDP failure" }),
    ]) {
      expect((await captureModelScreenshot(fake.session, sources([7]), signal)).dropped).toBe(true);
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

  it("keeps the frame when the node's document is gone after a navigation (F8)", async () => {
    const fake = fakeSession({
      resolveNodeError: "Node with given id does not belong to the document",
    });
    const shot = await captureModelScreenshot(fake.session, sources([7]), signal);
    expect(shot.dropped).toBe(false);
  });
});

describe("secret text scan (containsSecretText)", () => {
  const frames = [
    { id: "main", securityOrigin: "http://a.test" },
    { id: "child", securityOrigin: "http://a.test" },
  ];
  const secret = sources([], ["hunter2-secret"]);

  it("drops the frame when a secret appears in the accessibility tree", async () => {
    const fake = fakeSession({ frames, ax: { main: [{ name: "Memo", value: "hunter2-secret" }] } });
    expect((await captureModelScreenshot(fake.session, secret, signal)).dropped).toBe(true);
  });

  it("scans the accessibility tree of every frame, not only the root", async () => {
    const fake = fakeSession({
      frames,
      ax: { main: [{ name: "clean" }], child: [{ value: "hunter2-secret" }] },
    });
    expect(await containsSecretText(fake.session, secret)).toBe(true);
    expect(
      fake.calls
        .filter((call) => call.method === "Accessibility.getFullAXTree")
        .map((call) => call.params?.frameId),
    ).toEqual(["main", "child"]);
  });

  it("reads an out-of-process frame through its own target, and fails closed only when that fails too (R-E5)", async () => {
    const clean = fakeSession({ frames, axThrowsFor: "child", oopif: { child: [{ name: "Ad" }] } });
    expect(await containsSecretText(clean.session, secret)).toBe(false);
    const dirty = fakeSession({
      frames,
      axThrowsFor: "child",
      oopif: { child: [{ value: "echo hunter2-secret" }] },
    });
    expect(await containsSecretText(dirty.session, secret)).toBe(true);
    const unreadable = fakeSession({ frames, axThrowsFor: "child" });
    expect(await containsSecretText(unreadable.session, secret)).toBe(true);
  });

  it("does nothing while no secret is registered", async () => {
    const fake = fakeSession({ frames, ax: { main: [{ value: "hunter2-secret" }] } });
    expect(await containsSecretText(fake.session, sources())).toBe(false);
    expect(fake.count("Accessibility.getFullAXTree")).toBe(0);
  });

  it("delivers the frame when no secret appears", async () => {
    const fake = fakeSession({
      frames,
      ax: { main: [{ name: "clean" }], child: [{ value: "other" }] },
    });
    expect((await captureModelScreenshot(fake.session, secret, signal)).dropped).toBe(false);
  });

  it("does not treat srcdoc or about:blank frames as cross-origin", async () => {
    const inherited = [
      { id: "main", securityOrigin: "http://a.test", url: "http://a.test/" },
      { id: "x", securityOrigin: "://", url: "about:srcdoc" },
    ];
    const fake = fakeSession({ frames: inherited, nodeState: "hidden" });
    expect((await captureModelScreenshot(fake.session, sources([9]), signal)).dropped).toBe(false);
  });

  it("drops frames with cross-origin iframes only while filled nodes are registered (R-E5)", async () => {
    const cross = [
      { id: "main", securityOrigin: "http://a.test" },
      { id: "x", securityOrigin: "http://b.test" },
    ];
    const shoot = (mask: MaskSources) =>
      captureModelScreenshot(
        fakeSession({ frames: cross, nodeState: "hidden" }).session,
        mask,
        signal,
      );
    expect((await shoot(sources())).dropped).toBe(false);
    expect((await shoot(secret)).dropped).toBe(false);
    expect((await shoot(sources([9]))).dropped).toBe(true);
  });
});

describe("redactDeep", () => {
  it("redacts every string in a result and leaves keys and other values alone", () => {
    const value = { title: "pw hunter2-secret", items: ["a", "hunter2-secret"], n: 3, ok: true };
    expect(redactDeep(value, sources([], ["hunter2-secret"]))).toEqual({
      title: `pw ${SECRET_REDACTION}`,
      items: ["a", SECRET_REDACTION],
      n: 3,
      ok: true,
    });
    expect(redactDeep(value, sources())).toBe(value);
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
