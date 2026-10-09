import { ATTR, DERIVED_METRIC, METRIC } from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";
import { o2Label, o2StreamName } from "../names.ts";
import { O2_EMPTY_PANEL_FILTER } from "../o2-api.ts";
import { toO2Dashboard } from "./build.ts";
import { DASHBOARDS } from "./catalog.ts";

const knownStreams = new Set<string>([
  ...Object.values(METRIC).map((m) => o2StreamName(m.name)),
  ...Object.values(DERIVED_METRIC).flatMap((name) => [
    o2StreamName(name),
    `${o2StreamName(name)}_bucket`,
  ]),
]);
const knownLabels = new Set<string>([
  ...Object.values(ATTR).map(o2Label),
  "span_name",
  "status_code",
  "service_name",
  "le",
]);

describe("dashboards as code (spec §8, §11)", () => {
  it("has the six dashboards the spec names", () => {
    expect(DASHBOARDS.map((d) => d.title)).toEqual([
      "MasterTutor · System health",
      "MasterTutor · Runs and agent",
      "MasterTutor · Model and spend",
      "MasterTutor · Capture fidelity",
      "MasterTutor · Slots and live view",
      "MasterTutor · Errors",
    ]);
  });

  it("references only registered metrics and labels", () => {
    for (const dashboard of DASHBOARDS)
      for (const panel of dashboard.panels) {
        if (panel.query.type !== "promql") continue;
        for (const [token] of panel.query.expr.matchAll(/\bmt_[a-z_]+/g)) {
          const stream = knownStreams.has(token);
          const label = knownLabels.has(token);
          expect(stream || label, `${dashboard.title} / ${panel.title}: ${token}`).toBe(true);
        }
      }
  });

  it("never queries a run id, an alias or a user", () => {
    const text = JSON.stringify(DASHBOARDS.map(toO2Dashboard));
    expect(text).not.toContain(o2Label(ATTR.runId));
    expect(text).not.toContain(o2Label(ATTR.vaultAlias));
  });

  it("builds an OpenObserve dashboard with one tab and laid-out panels", () => {
    const built = toO2Dashboard(DASHBOARDS[1]!) as {
      title: string;
      tabs: Array<{ panels: Array<{ queries: Array<{ fields: { filter: unknown } }> }> }>;
    };
    expect(built.title).toBe("MasterTutor · Runs and agent");
    expect(built.tabs[0]!.panels.length).toBe(DASHBOARDS[1]!.panels.length);
    expect(built.tabs[0]!.panels[0]!.queries[0]!.fields.filter).toEqual(O2_EMPTY_PANEL_FILTER);
  });
});
