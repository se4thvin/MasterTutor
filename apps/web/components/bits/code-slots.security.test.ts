import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Spec §11.4 #5: CodeSlots must pass this review before merge. */
const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const files = ["./code-slots.tsx", "./code-slots-logic.ts"].map(source).join("\n");
const css = source("../../styles/run.css");

describe("CodeSlots security review", () => {
  it("uses one-time-code autofill and a numeric keypad", () => {
    expect(files).toContain('autoComplete="one-time-code"');
    expect(files).toContain('inputMode="numeric"');
  });

  it("never logs, persists or transmits the code itself", () => {
    for (const banned of [
      "console.",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "fetch(",
      "JSON.stringify",
    ]) {
      expect(files, banned).not.toContain(banned);
    }
  });

  it("keeps the real input empty so the code never sits in the DOM value", () => {
    expect(files).toContain('value=""');
  });

  it("clears its state before handing the code over", () => {
    const body = files.slice(files.indexOf("const commit"));
    expect(body.indexOf("setState({ slots: emptySlots")).toBeLessThan(
      body.indexOf("onComplete(code)"),
    );
  });

  it("seals to dots and fits six boxes at 390px (D22)", () => {
    expect(files).toContain('"•"');
    expect(css).toMatch(
      /\.cslots-row\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--n\), minmax\(0, 3rem\)\)/,
    );
  });
});
