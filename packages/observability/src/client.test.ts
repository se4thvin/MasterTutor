import { describe, expect, it } from "vitest";
import { z } from "zod";
import { O2Error, createO2Client } from "./client.ts";

describe("createO2Client", () => {
  it("honours cancellation before a fetch completes", async () => {
    const abort = new AbortController();
    abort.abort();
    const client = createO2Client({
      baseUrl: "http://o2",
      email: "fake",
      password: "fake",
      fetchImpl: async (_url, init) => {
        init?.signal?.throwIfAborted();
        return new Response("null");
      },
    });
    await expect(
      client.call("search", "POST", "/x", undefined, undefined, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("sends basic auth and JSON, parses with the schema", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const client = createO2Client({
      baseUrl: "http://o2:5080/observability/",
      email: "root@mastertutor.internal",
      password: "pw",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    const body = await client.call(
      "listUsers",
      "GET",
      "/api/default/users",
      undefined,
      z.object({ data: z.array(z.unknown()) }),
    );
    expect(body).toEqual({ data: [] });
    expect(seen[0]!.url).toBe("http://o2:5080/observability/api/default/users");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("root@mastertutor.internal:pw").toString("base64")}`,
    );
  });

  it("throws O2Error with the operation and status, never the body", async () => {
    const client = createO2Client({
      baseUrl: "http://o2",
      email: "e",
      password: "secret-pw",
      fetchImpl: async () => new Response("echo secret-pw", { status: 401 }),
    });
    const error = await client.call("createUser", "POST", "/x", { a: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(O2Error);
    expect(String(error)).toBe("O2Error: OpenObserve createUser failed with HTTP 401");
  });
});
