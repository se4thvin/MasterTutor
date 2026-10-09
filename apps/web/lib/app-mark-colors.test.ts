import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_MARK_COLORS } from "./app-mark-colors.ts";

const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const lightToken = (name: string) =>
  new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(tokens)?.[1];

describe("app mark colours", () => {
  it("mirror the light tokens (images and the manifest render without our CSS)", () => {
    expect(APP_MARK_COLORS).toEqual({ tile: lightToken("label"), glyph: lightToken("bg") });
  });
});
