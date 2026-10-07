import { describe, expect, it } from "vitest";
import { assertSelfContained } from "../testing/self-contained.ts";
import { pageExtract } from "./page/extract.ts";
import { pageInstallLib } from "./page/lib.ts";
import { pageLocateBlocks } from "./page/locate.ts";
import {
  pageContentType,
  pageForceEager,
  pageScrollMetrics,
  pageScrollTo,
} from "./page/prepare.ts";
import { captureLibrarySource } from "./worlds.ts";

/** Every function sent to the page as source text; later tasks extend this list. */
const PAGE_FUNCTIONS = [
  pageInstallLib,
  pageForceEager,
  pageScrollMetrics,
  pageScrollTo,
  pageContentType,
  pageExtract,
  pageLocateBlocks,
];

describe("page functions", () => {
  it.each(PAGE_FUNCTIONS)("%o is self-contained after transpilation", (fn) => {
    expect(() => assertSelfContained(fn)).not.toThrow();
  });
  it("rejects functions that reference module scope", () => {
    const helper = () => 1;
    expect(() => assertSelfContained(() => `${import.meta.url}${helper()}`)).toThrow(
      /self-contained/,
    );
  });
});

describe("captureLibrarySource", () => {
  it("bundles Defuddle, Readability and installs our page lib", async () => {
    const source = await captureLibrarySource();
    expect(source).toContain("Defuddle");
    expect(source).toContain("function Readability(");
    expect(source).toContain("__mtLib");
  });
});
