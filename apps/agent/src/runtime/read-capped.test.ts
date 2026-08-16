import { describe, expect, it } from "vitest";
import { BodyTooLarge, readCappedText } from "./read-capped.ts";

const stream = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });

describe("readCappedText", () => {
  it("reads a body within its cap", async () => {
    expect(await readCappedText(stream(["ab", "cd"]), 4)).toBe("abcd");
    expect(await readCappedText(null, 4)).toBe("");
  });
  it("stops at the cap instead of buffering the rest (B5 review I-6)", async () => {
    await expect(readCappedText(stream(["ab", "cde"]), 4)).rejects.toBeInstanceOf(BodyTooLarge);
  });
});
