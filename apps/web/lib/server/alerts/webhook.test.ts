import { internalWebHosts } from "@mastertutor/contracts";
import { METRIC } from "@mastertutor/contracts/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@mastertutor/telemetry/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAlertWebhook, type WebhookDeps } from "./webhook.ts";

const SECRET = "s".repeat(40);
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://web:3000/api/alerts/webhook", {
    method: "POST",
    headers: {
      host: "web:3000",
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...headers,
    },
    body,
  });

function deps({ secret = SECRET as string | undefined, created = true } = {}) {
  const recorded: string[] = [];
  const delivered: string[] = [];
  const value: WebhookDeps = {
    secret,
    internalHosts: internalWebHosts("10.9.8"),
    record: async (rule) => {
      recorded.push(rule);
      return { id: "11111111-1111-4111-8111-111111111111", workspaceId: "w", created };
    },
    onRecorded: (alert) => void delivered.push(alert.rule),
  };
  return { recorded, delivered, deps: value };
}

let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = installTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe("POST /api/alerts/webhook (spec §13.2)", () => {
  it("does not exist without a secret", async () => {
    const { deps: d } = deps();
    d.secret = undefined;
    expect((await handleAlertWebhook(d, post('{"rule":"run_failed"}'))).status).toBe(404);
  });

  it("does not exist except on web's internal authority: public Hosts are 404 before auth (Review Focus 4)", async () => {
    const { deps: d, recorded } = deps();
    for (const host of [
      "notes.example.org",
      "localhost:18080",
      "obs.localhost:18080",
      "172.30.231.11:3000",
    ]) {
      const response = await handleAlertWebhook(d, post('{"rule":"run_failed"}', { host }));
      expect(response.status, host).toBe(404);
    }
    expect(recorded).toEqual([]);
  });

  it("accepts both internal Hosts: web:3000 and web's cdp address", async () => {
    const { deps: d, recorded } = deps();
    for (const host of ["web:3000", "10.9.8.11:3000"])
      expect((await handleAlertWebhook(d, post('{"rule":"run_failed"}', { host }))).status).toBe(
        202,
      );
    expect(recorded).toEqual(["run_failed", "run_failed"]);
  });

  it("accepts the forwarded headers Next itself adds to every request (review C-1)", async () => {
    const { deps: d, recorded } = deps();
    const response = await handleAlertWebhook(
      d,
      post('{"rule":"run_failed"}', {
        "x-forwarded-for": "172.30.0.5",
        "x-forwarded-host": "web:3000",
      }),
    );
    expect(response.status).toBe(202);
    expect(recorded).toEqual(["run_failed"]);
  });

  it("refuses a wrong bearer, a big body and an unknown rule or extra field", async () => {
    const { deps: d, recorded } = deps();
    const status = async (request: Request) => (await handleAlertWebhook(d, request)).status;
    expect(await status(post('{"rule":"run_failed"}', { authorization: "Bearer nope" }))).toBe(401);
    expect(await status(post('{"rule":"run_failed"}', { authorization: SECRET }))).toBe(401);
    expect(await status(post(`{"rule":"run_failed","x":"${"a".repeat(5_000)}"}`))).toBe(413);
    expect(await status(post('{"rule":"rm -rf"}'))).toBe(400);
    expect(await status(post('{"rule":"run_failed","text":"hi"}'))).toBe(400);
    expect(await status(post("not json"))).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("records a valid alert, answers 202, and delivers a new one only", async () => {
    const fresh = deps();
    const response = await handleAlertWebhook(fresh.deps, post('{"rule":"run_failed"}'));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect([fresh.recorded, fresh.delivered]).toEqual([["run_failed"], ["run_failed"]]);
    const repeat = deps({ created: false });
    expect((await handleAlertWebhook(repeat.deps, post('{"rule":"run_failed"}'))).status).toBe(202);
    expect([repeat.recorded, repeat.delivered]).toEqual([["run_failed"], []]);
    // Every accepted delivery is counted, repeats included; refusals are not.
    expect(await telemetry.metric(METRIC.alertsReceived.name)).toEqual([
      { value: 2, attributes: { "mt.alert.rule": "run_failed" } },
    ]);
  });

  it("answers 409 when there is no workspace to hold the alert yet", async () => {
    const d: WebhookDeps = {
      secret: SECRET,
      internalHosts: internalWebHosts("10.9.8"),
      record: async () => null,
      onRecorded: () => undefined,
    };
    expect((await handleAlertWebhook(d, post('{"rule":"run_failed"}'))).status).toBe(409);
  });
});
