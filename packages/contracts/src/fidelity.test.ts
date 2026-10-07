import { describe, expect, it } from "vitest";
import { CAPTURED_ORIGINS, noteFidelity, VERIFIED_COVERAGE } from "./fidelity.ts";

const clean = { coverage: 1, unverifiedCaptured: 0, missingMedia: 0 };

describe("noteFidelity (the one fidelity rule)", () => {
  it("needs review for any unverified captured block, whatever its origin", () => {
    expect(noteFidelity({ ...clean, unverifiedCaptured: 1 })).toBe("needs_review");
    expect(CAPTURED_ORIGINS).toEqual(["dom", "pdf", "captions", "asr", "ocr_model"]);
  });
  it("is partial for lost media or coverage below the threshold", () => {
    expect(noteFidelity({ ...clean, missingMedia: 1 })).toBe("partial");
    expect(noteFidelity({ ...clean, coverage: VERIFIED_COVERAGE - 0.001 })).toBe("partial");
  });
  it("is verified at the threshold and when coverage is unknown", () => {
    expect(noteFidelity({ ...clean, coverage: VERIFIED_COVERAGE })).toBe("verified");
    expect(noteFidelity({ ...clean, coverage: null })).toBe("verified");
  });
});
