import { describe, expect, it } from "vitest";
import { triggersFor, type TriggerFacts } from "./triggers.ts";

const base: TriggerFacts = {
  risky: false,
  actionClass: "click",
  provenance: null,
  pageOrigin: "https://a.test",
  allowedOrigins: ["https://a.test"],
  firstActuationHere: false,
  injectionWindow: false,
  riskLevel: "normal",
};

describe("trigger set (spec §6.2)", () => {
  it("skips a plain click on an allowed origin", () => {
    expect(triggersFor(base)).toEqual([]);
  });
  it("reviews every risky item", () => {
    expect(triggersFor({ ...base, risky: true })).toEqual(["risky_item"]);
  });
  it("reviews every vault fill and passkey use", () => {
    expect(triggersFor({ ...base, actionClass: "vault_fill" })).toContain("vault_fill");
    expect(triggersFor({ ...base, actionClass: "passkey" })).toContain("vault_fill");
  });
  it("reviews typing of text read on another origin, even inside the allowlist", () => {
    expect(triggersFor({ ...base, actionClass: "type", provenance: "other_origin" })).toEqual([
      "data_egress",
    ]);
    expect(triggersFor({ ...base, actionClass: "type", provenance: "same_origin" })).toEqual([]);
  });
  it("reviews the first actuation off the allowlist, not a scroll", () => {
    const off = { ...base, pageOrigin: "https://b.test", firstActuationHere: true };
    expect(triggersFor(off)).toEqual(["first_actuation_off_allowlist"]);
    expect(triggersFor({ ...off, actionClass: "other" })).toEqual([]);
  });
  it("reviews every actuation in the post-injection window and while risk is elevated", () => {
    expect(triggersFor({ ...base, injectionWindow: true })).toEqual(["post_injection_window"]);
    expect(triggersFor({ ...base, riskLevel: "elevated" })).toEqual(["elevated_risk"]);
  });
});
