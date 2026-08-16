import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeDataUrl,
  FETCH_TIMEOUT_MS,
  fetchInBrowser,
  fetchTimeoutMs,
  MAX_FETCH_TIMEOUT_MS,
  sameSite,
} from "./fetch-resource.ts";

function fakeSession(body: Uint8Array, options: { status?: number; allowed?: boolean } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const cdp = {
    async send(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "Network.loadNetworkResource")
        return {
          resource: {
            success: true,
            httpStatusCode: options.status ?? 200,
            stream: "s1",
            headers: { "Content-Type": "image/png" },
          },
        };
      if (method === "IO.read")
        return { data: Buffer.from(body).toString("base64"), base64Encoded: true, eof: true };
      return {};
    },
  };
  return {
    calls,
    session: {
      cdp: async () => cdp,
      allowsFetch: async () => options.allowed ?? true,
      page: { url: () => "https://www.example.com/article" },
    } as never,
  };
}
const ctx = (session: never, signal = new AbortController().signal) => ({
  session,
  frameId: "F",
  signal,
});

afterEach(() => vi.restoreAllMocks());

describe("fetchInBrowser", () => {
  it("refuses what the network policy refuses, before any CDP call", async () => {
    const fake = fakeSession(new Uint8Array([1]), { allowed: false });
    expect(await fetchInBrowser(ctx(fake.session), "http://169.254.169.254/latest")).toBeNull();
    expect(fake.calls).toEqual([]);
  });
  it("reads through the browser's network stack and never calls global fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const fake = fakeSession(new Uint8Array([1, 2, 3]));
    const res = await fetchInBrowser(ctx(fake.session), "https://cdn.example.com/a.png");
    expect(res?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(res?.contentType).toBe("image/png");
    expect(spy).not.toHaveBeenCalled();
    expect(fake.calls.map((c) => c.method)).toEqual([
      "Network.loadNetworkResource",
      "IO.read",
      "IO.close",
    ]);
    expect(fake.calls[0]!.params.options).toEqual({
      disableCache: false,
      includeCredentials: true,
    });
  });
  it("sends no cookies cross-site", async () => {
    const fake = fakeSession(new Uint8Array([1]));
    await fetchInBrowser(ctx(fake.session), "https://tracker.other.test/a.png");
    expect(fake.calls[0]!.params.options).toEqual({
      disableCache: false,
      includeCredentials: false,
    });
    expect(sameSite(new URL("https://example.com/x"), "https://www.example.com/")).toBe(true);
    expect(sameSite(new URL("https://evil-example.com/x"), "https://example.com/")).toBe(false);
  });
  it("enforces the size cap, treats HTTP errors as missing and stops when the run is interrupted", async () => {
    expect(
      await fetchInBrowser(ctx(fakeSession(new Uint8Array(10)).session), "https://x.test/a", 5),
    ).toBeNull();
    expect(
      await fetchInBrowser(
        ctx(fakeSession(new Uint8Array(1), { status: 404 }).session),
        "https://x.test/a",
      ),
    ).toBeNull();
    const controller = new AbortController();
    controller.abort(new Error("takeover"));
    await expect(
      fetchInBrowser(
        ctx(fakeSession(new Uint8Array(1)).session, controller.signal),
        "https://x.test/a",
      ),
    ).rejects.toThrow("takeover");
  });
});

describe("decodeDataUrl", () => {
  it("decodes base64 and percent-encoded payloads with a cap", () => {
    expect(decodeDataUrl("data:image/png;base64,AQID")?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(decodeDataUrl("data:image/svg+xml,%3Csvg%2F%3E")!.bytes)).toBe(
      "<svg/>",
    );
    expect(decodeDataUrl("data:image/png;base64,AQID", 2)).toBeNull();
    expect(decodeDataUrl("https://x.test")).toBeNull();
  });
});

describe("fetchInBrowser timeout (B5 review: large PDFs)", () => {
  /** One 1-byte read that arrives after `delayMs`; `length` is the declared Content-Length. */
  function slowSession(delayMs: number, length: string | null) {
    const cdp = {
      async send(method: string) {
        if (method === "Network.loadNetworkResource")
          return {
            resource: {
              success: true,
              httpStatusCode: 200,
              stream: "s1",
              headers: length ? { "Content-Length": length } : {},
            },
          };
        if (method === "IO.read")
          return new Promise((done) =>
            setTimeout(() => done({ data: "AQ==", base64Encoded: true, eof: true }), delayMs),
          );
        return {};
      },
    };
    return {
      cdp: async () => cdp,
      allowsFetch: async () => true,
      page: { url: () => "https://www.example.com/" },
    } as never;
  }

  it("scales with size, bounded", () => {
    expect(fetchTimeoutMs(0)).toBe(FETCH_TIMEOUT_MS);
    expect(fetchTimeoutMs(100 * 1024 * 1024)).toBe(FETCH_TIMEOUT_MS + 100_000);
    expect(fetchTimeoutMs(10 * 1024 ** 3)).toBe(MAX_FETCH_TIMEOUT_MS);
  });
  it("gives a large declared download more than 30 s, and still stops a stalled one", async () => {
    vi.useFakeTimers();
    try {
      const big = fetchInBrowser(
        ctx(slowSession(60_000, String(80 * 1024 * 1024))),
        "https://x.test/a.pdf",
        100 * 1024 * 1024,
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await big)?.bytes).toEqual(new Uint8Array([1]));
      const stalled = fetchInBrowser(
        ctx(slowSession(60_000, null)),
        "https://x.test/b.pdf",
        100 * 1024 * 1024,
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await stalled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("refuses a declared size over the cap before reading", async () => {
    expect(await fetchInBrowser(ctx(slowSession(0, "999")), "https://x.test/c.pdf", 10)).toBeNull();
  });
});
