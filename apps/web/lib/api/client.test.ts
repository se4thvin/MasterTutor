import { RPCHandler } from "@orpc/server/fetch";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRouter } from "../fixtures/router.ts";
import { ids } from "../fixtures/ids.ts";
import { FIXTURE_VIEWER } from "../server/viewer.ts";
import type { Viewer } from "../server/viewer.ts";

const handler = new RPCHandler(fixtureRouter);
let viewer: Viewer | null = FIXTURE_VIEWER;
const replace = vi.fn();

beforeEach(() => {
  vi.resetModules();
  replace.mockReset();
  viewer = FIXTURE_VIEWER;
  vi.stubGlobal("window", {
    location: { origin: "http://app.test", pathname: "/notes/n1", search: "", replace },
  });
  // The real RPC wire: the link's fetch goes straight to the fixture router's handler.
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const { response } = await handler.handle(request, {
      prefix: "/api/rpc",
      context: { ns: "client-test", viewer },
    });
    return response ?? new Response("Not found", { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
  const client = await import("./client.ts");
  const session = await import("../auth/session-end.ts");
  const ended = vi.fn();
  session.onSessionEnd(ended);
  return { ...client, ...session, ended };
}

describe("session expiry is handled once, at the RPC link", () => {
  it("ends the session for a direct write, a query and concurrent calls, exactly once", async () => {
    const { api, orpc, ended } = await load();
    viewer = null;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const results = await Promise.allSettled([
      api.notes.updateBlock({ blockId: ids.block(1), markdown: "x" }),
      api.vault.setSecret({ itemId: ids.vault(1), field: "password", value: "s3cret-value" }),
      qc.fetchQuery(orpc.settings.get.queryOptions({ input: {} })),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fnotes%2Fn1");
    // Secret-bearing writes never enter the mutation cache.
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });

  it("ignores every other error", async () => {
    const { api, ended } = await load();
    await expect(
      api.notes.get({ noteId: "00000000-0000-4000-8000-999999999999" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ended).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
