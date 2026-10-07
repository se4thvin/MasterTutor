import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

describe("React Bits copies keep their licence (spec §11.4, D43)", () => {
  it("ships the licence text next to the copies", () => {
    expect(readFileSync(new URL("LICENSE-react-bits", dir), "utf8")).toContain("Commons Clause");
  });

  it.each(files)("%s names its source, hash, licence and adaptations", (file) => {
    const head = readFileSync(new URL(file, dir), "utf8").slice(0, 3000);
    expect(head).toMatch(/Adapted from React Bits "[A-Za-z]+" \(TS-TW\)/);
    expect(head).toMatch(/https:\/\/reactbits\.dev\/r\/[A-Za-z]+-TS-TW\.json/);
    expect(head).toMatch(/sha256[: ]+[0-9a-f]{64}/);
    expect(head).toContain("LICENSE-react-bits");
    expect(head).toContain("Adaptations:");
  });
});
