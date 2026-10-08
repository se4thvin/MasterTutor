import { describe, expect, it } from "vitest";
import { deliverAlert } from "./deliver.ts";

const keys = { publicKey: "k", privateKey: "p", subject: "https://notes.example.org" };
const ALERT = { id: "11111111-1111-4111-8111-111111111111", rule: "run_failed" as const };
const t = (n: number) => ({ endpoint: `https://web.push.apple.com/${n}`, p256dh: "x", auth: "y" });

describe("deliverAlert (spec §13.4)", () => {
  it("a 410 deletes that subscription and the others still get it (Review Focus 3)", async () => {
    const sends: string[] = [];
    const forgotten: string[] = [];
    const outcomes = await deliverAlert(
      {
        vapid: keys,
        targets: async () => [t(1), t(2)],
        forget: async (endpoint) => void forgotten.push(endpoint),
        send: async (target, payload) => {
          sends.push(`${target.endpoint} ${JSON.stringify(payload)}`);
          return target.endpoint.endsWith("/1") ? "gone" : "sent";
        },
      },
      ALERT,
    );
    expect(outcomes).toEqual(["gone", "sent"]);
    expect(forgotten).toEqual([t(1).endpoint]);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toContain(
      '{"title":"MasterTutor","body":"A run failed","url":"/settings/alerts#alert-11111111-1111-4111-8111-111111111111"}',
    );
  });

  it("sends nothing without VAPID keys or HTTPS (in-app only)", async () => {
    let asked = false;
    const outcomes = await deliverAlert(
      {
        vapid: null,
        targets: async () => ((asked = true), [t(1)]),
        forget: async () => undefined,
        send: async () => "sent",
      },
      ALERT,
    );
    expect([outcomes, asked]).toEqual([[], false]);
  });

  it("never rejects: a failing lookup or forget is swallowed", async () => {
    await expect(
      deliverAlert(
        {
          vapid: keys,
          targets: async () => {
            throw new Error("db down");
          },
          forget: async () => undefined,
        },
        ALERT,
      ),
    ).resolves.toEqual([]);
    await expect(
      deliverAlert(
        {
          vapid: keys,
          targets: async () => [t(1)],
          forget: async () => {
            throw new Error("db down");
          },
          send: async () => "gone",
        },
        ALERT,
      ),
    ).resolves.toEqual(["gone"]);
  });
});
