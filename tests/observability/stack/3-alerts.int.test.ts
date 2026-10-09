import { describe, expect, it } from "vitest";
import { compose, enabled, rpc, state, waitFor } from "./stack.ts";

interface PushLine {
  push: true;
  method: string;
  path: string;
  encoding: string;
  ttl: string;
  vapid: boolean;
  bytes: number;
}

describe.runIf(enabled)("alerts reach the app and the phone (spec §13)", () => {
  it("the forced model rejection and run failure each become an in-app alert", async () => {
    const { owner } = state();
    // OpenObserve evaluates every minute over 5 minutes, after the 30 s metric export.
    const rules = await waitFor(async () => {
      const page = await rpc<{ items: Array<{ rule: string }> }>(owner, "alerts/list", {
        limit: 20,
      });
      const seen = new Set(page.items.map((alert) => alert.rule));
      return seen.has("run_failed") && seen.has("model_request_rejected") ? seen : null;
    }, 300_000);
    expect([...rules].sort()).toEqual(["model_request_rejected", "run_failed"]);
  }, 320_000);

  it("each alert is pushed, encrypted and VAPID-signed, to the owner's push service (stub)", async () => {
    const { pushPath } = state();
    const pushes = await waitFor(async () => {
      const lines = compose(["logs", "--no-log-prefix", "push-stub"])
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as PushLine)
        .filter((line) => line.path === pushPath);
      return lines.length >= 2 ? lines : null;
    }, 60_000);
    for (const push of pushes) {
      expect(push).toMatchObject({ method: "POST", encoding: "aes128gcm", vapid: true });
      expect(push.bytes).toBeGreaterThan(0);
    }
  }, 90_000);
});
