import { describe, expect, it } from "vitest";
import { isObjectKey, objectKeys, safeFilename } from "./keys.ts";

const run = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("safeFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\win.ini", "win.ini"],
    ["..", "download"],
    ["", "download"],
    [".hidden", "hidden"],
    ["résumé (final).pdf", "résumé _final_.pdf"],
    ["a\u0000b.txt", "a_b.txt"],
    ["ｒｅｐｏｒｔ.pdf", "report.pdf"],
  ])("%j becomes %j", (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });
  it("caps names at 200 bytes and keeps the extension", () => {
    const name = safeFilename(`${"x".repeat(300)}.pdf`);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("objectKeys", () => {
  it("builds the spec layout", () => {
    expect(objectKeys.asset(run, "a".repeat(64))).toBe(`assets/${run}/${"a".repeat(64)}`);
    expect(objectKeys.snapshot(run, "page.mhtml")).toBe(`snapshots/${run}/page.mhtml`);
    expect(objectKeys.stepScreenshot(run, 7)).toBe(`runs/${run}/steps/7.png`);
    expect(objectKeys.transcriptImage(run, 7, 2)).toBe(`runs/${run}/transcript/7-2.png`);
    expect(objectKeys.download(run, "../x.pdf")).toBe(`downloads/${run}/x.pdf`);
  });
  it("lowercases an uppercase UUID in the key", () => {
    expect(objectKeys.stepScreenshot(run.toUpperCase(), 1)).toBe(`runs/${run}/steps/1.png`);
  });
  it("refuses malformed ids", () => {
    expect(() => objectKeys.asset("../../", "a".repeat(64))).toThrow(TypeError);
    expect(() => objectKeys.asset(run, "ABC")).toThrow(TypeError);
    expect(() => objectKeys.stepScreenshot(run, -1)).toThrow(TypeError);
  });
  it("validates raw keys", () => {
    expect(isObjectKey(`runs/${run}/steps/1.png`)).toBe(true);
    for (const bad of ["", "/abs", "a//b", "a/../b", "a/./b", "a\nb"]) {
      expect(isObjectKey(bad)).toBe(false);
    }
  });
});
