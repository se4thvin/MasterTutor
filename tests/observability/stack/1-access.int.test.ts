import { OBSERVABILITY_APP_PATH, OBSERVABILITY_AUTH_PATH } from "@mastertutor/contracts";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APP,
  OBS,
  compose,
  enabled,
  obsEnv,
  obsSession,
  publishedPort,
  request,
  saveState,
  signUp,
  state,
} from "./stack.ts";

beforeAll(async () => {
  if (!enabled) return;
  // The first account owns the workspace (D4); the second joins as a member (AUTH_SIGNUP_OPEN=1).
  const owner = await signUp("owner@example.test");
  const member = await signUp("member@example.test");
  saveState({ owner, member, obs: await obsSession(owner) });
}, 60_000);

describe.runIf(enabled)("obs.<host> is owner-only (spec §12, Review Focus 4)", () => {
  it("admits the owner's obs session to OpenObserve's API, and sends / to its UI", async () => {
    const streams = await request(OBS, "/observability/api/default/streams?type=logs", {
      cookie: state().obs,
    });
    expect(streams.status).toBe(200);
    expect(JSON.parse(streams.body)).toHaveProperty("list");
    const root = await request(OBS, "/");
    expect(root.status).toBeGreaterThanOrEqual(300);
    expect(root.headers["location"]).toBe(`${OBS}/observability/web/`);
  });

  it("sends a signed-out visitor (or a forged session) to the app's way in, never to OpenObserve", async () => {
    for (const cookie of [undefined, "mt_obs_session=forged.token.value"]) {
      const reply = await request(OBS, "/observability/api/default/streams", { cookie });
      expect(reply.status, cookie ?? "none").toBe(302);
      expect(reply.headers["location"]).toBe(`${APP}${OBSERVABILITY_APP_PATH}`);
      expect(reply.body).not.toContain('"list"');
    }
    const app = await request(APP, OBSERVABILITY_APP_PATH);
    expect(app.status).toBe(302);
    expect(app.headers["location"]).toMatch(/^\/sign-in\?next=/);
  });

  it("refuses a member: no hand-off ticket, and the app session means nothing on the obs host", async () => {
    const { member } = state();
    const handoff = await request(APP, OBSERVABILITY_APP_PATH, { cookie: member });
    expect(handoff.status).toBe(403);
    expect(handoff.body).not.toContain("ticket");
    const direct = await request(OBS, "/observability/api/default/streams", { cookie: member });
    expect(direct.status).toBe(302);
  });

  it("answers no public Host: ForwardAuth, the alert webhook and OpenObserve's paths on the app host", async () => {
    const { owner } = state();
    const auth = await request(APP, OBSERVABILITY_AUTH_PATH, { cookie: owner });
    expect(auth.status).toBe(404);
    expect(auth.headers["authorization"]).toBeUndefined();
    const webhook = await request(APP, "/api/alerts/webhook", {
      method: "POST",
      headers: {
        authorization: `Bearer ${obsEnv("ALERT_WEBHOOK_SECRET")}`,
        "content-type": "application/json",
      },
      body: '{"rule":"run_failed"}',
    });
    expect(webhook.status).toBe(404);
    const onAppHost = await request(APP, "/observability/api/default/streams", { cookie: owner });
    expect(onAppHost.body).not.toContain('"list"');
  });

  it("lands the owner in OpenObserve's UI, without its login form, on the provisioned dashboards", () => {
    const script = fileURLToPath(new URL("./ui-check.mjs", import.meta.url));
    const out = compose([
      "--profile",
      "e2e-runner",
      "run",
      "--rm",
      "--no-deps",
      "-v",
      `${script}:/repo/apps/web/obs-ui-check.mjs:ro`,
      "-e",
      `APP=${APP}`,
      "-e",
      `OBS=${OBS}`,
      "-e",
      `OWNER_COOKIE=${state().owner}`,
      "e2e",
      "node",
      "/repo/apps/web/obs-ui-check.mjs",
    ]);
    expect(out).toMatch(/UI OK https:\/\/obs\.localhost:\d+\/observability\/web\/dashboards/);
  }, 120_000);

  it("publishes no OpenObserve port, and the collector's fluent port on loopback only", () => {
    expect(publishedPort("openobserve", 5080)).toBe("");
    expect(publishedPort("otel-collector", 24224)).toMatch(/^127\.0\.0\.1:\d+$/);
  });
});
