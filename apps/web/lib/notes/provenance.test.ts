import type { NoteBlock, SourceView } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { calloutFor, isRawHtmlTable, provenanceOf, showsVerifyCheck } from "./provenance.ts";

const base: NoteBlock = {
  id: "00000000-0000-4000-8000-000003000001",
  noteId: "00000000-0000-4000-8000-000002000001",
  position: "a0",
  type: "paragraph",
  markdown: "Training a transformer with Adam",
  assetId: null,
  sourceId: "s",
  origin: "dom",
  anchor: {
    selector: "article > p",
    xpath: null,
    start: null,
    end: null,
    textFragment: "Training a transformer",
  },
  contentSha256: "9f2c41e0".padEnd(64, "0"),
  verified: true,
  edited: false,
  originalMarkdown: null,
  createdAt: "2026-10-05T17:09:41.000Z",
};
const source: SourceView = {
  id: "s",
  kind: "web",
  url: "https://fieldnotes.ml/posts/x",
  canonicalUrl: null,
  origin: "https://fieldnotes.ml",
  title: null,
  faviconAssetId: null,
  capturedAt: base.createdAt,
};

describe("provenance", () => {
  it("describes a verified DOM block with a text-fragment link", () => {
    const p = provenanceOf(base, source);
    expect(p).toMatchObject({
      status: "verified",
      originLabel: "Page text",
      selector: "article > p",
      hashShort: "9f2c41e0…",
    });
    expect(p.openUrl).toBe("https://fieldnotes.ml/posts/x#:~:text=Training%20a%20transformer");
    expect(calloutFor(base)).toBeNull();
  });
  it("flags OCR blocks for review", () => {
    const ocr = { ...base, origin: "ocr_model" as const, verified: false, anchor: null };
    expect(provenanceOf(ocr, source).status).toBe("needs_review");
    expect(calloutFor(ocr)?.lead).toBe("Needs review.");
  });
  it("says why a block needs review, by its origin (M12)", () => {
    const review = (origin: NoteBlock["origin"]) =>
      calloutFor({ ...base, origin, verified: false })?.text;
    expect(review("ocr_model")).toBe(
      "Read from an image by the model. Check it against the source.",
    );
    expect(review("asr")).toBe(
      "Transcribed from the audio by the model. Check it against the source.",
    );
    expect(review("dom")).toBe("Not yet matched to the page text. Check it against the source.");
    expect(review("pdf")).toBe("Not yet matched to the PDF's text. Check it against the source.");
    expect(review("captions")).toBe(
      "From the uploader's captions, not yet checked against the audio. Check it against the source.",
    );
    for (const origin of ["dom", "pdf", "captions", "asr"] as const) {
      expect(review(origin), origin).not.toContain("image");
    }
  });
  it("marks edits and agent notes", () => {
    expect(provenanceOf({ ...base, edited: true, originalMarkdown: "x" }, source).status).toBe(
      "edited",
    );
    expect(calloutFor({ ...base, origin: "model", type: "commentary" })?.lead).toBe(
      "Agent's note.",
    );
  });
  it("cites video time and PDF pages", () => {
    const t = {
      ...base,
      origin: "captions" as const,
      anchor: { ...base.anchor!, tStart: 768, tEnd: 774 },
    };
    const video = { ...source, kind: "youtube" as const, url: "https://www.youtube.com/watch?v=x" };
    expect(provenanceOf(t, video)).toMatchObject({ where: "12:48–12:54" });
    expect(provenanceOf(t, video).openUrl).toBe("https://www.youtube.com/watch?v=x&t=768s");
    expect(
      provenanceOf({ ...base, origin: "pdf", anchor: { ...base.anchor!, page: 3 } }, source).where,
    ).toBe("Page 3");
  });
  it("never offers a non-http source URL as an Open on page link", () => {
    const evil = { ...source, url: "javascript:alert(1)" };
    expect(provenanceOf(base, evil).openUrl).toBeNull();
  });
  it("detects raw HTML tables only for table blocks", () => {
    expect(isRawHtmlTable({ ...base, type: "table", markdown: "<table></table>" })).toBe(true);
    expect(isRawHtmlTable({ ...base, markdown: "<table></table>" })).toBe(false);
  });
});

describe("showsVerifyCheck (T21: ocr_model or not yet verified)", () => {
  it.each([
    ["verified page text", { origin: "dom", verified: true }, false],
    ["unverified page text", { origin: "dom", verified: false }, true],
    ["OCR, before verifying", { origin: "ocr_model", verified: false }, true],
    ["OCR, after verifying (stays visible)", { origin: "ocr_model", verified: true }, true],
    ["unverified agent note", { origin: "model", verified: false }, true],
    ["verified agent note", { origin: "model", verified: true }, false],
  ] as const)("%s", (_name, patch, shown) => {
    expect(showsVerifyCheck({ ...base, ...patch })).toBe(shown);
  });
});
