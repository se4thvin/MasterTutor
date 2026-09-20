import { describe, expect, it } from "vitest";
import { ids } from "@/lib/fixtures/ids.ts";
import { parseSource } from "./draft.ts";
import { EMPTY_DRAFT, mayHoldCredential, parseDraft, serializeDraft } from "./saved-draft.ts";

const pdf = parseSource("https://arxiv.org/pdf/1706.03762.pdf")!;

describe("saved New task draft", () => {
  it("round-trips the goal, sources, domains, budget and folder", () => {
    const draft = {
      goal: "Week 3: every lecture",
      sources: [pdf],
      domains: ["https://github.com"],
      budget: "deep" as const,
      folderId: ids.folder(2),
    };
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("stores nothing for an untouched draft", () => {
    expect(serializeDraft(EMPTY_DRAFT)).toBeNull();
    expect(serializeDraft({ ...EMPTY_DRAFT, goal: "   " })).toBeNull();
  });

  it("never stores the approval mode or the bypass acknowledgement (S10, D44)", () => {
    const stored = serializeDraft({
      ...EMPTY_DRAFT,
      goal: "x",
      ...({ approvalMode: "bypass", bypassAcknowledged: true } as object),
    })!;
    expect(stored).not.toMatch(/approval|bypass/i);
  });

  it("never stores a source URL that looks like it carries a credential", () => {
    for (const url of [
      "https://files.example.com/r.pdf?X-Amz-Signature=abc",
      "https://example.com/doc?token=abc",
      "https://example.com/doc?api_key=abc",
    ]) {
      expect(mayHoldCredential(url)).toBe(true);
      const stored = serializeDraft({ ...EMPTY_DRAFT, sources: [parseSource(url)!] });
      expect(stored).toBeNull();
    }
    expect(mayHoldCredential("https://www.youtube.com/watch?v=k3Wm9xTq2aE")).toBe(false);
  });

  it("drops malformed or tampered storage instead of trusting it", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, goal: "x" }))).toBeNull();
    expect(
      parseDraft(
        JSON.stringify({
          v: 1,
          goal: "x",
          sources: ["javascript:alert(1)", "https://example.com/a?session=1", pdf.url],
          domains: ["file:///etc", "example.org"],
          budget: "standard",
          folderId: null,
        }),
      ),
    ).toEqual({
      goal: "x",
      sources: [pdf],
      domains: ["https://example.org"],
      budget: "standard",
      folderId: null,
    });
    expect(
      parseDraft(
        JSON.stringify({ ...EMPTY_DRAFT, v: 1, goal: "x", budget: "infinite", sources: [] }),
      ),
    ).toBeNull();
  });
});
