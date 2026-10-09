import { describe, expect, it } from "vitest";
import { createO2Client } from "./client.ts";
import { O2_ROLES } from "./o2-api.ts";
import {
  ALERT_DESTINATION_NAME,
  ALERT_TEMPLATE_NAME,
  alertTemplateBody,
  provisionAlertDelivery,
  provisionRoot,
  provisionStreams,
  provisionUsers,
} from "./provision.ts";

const INGEST = "Ingest-password-0123456789abcdefghij";
const VIEWER = "Viewer-password-0123456789abcdefghij";

function fakeO2(existingUsers: string[] = []) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const client = createO2Client({
    baseUrl: "http://o2",
    email: "root",
    password: "pw",
    fetchImpl: async (url, init) => {
      const path = String(url).slice("http://o2".length);
      calls.push({
        method: init!.method!,
        path,
        body: init!.body ? JSON.parse(String(init!.body)) : undefined,
      });
      if (init!.method === "GET" && path === "/api/default/users")
        return Response.json({ data: existingUsers.map((email) => ({ email })) });
      if (init!.method === "POST" && /\/streams\//.test(path))
        return new Response("exists", { status: 400 });
      return Response.json({});
    },
  });
  return { client, calls };
}

describe("provisioning (spec §11)", () => {
  it("creates missing users and updates existing ones' passwords, with the pinned roles", async () => {
    const { client, calls } = fakeO2(["ingest@mastertutor.internal"]);
    await provisionUsers(client, { ingest: INGEST, viewer: VIEWER });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/default/users",
      "PUT /api/default/users/ingest%40mastertutor.internal",
      "POST /api/default/users",
    ]);
    expect(calls[1]!.body).toMatchObject({
      change_password: true,
      new_password: INGEST,
      role: O2_ROLES.ingest,
    });
    expect(calls[2]!.body).toMatchObject({
      email: "viewer@mastertutor.internal",
      password: VIEWER,
      role: O2_ROLES.viewer,
    });
  });

  it("sets 30 d on both log streams and 15 d on traces, creating them when needed", async () => {
    const { client, calls } = fakeO2();
    await provisionStreams(client);
    expect(calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body])).toEqual([
      [
        "/api/default/streams/mastertutor?type=logs",
        { fields: [], settings: { data_retention: 30 } },
      ],
      [
        "/api/default/streams/containers?type=logs",
        { fields: [], settings: { data_retention: 30 } },
      ],
      [
        "/api/default/streams/default?type=traces",
        { fields: [], settings: { data_retention: 15 } },
      ],
    ]);
    const settings = calls.filter((c) => c.path.includes("/settings"));
    expect(settings.map((c) => [c.path, c.body])).toEqual([
      ["/api/default/streams/mastertutor/settings?type=logs", { data_retention: 30 }],
      ["/api/default/streams/containers/settings?type=logs", { data_retention: 30 }],
      ["/api/default/streams/default/settings?type=traces", { data_retention: 15 }],
    ]);
  });

  it("sends only the rule name to web, with the bearer secret in a header", async () => {
    const { client, calls } = fakeO2();
    await provisionAlertDelivery(client, {
      url: "http://web:3000/api/alerts/webhook",
      secret: "s".repeat(40),
    });
    expect(alertTemplateBody()).toBe('{"rule":"{alert_name}"}');
    const template = calls.find((c) => c.path.includes("/templates"))!;
    expect(template.body).toMatchObject({ name: ALERT_TEMPLATE_NAME, body: alertTemplateBody() });
    const destination = calls.find((c) => c.path.includes("/destinations"))!;
    expect(destination.body).toMatchObject({
      name: ALERT_DESTINATION_NAME,
      url: "http://web:3000/api/alerts/webhook",
      method: "post",
      template: ALERT_TEMPLATE_NAME,
      headers: { Authorization: `Bearer ${"s".repeat(40)}` },
    });
  });
});

describe("root password rotation (review I4)", () => {
  const CURRENT = "Current-root-password-0123456789abc";
  const PREVIOUS = "Previous-root-password-0123456789ab";
  const basic = (password: string) =>
    `Basic ${Buffer.from(`root@mastertutor.internal:${password}`).toString("base64")}`;

  function fakeRoot(valid: string) {
    let password = valid;
    const calls: Array<{ method: string; path: string; auth: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const auth = (init!.headers as Record<string, string>).authorization!;
      const path = String(url).slice("http://o2".length);
      calls.push({
        method: init!.method!,
        path,
        auth,
        body: init!.body ? JSON.parse(String(init!.body)) : undefined,
      });
      if (auth !== basic(password)) return new Response("no", { status: 401 });
      if (init!.method === "PUT")
        password = (JSON.parse(String(init!.body)) as { new_password: string }).new_password;
      return Response.json({ data: [] });
    };
    return { calls, fetchImpl, current: () => password };
  }

  it("uses the current password when OpenObserve already has it, changing nothing", async () => {
    const o2 = fakeRoot(CURRENT);
    await provisionRoot({
      baseUrl: "http://o2",
      current: CURRENT,
      previous: PREVIOUS,
      fetchImpl: o2.fetchImpl,
    });
    expect(o2.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("rotates from the previous password, as root, quoting the old one", async () => {
    const o2 = fakeRoot(PREVIOUS);
    await provisionRoot({
      baseUrl: "http://o2",
      current: CURRENT,
      previous: PREVIOUS,
      fetchImpl: o2.fetchImpl,
    });
    const put = o2.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/default/users/root%40mastertutor.internal");
    expect(put.auth).toBe(basic(PREVIOUS));
    expect(put.body).toMatchObject({
      change_password: true,
      old_password: PREVIOUS,
      new_password: CURRENT,
    });
    expect(o2.current()).toBe(CURRENT);
  });

  it("fails loudly, naming keys and never values, when neither password works", async () => {
    for (const previous of [undefined, "Other-root-password-0123456789abcdef"]) {
      const o2 = fakeRoot("Stored-root-password-0123456789abcd");
      const error = await provisionRoot({
        baseUrl: "http://o2",
        current: CURRENT,
        previous,
        fetchImpl: o2.fetchImpl,
      }).catch((e: unknown) => e);
      expect(String(error)).toMatch(/OBSERVE_ROOT_PASSWORD/);
      expect(String(error)).not.toContain(CURRENT);
      if (previous) expect(String(error)).not.toContain(previous);
    }
  });
});

it("provisions and rotates the separate Copilot user with the viewer role", async () => {
  for (const existing of [[], ["copilot@mastertutor.internal"]]) {
    const { client, calls } = fakeO2(existing);
    await provisionUsers(client, { ingest: INGEST, viewer: VIEWER, copilot: "test-only-copilot" });
    const copilot = calls.at(-1)!;
    expect(copilot.method).toBe(existing.length ? "PUT" : "POST");
    expect(copilot.body).toMatchObject(
      existing.length
        ? { new_password: "test-only-copilot", role: O2_ROLES.viewer }
        : {
            email: "copilot@mastertutor.internal",
            password: "test-only-copilot",
            role: O2_ROLES.viewer,
          },
    );
    expect(calls).toHaveLength(4);
  }
});
