import { describe, expect, it } from "vitest";
import { readCapped } from "./read-capped.ts";

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
const request = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://web:3000/x", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);

describe("readCapped", () => {
  it("reads a body up to the cap", async () => {
    expect(await readCapped(request("abcd"), 4)).toBe("abcd");
    expect(await readCapped(request(null), 4)).toBe("");
  });

  it("refuses a declared or streamed body over the cap", async () => {
    expect(await readCapped(request("ab", { "content-length": "99" }), 4)).toBeNull();
    expect(await readCapped(request(streamOf("abc", "de")), 4)).toBeNull();
  });
});
