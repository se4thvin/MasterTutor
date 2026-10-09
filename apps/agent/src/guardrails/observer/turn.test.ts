import { describe, expect, it } from "vitest";
import type { TargetDescription } from "../../browser/page-helpers.ts";
import { actionClassOf, guardItemOf } from "./turn.ts";
import type { SeenItem, TurnFacts } from "./types.ts";

const button: TargetDescription = {
  label: "Delete my account and all of Bobby's notes",
  tag: "button",
  path: "body:0>button:2",
  context: "sha256-digest",
  excerpt: "Bobby's private notes",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
};
const facts: TurnFacts = {
  pageOrigin: "https://b.test",
  allowedOrigins: ["https://a.test"],
  actuatedOrigins: new Set(),
  injectionWindow: false,
  riskLevel: "normal",
  label: () => ({ provenance: "novel", sourceOrigin: null, chars: 12 }),
};
const seen = (over: Partial<SeenItem>): SeenItem => ({
  item: "c1#0",
  callId: "c1",
  index: 0,
  action: { type: "click", x: 1, y: 1, button: "left" },
  tool: null,
  args: null,
  target: button,
  request: null,
  policy: null,
  ...over,
});

describe("guardItemOf (spec §6.2, §6.4)", () => {
  it("reviews a first click off the allowlist and never carries the label, excerpt, path or context", () => {
    const item = guardItemOf(seen({}), facts);
    expect(item?.triggers).toEqual(["first_actuation_off_allowlist"]);
    const json = JSON.stringify(item);
    for (const leak of ["Delete my account", "Bobby", "body:0>button:2", "sha256-digest"])
      expect(json).not.toContain(leak);
  });
  it("skips a scroll and a read_page call", () => {
    expect(
      guardItemOf(
        seen({ action: { type: "scroll", x: 1, y: 1, scroll_x: 0, scroll_y: 100 } }),
        facts,
      ),
    ).toBeNull();
    expect(guardItemOf(seen({ action: null, tool: "read_page", target: null }), facts)).toBeNull();
  });
  it("maps a vault fill to its alias, never a value", () => {
    const item = guardItemOf(
      seen({
        action: null,
        tool: "fill_credential",
        args: { alias: "zybooks", field: "password", ref: "e3" },
        target: null,
      }),
      { ...facts, pageOrigin: "https://a.test" },
    );
    expect(item).toMatchObject({
      actionClass: "vault_fill",
      vault: { alias: "zybooks", firstUse: false },
    });
  });
  it("classifies a submit click as submit", () => {
    expect(actionClassOf(seen({ target: { ...button, isFormSubmit: true } }))).toBe("submit");
  });
});
