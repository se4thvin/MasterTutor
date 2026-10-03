import { describe, expect, it } from "vitest";
import { bootstrapGarage, GarageAdminError, GarageKeyMismatchError } from "./garage-admin.ts";

const TOKEN = "garage-admin-token-for-tests-0123456789";
const KEY = {
  name: "agent",
  accessKeyId: "GK5aa6eb9e4f040236e79864f3",
  secretAccessKey: "0".repeat(64),
  read: true,
  write: true,
};

function fakeGarage(state: {
  layoutVersion: number;
  buckets: string[];
  keys: string[];
  secrets?: Record<string, string>;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const op = url.pathname.replace("/v2/", "");
    calls.push(op);
    if (op !== "/health") {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    switch (op) {
      case "GetClusterStatus":
        return json({ layoutVersion: state.layoutVersion, nodes: [{ id: "node-1", isUp: true }] });
      case "/health":
        return new Response("ok", { status: 200 });
      case "ListBuckets":
        return json(state.buckets.map((alias) => ({ id: `id-${alias}`, globalAliases: [alias] })));
      case "CreateBucket":
        return json({ id: "id-new" });
      case "ListKeys":
        return json(state.keys.map((id) => ({ id, name: "x" })));
      case "GetKeyInfo": {
        const id = url.searchParams.get("id") ?? "";
        expect(url.searchParams.get("showSecretKey")).toBe("true");
        return json({
          accessKeyId: id,
          name: "x",
          secretAccessKey: state.secrets?.[id] ?? KEY.secretAccessKey,
        });
      }
      default:
        return json({});
    }
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("bootstrapGarage", () => {
  it("lays out a fresh cluster, creates the bucket and imports keys", async () => {
    const { calls, fetchImpl } = fakeGarage({ layoutVersion: 0, buckets: [], keys: [] });
    const result = await bootstrapGarage({
      adminUrl: "http://garage:3903",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [KEY],
      fetchImpl,
    });
    expect(result).toEqual({
      bucketId: "id-new",
      layoutVersion: 1,
      createdBucket: true,
      importedKeys: ["agent"],
    });
    expect(calls).toEqual([
      "GetClusterStatus",
      "UpdateClusterLayout",
      "ApplyClusterLayout",
      "/health",
      "ListBuckets",
      "CreateBucket",
      "ListKeys",
      "ImportKey",
      "AllowBucketKey",
      "DenyBucketKey",
    ]);
  });

  it("refuses a rotated secret under an existing key id, without printing either secret (D61)", async () => {
    const stale = "f".repeat(64);
    const { calls, fetchImpl } = fakeGarage({
      layoutVersion: 1,
      buckets: ["mastertutor"],
      keys: [KEY.accessKeyId],
      secrets: { [KEY.accessKeyId]: stale },
    });
    const error = await bootstrapGarage({
      adminUrl: "http://garage:3903",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [KEY],
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarageKeyMismatchError);
    expect((error as Error).message).toContain("agent");
    expect((error as Error).message).not.toContain(stale);
    expect((error as Error).message).not.toContain(KEY.secretAccessKey);
    expect(calls).not.toContain("AllowBucketKey");
  });

  it("changes nothing structural on an initialized cluster", async () => {
    const { calls, fetchImpl } = fakeGarage({
      layoutVersion: 1,
      buckets: ["mastertutor"],
      keys: [KEY.accessKeyId],
    });
    const result = await bootstrapGarage({
      adminUrl: "http://garage:3903/",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [KEY],
      fetchImpl,
    });
    expect(result.createdBucket).toBe(false);
    expect(result.importedKeys).toEqual([]);
    expect(calls).not.toContain("UpdateClusterLayout");
    expect(calls).not.toContain("CreateBucket");
    expect(calls).not.toContain("ImportKey");
  });

  it("reports admin failures without leaking the token", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: "Forbidden" }), { status: 403 })) as typeof fetch;
    const error = await bootstrapGarage({
      adminUrl: "http://garage:3903",
      adminToken: TOKEN,
      bucket: "mastertutor",
      keys: [],
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarageAdminError);
    expect((error as Error).message).toContain("GetClusterStatus");
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
