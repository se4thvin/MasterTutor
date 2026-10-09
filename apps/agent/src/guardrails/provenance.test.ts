import { wrapUntrusted } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { ProvenanceStore } from "./provenance.ts";

const A = "https://a.test";
const B = "https://b.test";
const PAGE_A = "The quarterly revenue of Contoso rose by forty two percent in the third quarter.";

describe("ProvenanceStore (spec §6.3)", () => {
  it("labels text read on A and typed on B as other_origin from A", () => {
    const store = new ProvenanceStore("Take notes on chapter 4");
    store.ingestToolOutput(wrapUntrusted(A, PAGE_A));
    expect(store.label("Contoso rose by forty two percent", B)).toEqual({
      provenance: "other_origin",
      sourceOrigin: A,
      chars: 33,
    });
  });
  it("prefers same_origin when the text is also on the current page's origin", () => {
    const store = new ProvenanceStore("g");
    store.ingest(A, PAGE_A);
    store.ingest(B, PAGE_A);
    expect(store.label("Contoso rose by forty two percent", B).provenance).toBe("same_origin");
  });
  it("labels goal text as goal, short text as none and unknown text as novel", () => {
    const store = new ProvenanceStore("Summarise two's complement arithmetic for my class notes");
    store.ingest(A, PAGE_A);
    expect(store.label("two's complement arithmetic", B).provenance).toBe("goal");
    expect(store.label("ok", B).provenance).toBe("none");
    expect(store.label("Completely unrelated sentence typed here", B).provenance).toBe("novel");
  });
  it("ignores tool output that is not an untrusted page envelope", () => {
    const store = new ProvenanceStore("g");
    store.ingestToolOutput(JSON.stringify({ ok: true, text: PAGE_A }));
    expect(store.label("Contoso rose by forty two percent", B).provenance).toBe("novel");
  });
});
