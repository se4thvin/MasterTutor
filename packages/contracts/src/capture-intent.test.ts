import { expect, it } from "vitest";
import { CaptureBrief, CaptureSelection } from "./capture-intent.ts";
import { siteKey } from "./server/site.ts";

it("validates disjoint bounded scope and forbids selector prose", () => {
  expect(
    CaptureBrief.safeParse({ keep: ["reading_text"], skip: ["reading_text"], scopeNote: "" })
      .success,
  ).toBe(false);
  expect(CaptureBrief.safeParse({ keep: ["invented"], skip: [], scopeNote: "" }).success).toBe(
    false,
  );
  expect(CaptureBrief.safeParse({ keep: [], skip: [], scopeNote: "x".repeat(501) }).success).toBe(
    false,
  );
  expect(CaptureSelection.safeParse({ ids: ["b0"], text: "rewritten" }).success).toBe(false);
});
it("shares subdomains but separates private PSL tenants and exact hosts", () => {
  expect(siteKey("https://learn.example.co.uk")).toBe("example.co.uk");
  expect(siteKey("https://a.github.io")).not.toBe(siteKey("https://b.github.io"));
  expect(siteKey("https://93.184.216.34")).toBe("93.184.216.34");
});
