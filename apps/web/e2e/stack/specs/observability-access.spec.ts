import { request as httpRequest } from "node:http";
import {
  ALERT_WEBHOOK_INTERNAL_URL,
  OBSERVABILITY_APP_PATH,
  OBSERVABILITY_AUTH_PATH,
  OBSERVABILITY_SESSION_PATH,
  WEB_INTERNAL_HOST,
  observabilityForwardAuthHost,
  observabilityOrigin,
} from "@mastertutor/contracts";
import { expect, test } from "@playwright/test";
import { BASE_URL } from "../support/env.ts";
import { rpcOk } from "../support/rpc.ts";

/**
 * D50 review C-1 and I-1, I-2 against the real Next server in the stack (not a handler call): Next
 * adds X-Forwarded-* to every request, and only the Host header tells an internal caller (on
 * web:3000 or web's cdp address) from a public one (through Traefik, Host is the app's).
 * compose.test.yml gives web and this runner the same throwaway secrets.
 */
const SECRET = process.env["ALERT_WEBHOOK_SECRET"]!;
const VIEWER_PASSWORD = process.env["OBSERVE_VIEWER_PASSWORD"]!;
const FORWARD_AUTH_HOST = observabilityForwardAuthHost(process.env["CDP_SUBNET_PREFIX"]);
const OBS_HOST = new URL(observabilityOrigin(BASE_URL)).host;

interface Raw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** One HTTP request to `connect` (host:port) carrying exactly the given Host header. */
function raw(
  connect: string,
  path: string,
  options: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Raw> {
  const [hostname, port] = connect.split(":") as [string, string];
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname,
        port: Number(port),
        path,
        method: options.method ?? "GET",
        headers: { host: options.host ?? connect, ...options.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test.describe("internal-only routes on the real server (D50 review)", () => {
  test("OpenObserve's webhook post to web:3000 is stored (C-1)", async ({ request }) => {
    expect(ALERT_WEBHOOK_INTERNAL_URL).toBe(`http://${WEB_INTERNAL_HOST}/api/alerts/webhook`);
    const response = await raw(WEB_INTERNAL_HOST, "/api/alerts/webhook", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: '{"rule":"slot_crash_loop"}',
    });
    expect(response.status).toBe(202);
    const listed = await rpcOk<{ items: Array<{ rule: string }> }>(request, "alerts/list", {
      limit: 10,
    });
    expect(listed.items.map((alert) => alert.rule)).toContain("slot_crash_loop");
  });

  test("the webhook does not exist through Traefik, even with the bearer", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/alerts/webhook`, {
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      data: { rule: "run_failed" },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
  });

  test("ForwardAuth never answers a browser: through Traefik it is 404, even for the owner (I-1)", async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}${OBSERVABILITY_AUTH_PATH}`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
    expect(response.headers()["authorization"]).toBeUndefined();
  });

  test("the owner's hand-off to obs.<app host> ends in ForwardAuth injecting the viewer (I-2)", async ({
    request,
  }) => {
    // Without an obs session, ForwardAuth sends the browser to the app's way in.
    const anonymous = await raw(FORWARD_AUTH_HOST, OBSERVABILITY_AUTH_PATH);
    expect([anonymous.status, anonymous.headers["location"]]).toEqual([
      302,
      `${BASE_URL}${OBSERVABILITY_APP_PATH}`,
    ]);

    const handoff = await request.get(`${BASE_URL}${OBSERVABILITY_APP_PATH}`);
    const html = await handoff.text();
    expect(html).toContain(`action="http://${OBS_HOST}${OBSERVABILITY_SESSION_PATH}"`);
    const ticket = /name="ticket" value="([^"]+)"/.exec(html)![1]!;

    // On the app host the session path does not exist; on the obs host it trades the ticket.
    const wrongHost = await raw(WEB_INTERNAL_HOST, OBSERVABILITY_SESSION_PATH, {
      method: "POST",
      host: new URL(BASE_URL).host,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `ticket=${ticket}`,
    });
    expect(wrongHost.status).toBe(404);
    const session = await raw(WEB_INTERNAL_HOST, OBSERVABILITY_SESSION_PATH, {
      method: "POST",
      host: OBS_HOST,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `ticket=${ticket}`,
    });
    expect(session.status).toBe(200);
    const setCookie = String(session.headers["set-cookie"]);
    expect(setCookie).toMatch(
      /^mt_obs_session=[^;]+; Path=\/; Max-Age=43200; HttpOnly; SameSite=Strict/,
    );
    expect(setCookie).not.toMatch(/domain=/i);
    expect(session.body).toContain('location.replace("/observability/web/")');

    const cookie = setCookie.split(";")[0]!;
    const allowed = await raw(FORWARD_AUTH_HOST, OBSERVABILITY_AUTH_PATH, { headers: { cookie } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["authorization"]).toBe(
      `Basic ${Buffer.from(`viewer@mastertutor.internal:${VIEWER_PASSWORD}`).toString("base64")}`,
    );
    expect(allowed.headers["cookie"]).toBe("mt_obs=1");
  });
});
