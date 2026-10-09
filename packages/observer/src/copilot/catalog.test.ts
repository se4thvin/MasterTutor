import { METRIC, o2StreamName } from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";
import { CATALOG_METRICS, semanticCatalog } from "./catalog.ts";

describe("the semantic catalog (spec §7.7)", () => {
  it("names every registry metric exactly, and nothing else", () => {
    expect(CATALOG_METRICS).toEqual(Object.values(METRIC).map((m) => o2StreamName(m.name)));
    for (const name of CATALOG_METRICS) expect(semanticCatalog()).toContain(name);
  });
  it("tells the model where live state comes from and that telemetry lags", () => {
    expect(semanticCatalog()).toMatch(/20–60 s/);
    expect(semanticCatalog()).toMatch(/runs_find/);
  });
  it("is identical across calls (cacheable prefix)", () => {
    expect(semanticCatalog()).toBe(semanticCatalog());
  });
});

it("includes product status vocabulary from contracts", () => {
  expect(semanticCatalog()).toContain("auto_within_allowlist");
  expect(semanticCatalog()).toContain("guard_unavailable");
});
