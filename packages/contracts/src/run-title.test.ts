import { describe, expect, it } from "vitest";
import {
  RUN_TITLE_MAX,
  TOKEN_LIKE,
  fallbackRunTitle,
  hostOf,
  linkHosts,
  redactForTitle,
} from "./run-title.ts";

describe("run titles", () => {
  it("falls back to the goal's first line with links shortened to their host", () => {
    expect(fallbackRunTitle("https://learn.zybooks.com/zybook/UTD2310/chapter/4/section/4")).toBe(
      "learn.zybooks.com",
    );
    expect(fallbackRunTitle("\n\nNotes on https://www.example.com/a?b=c please\nSecond line")).toBe(
      "Notes on example.com please",
    );
  });

  it("cuts a long first line at a word boundary, within the title limit", () => {
    const title = fallbackRunTitle(
      "Week 2 of the course: every lecture, figure and table. Skip the quizzes.",
    );
    expect(title).toBe("Week 2 of the course: every lecture, figure and table…");
    expect(Array.from(title).length).toBeLessThanOrEqual(RUN_TITLE_MAX);
    // One long word has no boundary to cut at: it is cut by code point.
    const word = fallbackRunTitle("x".repeat(200));
    expect(Array.from(word)).toHaveLength(RUN_TITLE_MAX);
    expect(word.endsWith("…")).toBe(true);
  });

  it("cleans the fallback like any untrusted text and never returns an empty title", () => {
    expect(fallbackRunTitle("Evil\u202Egoal\u200B\u0007here")).toBe("Evilgoal here");
    expect(fallbackRunTitle("  \n \t")).toBe("Untitled run");
  });

  it("redacts what a title never needs: link paths, emails, labelled secrets and tokens", () => {
    const redacted = redactForTitle(
      "Sign in as me@uni.edu (password: Kestrel#9!) at https://lms.uni.edu/x?token=abc then use " +
        "sk_LiveAbCdEf0123456789xyz and PIN=4321 for 0123456789abcdef0123456789abcdef.",
    );
    expect(redacted).toBe("Sign in as … (password: … at lms.uni.edu then use … and PIN=… for ….");
    for (const secret of [
      "me@uni.edu",
      "Kestrel",
      "token=abc",
      "sk_Live",
      "4321",
      "0123456789abcdef",
    ])
      expect(redacted).not.toContain(secret);
  });

  it("keeps ordinary words that only look secret-adjacent", () => {
    const text = "The key idea of two's complement: section 4.4, code examples";
    expect(redactForTitle(text)).toBe(text);
    expect(TOKEN_LIKE.test("TwosComplement")).toBe(false);
  });

  it("lists link hosts once each and ignores non-web links", () => {
    expect(
      linkHosts("a https://www.a.com/x b http://b.org c https://a.com/y ftp://c.net d"),
    ).toEqual(["a.com", "b.org"]);
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });
});
