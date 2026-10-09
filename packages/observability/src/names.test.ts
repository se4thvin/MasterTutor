import { ATTR, DERIVED_METRIC, METRIC } from "@mastertutor/contracts/telemetry";
import { describe, expect, it } from "vitest";
import { o2Label, o2StreamName } from "./names.ts";

describe("OpenObserve names (spec §5.3)", () => {
  it("maps dots to underscores", () => {
    expect(o2StreamName(METRIC.runsEnded.name)).toBe("mt_runs_ended");
    expect(o2StreamName(DERIVED_METRIC.spanDuration)).toBe("mt_span_duration");
    expect(o2Label(ATTR.runStatus)).toBe("mt_run_status");
    expect(o2Label("span.name")).toBe("span_name");
  });
});
