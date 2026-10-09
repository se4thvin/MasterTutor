import { GarageInitEnv, parseEnv } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { garageBuckets } from "./garage-plan.ts";

const base = {
  GARAGE_ADMIN_URL: "http://garage:3903",
  GARAGE_ADMIN_TOKEN: "t".repeat(40),
  S3_WEB_ACCESS_KEY_ID: `GK${"1".repeat(24)}`,
  S3_WEB_SECRET_ACCESS_KEY: "1".repeat(64),
  S3_AGENT_ACCESS_KEY_ID: `GK${"2".repeat(24)}`,
  S3_AGENT_SECRET_ACCESS_KEY: "2".repeat(64),
};

describe("garageBuckets (spec §11)", () => {
  it("is the app bucket only without observe keys", () => {
    const plan = garageBuckets(parseEnv(GarageInitEnv, base));
    expect(plan.map((p) => [p.bucket, p.keys.map((k) => [k.name, k.read, k.write])])).toEqual([
      [
        "mastertutor",
        [
          ["web", true, false],
          ["agent", true, true],
        ],
      ],
    ]);
  });

  it("gives OpenObserve its own bucket and a key that reaches nothing else", () => {
    const plan = garageBuckets(
      parseEnv(GarageInitEnv, {
        ...base,
        S3_OBSERVE_ACCESS_KEY_ID: `GK${"3".repeat(24)}`,
        S3_OBSERVE_SECRET_ACCESS_KEY: "3".repeat(64),
      }),
    );
    expect(plan[1]!.bucket).toBe("observability");
    expect(plan[1]!.keys.map((k) => [k.name, k.read, k.write])).toEqual([
      ["openobserve", true, true],
    ]);
    expect(plan[0]!.keys.map((k) => k.name)).not.toContain("openobserve");
  });
});
