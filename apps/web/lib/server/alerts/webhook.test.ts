import { describe, expect, it } from "vitest";
import { handleAlertWebhook, type WebhookDeps } from "./webhook.ts";

const SECRET = "s".repeat(40);
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://web:3000/api/alerts/webhook", {
    method: "POST",
    headers: {
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
    record: async (rule) => {
      recorded.push(rule);
      return { id: "11111111-1111-4111-8111-111111111111", workspaceId: "w", created };
    },
    onRecorded: (alert) => void delivered.push(alert.rule),
  };
  return { recorded, delivered, deps: value };
}

describe("POST /api/alerts/webhook (spec §13.2)", () => {
  it("does not exist without a secret", async () => {
    const { deps: d } = deps();
    d.secret = undefined;
    expect((await handleAlertWebhook(d, post('{"rule":"run_failed"}'))).status).toBe(404);
  });

  it("does not exist through Traefik: forwarded requests are 404 before auth (Review Focus 4)", async () => {
    const { deps: d, recorded } = deps();
    for (const header of ["x-forwarded-for", "x-forwarded-host"]) {
      const response = await handleAlertWebhook(
        d,
        post('{"rule":"run_failed"}', { [header]: "203.0.113.9" }),
      );
      expect(response.status).toBe(404);
    }
    expect(recorded).toEqual([]);
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
  });

  it("answers 409 when there is no workspace to hold the alert yet", async () => {
    const d: WebhookDeps = {
      secret: SECRET,
      record: async () => null,
      onRecorded: () => undefined,
    };
    expect((await handleAlertWebhook(d, post('{"rule":"run_failed"}'))).status).toBe(409);
  });
});
