import { describe, expect, it } from "vitest";
import {
  ATTR,
  BASE_ATTRIBUTES,
  DERIVED_METRIC,
  EXPORTABLE_ATTRIBUTES,
  METRIC,
  OBSERVER_ROLES,
  SPEND_PURPOSES,
  SPAN,
  SPANMETRIC_DIMENSIONS,
  SPANMETRICS_NAMESPACE,
} from "./telemetry.ts";

const NAME = /^mt(\.[a-z][a-z0-9_]*)+$/;

describe("product telemetry names (spec §5)", () => {
  it("are mt.-prefixed, lowercase, dotted and unique", () => {
    const names = [
      ...Object.values(SPAN),
      ...Object.values(ATTR),
      ...Object.values(METRIC).map((metric) => metric.name),
      ...Object.values(DERIVED_METRIC),
    ];
    for (const name of names) expect(name, name).toMatch(NAME);
    expect(new Set(Object.values(ATTR)).size).toBe(Object.values(ATTR).length);
    expect(new Set(Object.values(METRIC).map((m) => m.name)).size).toBe(
      Object.values(METRIC).length,
    );
  });

  it("never uses a run id, a URL or a user as a metric dimension", () => {
    const dimensions = [
      ...Object.values(METRIC).flatMap((metric) => metric.dimensions),
      ...SPANMETRIC_DIMENSIONS,
    ];
    expect(dimensions).not.toContain(ATTR.runId);
    expect(dimensions).not.toContain(ATTR.vaultAlias);
    for (const dimension of dimensions)
      expect(Object.values(ATTR) as string[]).toContain(dimension);
  });

  it("exports no URL, header or message attribute", () => {
    for (const key of EXPORTABLE_ATTRIBUTES) {
      expect(key, key).not.toMatch(
        /^url\.(full|path|query)$|^http\.target$|header|message|stack|user/,
      );
    }
    expect(BASE_ATTRIBUTES).toContain("server.address");
    expect(EXPORTABLE_ATTRIBUTES.has(ATTR.runId)).toBe(true);
  });

  it("derives span metrics under one namespace", () => {
    expect(DERIVED_METRIC.spanCalls).toBe(`${SPANMETRICS_NAMESPACE}.calls`);
    expect(DERIVED_METRIC.spanDuration).toBe(`${SPANMETRICS_NAMESPACE}.duration`);
  });
});

describe("Observer names (spec §6.11)", () => {
  it("adds the observer span, attribute and metric names under mt.observer and a spend purpose", () => {
    expect(SPAN.observerReview).toBe("mt.observer.review");
    expect(METRIC.spendUsd.dimensions).toEqual([ATTR.spendPurpose]);
    expect(METRIC.observerVerdicts.dimensions).toEqual([
      ATTR.observerVerdict,
      ATTR.observerCategory,
      ATTR.observerRollout,
    ]);
    for (const dimension of [
      ATTR.observerRole,
      ATTR.observerStage,
      ATTR.observerOutcome,
      ATTR.observerTool,
    ])
      expect(SPANMETRIC_DIMENSIONS).toContain(dimension);
  });
  it("names the roles and charges everything but the Copilot to the run", () => {
    expect(OBSERVER_ROLES).toEqual(["guard", "watcher", "copilot"]);
    expect(SPEND_PURPOSES).toEqual(["run", "copilot"]);
  });
});
