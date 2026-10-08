import { describe, expect, it } from "vitest";
import { ids } from "@/lib/fixtures/ids.ts";
import { parseSource } from "./draft.ts";
import { draftKey } from "./saved-draft-key.ts";
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

  it("also catches tokens in fragments, short parameter names and path segments (best effort)", () => {
    for (const url of [
      "https://app.example.com/callback#access_token=abc&expires_in=3600",
      "https://example.com/doc?t=abc",
      "https://drive.example.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view",
      "https://cdn.example.com/s/3f2504e04f8941d39a0c0305e82c3301aa/r.pdf",
    ])
      expect(mayHoldCredential(url), url).toBe(true);
    for (const url of [
      "https://doc.rust-lang.org/nomicon/lifetimes.html",
      "https://rustify.rs/articles/rust-lifetimes-deep-dive-2026",
      "https://arxiv.org/pdf/1706.03762.pdf",
      "https://example.com/guide#section-2",
    ])
      expect(mayHoldCredential(url), url).toBe(false);
  });

  it("cuts a credential-looking link in the goal back to its origin", () => {
    const stored = serializeDraft({
      ...EMPTY_DRAFT,
      goal: "Notes on https://files.example.com/r.pdf?token=s3cr3t and https://arxiv.org/abs/1706.03762",
    })!;
    expect(stored).not.toContain("s3cr3t");
    expect(parseDraft(stored)?.goal).toBe(
      "Notes on https://files.example.com/… and https://arxiv.org/abs/1706.03762",
    );
  });

  it("keys each viewer's draft separately", () => {
    expect(draftKey("user-a")).not.toBe(draftKey("user-b"));
    expect(draftKey("user-a")).toBe("mt.new-task-draft:user-a");
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
