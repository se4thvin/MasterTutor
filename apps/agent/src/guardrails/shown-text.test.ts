import { describe, expect, it } from "vitest";
import { shownModelText } from "./shown-text.ts";

const redact = (text: string) => text.replaceAll("hunter2", "[secret]");

describe("shownModelText (model text a person sees: captions and reasoning summaries)", () => {
  it("redacts vault secrets after cleaning, so a full-width or zero-width disguise still matches", () => {
    expect(shownModelText("typed ｈｕｎｔｅｒ２ into the box", 300, redact)).toBe(
      "typed [secret] into the box",
    );
    expect(shownModelText("hun​ter2", 300, redact)).toBe("[secret]");
  });

  it("keeps paragraph breaks, drops controls and bidi overrides, collapses runs of space", () => {
    expect(shownModelText("**Plan**\r\n\r\n\r\nOpen  the‮ page.\u0007", 300, redact)).toBe(
      "**Plan**\n\nOpen the page.",
    );
  });

  it("caps after redacting (a cut never shows part of a secret), by code point", () => {
    expect(shownModelText("ab hunter2", 5, redact)).toBe("ab [s");
    expect(shownModelText("😀😀😀", 2, redact)).toBe("😀😀");
  });

  it("is null for nothing to show", () => {
    expect(shownModelText(null, 300, redact)).toBeNull();
    expect(shownModelText(" \n​ ", 300, redact)).toBeNull();
  });
});
