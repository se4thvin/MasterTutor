import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ControlGuard } from "./guard.ts";
import {
  OOPIF_READ_TIMEOUT_MS,
  SECRET_REDACTION,
  containsSecretText,
  redactDeep,
  type MaskSources,
} from "./masking.ts";
import { captureModelScreenshot } from "./screenshot.ts";
import type { BrowserSession } from "./session.ts";

type Params = Record<string, unknown> | undefined;
type AxSample = { name?: string; value?: string };
interface OopifFake {
  ax?: AxSample[];
  /** Calls that fail before the frame answers again (a stale session after a process swap). */
  failures?: number;
  /** The frame's renderer never answers (a busy third-party frame). */
  hang?: boolean;
  /** After it is forgotten, no new session can be attached (a transient attach failure). */
  noReattach?: boolean;
}
interface FakeOptions {
  frames?: Array<{ id: string; securityOrigin: string; url?: string }>;
  ax?: Record<string, AxSample[]>;
  axThrowsFor?: string;
  /** Out-of-process frames: missing from the page tree, readable only through their own session. */
  oopif?: Record<string, OopifFake>;
  /** Live child frames whose first attach failed: neither attached nor known to be in process. */
  unattached?: number;
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
  const forgotten: string[] = [];
  const oopifSessions = new Map<
    string,
    { send: (method: string, params?: Params) => Promise<unknown> }
  >();
  const oopifSend = (id: string) => async (method: string, params?: Params) => {
    calls.push({ method: `oopif:${method}`, params: { ...params, target: id } });
    const spec = options.oopif![id]!;
    if (spec.hang) return new Promise(() => undefined);
    if ((spec.failures ?? 0) > 0) {
      spec.failures! -= 1;
      throw new Error("Target closed");
    }
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id } } };
    if (method === "Accessibility.getFullAXTree") return { nodes: axNodes(spec.ax ?? []) };
    throw new Error(`unexpected OOPIF call ${method}`);
  };
  const session = {
    guard: new ControlGuard(),
    lastScale: 1,
    page: { bringToFront: async () => undefined },
    layout: async () => ({ ...size, scrollX: 0, scrollY: 0 }),
    cdp: async () => cdp,
    worlds: async () => ({ evaluate: async () => [] }),
    outOfProcessFrames: async () => {
      for (const id of Object.keys(options.oopif ?? {}))
        if (!oopifSessions.has(id) && !(forgotten.includes(id) && options.oopif![id]!.noReattach))
          oopifSessions.set(id, { send: oopifSend(id) });
      return new Map([...oopifSessions].map(([id, own]) => [id, { cdp: own }]));
    },
    frameCoverage: async () => ({
      outOfProcess: await session.outOfProcessFrames(),
      unattached: options.unattached ?? 0,
    }),
    forgetFrame: async (frameId: string) => {
      forgotten.push(frameId);
      oopifSessions.delete(frameId);
    },
  } as unknown as BrowserSession;
  return {
    session,
    cdp,
    calls,
    forgotten,
    oopifCdp: (id: string) => oopifSessions.get(id),
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
    expect(await containsSecretText(fake.session, secret, signal)).toBe(true);
    expect(
      fake.calls
        .filter((call) => call.method === "Accessibility.getFullAXTree")
        .map((call) => call.params?.frameId),
    ).toEqual(["main", "child"]);
  });

  it("fails closed when an in-process frame's tree cannot be read", async () => {
    const unreadable = fakeSession({ frames, axThrowsFor: "child" });
    expect(await containsSecretText(unreadable.session, secret, signal)).toBe(true);
  });

  it("does nothing while no secret is registered", async () => {
    const fake = fakeSession({ frames, ax: { main: [{ value: "hunter2-secret" }] } });
    expect(await containsSecretText(fake.session, sources(), signal)).toBe(false);
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

describe("out-of-process frames (R-E5, review I1/I2)", () => {
  const secret = sources([], ["hunter2-secret"]);
  const border = [100, 100, 200, 100, 200, 150, 100, 150];

  it("reads each out-of-process frame through its own session (the production path, M1)", async () => {
    const clean = fakeSession({ oopif: { ad: { ax: [{ name: "Ad" }] } } });
    expect(await containsSecretText(clean.session, secret, signal)).toBe(false);
    const dirty = fakeSession({ oopif: { ad: { ax: [{ value: "echo hunter2-secret" }] } } });
    expect(await containsSecretText(dirty.session, secret, signal)).toBe(true);
    expect(dirty.count("oopif:Accessibility.getFullAXTree")).toBe(1);
  });

  it("fails closed when a live frame's first attach failed, so it cannot be read at all", async () => {
    const fake = fakeSession({ unattached: 1 });
    expect(await containsSecretText(fake.session, secret, signal)).toBe(true);
    expect(await containsSecretText(fakeSession().session, secret, signal)).toBe(false);
  });

  it("fails closed when a still-live frame cannot be re-attached after a failure (N1)", async () => {
    // The page tree omits out-of-process frames, so "not in the page tree" is not "gone".
    const fake = fakeSession({
      oopif: { ad: { ax: [{ value: "echo hunter2-secret" }], failures: 1, noReattach: true } },
    });
    expect(await containsSecretText(fake.session, secret, signal)).toBe(true);
    expect(fake.forgotten).toEqual(["ad"]);
  });

  it("forgets (detaches) a frame whose read timed out, so hung reads do not pile up (N3)", async () => {
    const fake = fakeSession({ oopif: { slow: { hang: true }, ok: { ax: [] } } });
    expect(await containsSecretText(fake.session, secret, signal)).toBe(true);
    expect(fake.forgotten).toEqual(["slow"]);
  });

  it("forgets a stale frame session and retries once; still failing fails closed (I2a)", async () => {
    const healed = fakeSession({ oopif: { ad: { ax: [{ name: "Ad" }], failures: 1 } } });
    expect(await containsSecretText(healed.session, secret, signal)).toBe(false);
    expect(healed.forgotten).toEqual(["ad"]);
    const dead = fakeSession({ oopif: { ad: { ax: [{ name: "Ad" }], failures: 99 } } });
    expect(await containsSecretText(dead.session, secret, signal)).toBe(true);
    expect(dead.forgotten).toEqual(["ad"]);
  });

  it("bounds hung frames with a timeout that fails closed, reading frames in parallel (I2b, M8)", async () => {
    const hung = fakeSession({
      oopif: { a: { hang: true }, b: { hang: true }, c: { hang: true }, d: { ax: [] } },
    });
    const started = performance.now();
    expect(await containsSecretText(hung.session, secret, signal)).toBe(true);
    // Three hung frames, each bounded at OOPIF_READ_TIMEOUT_MS: in parallel, not in sequence.
    expect(performance.now() - started).toBeLessThan(2 * OOPIF_READ_TIMEOUT_MS);
  });

  it("stops at a takeover instead of finishing the scan (I2b)", async () => {
    const fake = fakeSession({ oopif: { a: { hang: true } } });
    const controller = new AbortController();
    const scan = containsSecretText(fake.session, secret, controller.signal);
    controller.abort(new Error("takeover"));
    await expect(scan).rejects.toThrow("takeover");
  });

  it("an unrelated cross-site frame does not drop a page whose filled fields it cannot hold (I1)", async () => {
    const fake = fakeSession({
      oopif: { ad: { ax: [{ name: "Ad" }] } },
      boxModel: () => ({ model: { border } }),
    });
    // Registered on the page's session only (R-E6): the frame's session holds none.
    const filled: MaskSources = { ...sources(), nodeIds: (cdp) => (cdp === fake.cdp ? [7] : []) };
    const shot = await captureModelScreenshot(fake.session, filled, signal);
    expect(shot.dropped).toBe(false);
    expect(shot.masked).toBe(1);
    expect(await pixel(shot.png, 150, 125)).toEqual([0, 0, 0]);
  });

  it("still drops after the frame's session was swapped: fills are found by frame id (N2)", async () => {
    const fake = fakeSession({ oopif: { login: { ax: [] } } });
    // Registered on a session that has since been forgotten and replaced.
    const mask: MaskSources = { ...sources(), filledFrames: () => ["login"] };
    expect((await captureModelScreenshot(fake.session, mask, signal)).dropped).toBe(true);
    const unrelated: MaskSources = { ...sources(), filledFrames: () => ["gone"] };
    expect((await captureModelScreenshot(fake.session, unrelated, signal)).dropped).toBe(false);
  });

  it("drops the page when the vault filled a field inside an out-of-process frame (I1)", async () => {
    const fake = fakeSession({ oopif: { login: { ax: [] } } });
    await fake.session.outOfProcessFrames();
    const inFrame = fake.oopifCdp("login");
    const mask: MaskSources = {
      ...sources(),
      nodeIds: (cdp) => (cdp === inFrame ? [11] : []),
    };
    expect((await captureModelScreenshot(fake.session, mask, signal)).dropped).toBe(true);
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
