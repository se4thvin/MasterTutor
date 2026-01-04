import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer, type HealthServer } from "./health.ts";

let server: HealthServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${server!.port}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("health server", () => {
  it("is ok when every check passes, with details", async () => {
    server = await startHealthServer({
      port: 0,
      host: "127.0.0.1",
      checks: { db: async () => undefined, storage: async () => undefined },
      details: async () => ({ slots: { "browser-1": "idle" } }),
    });
    expect(await get("/healthz")).toEqual({
      status: 200,
      body: {
        status: "ok",
        checks: { db: "ok", storage: "ok" },
        details: { slots: { "browser-1": "idle" } },
      },
    });
  });

  it("fails without leaking error text, and times out slow checks", async () => {
    server = await startHealthServer({
      port: 0,
      host: "127.0.0.1",
      timeoutMs: 50,
      checks: {
        db: async () => {
          throw new Error("password authentication failed for postgres://agent_role:secret@x");
        },
        storage: () => new Promise(() => undefined),
      },
    });
    const { status, body } = await get("/healthz");
    expect(status).toBe(503);
    expect(body).toEqual({ status: "fail", checks: { db: "fail", storage: "fail" } });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("answers 404 elsewhere", async () => {
    server = await startHealthServer({ port: 0, host: "127.0.0.1", checks: {} });
    expect((await get("/")).status).toBe(404);
  });
});
