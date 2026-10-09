import { ALERT_DEDUPE_MINUTES, internalWebHosts, type AlertRule } from "@mastertutor/contracts";
import { alerts, createDb, onlyWorkspaceId, recordAlert, type DbHandle } from "@mastertutor/db";
import { seedMember, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAlertWebhook, type WebhookDeps } from "./webhook.ts";

let database: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
beforeAll(async () => {
  database = await startTestDatabase();
  owner = createDb(database.ownerUrl, { max: 2 });
  web = createDb(database.webUrl, { max: 2 });
  await seedMember(owner.db);
});
afterAll(async () => {
  await Promise.all([owner?.close(), web?.close()]);
  await database?.stop();
});

describe("webhook against the database", () => {
  it("a repeated rule within 10 minutes is one alert and one push (Review Focus 2)", async () => {
    const delivered: string[] = [];
    const deps: WebhookDeps = {
      secret: "s".repeat(40),
      internalHosts: internalWebHosts(),
      record: async (rule: AlertRule) => {
        const workspaceId = (await onlyWorkspaceId(web.db))!;
        const alert = await recordAlert(web.db, {
          workspaceId,
          rule,
          dedupeMinutes: ALERT_DEDUPE_MINUTES,
        });
        return { ...alert, workspaceId };
      },
      onRecorded: (alert) => void delivered.push(alert.id),
    };
    const post = () =>
      new Request("http://web:3000/api/alerts/webhook", {
        method: "POST",
        headers: { host: "web:3000", authorization: `Bearer ${"s".repeat(40)}` },
        body: '{"rule":"run_failed"}',
      });
    const statuses = await Promise.all(
      [1, 2, 3].map(() => handleAlertWebhook(deps, post()).then((r) => r.status)),
    );
    expect(statuses).toEqual([202, 202, 202]);
    expect(await owner.db.select().from(alerts)).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });
});
