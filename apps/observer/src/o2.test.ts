import { describe, expect, it } from "vitest";
import { COPILOT_LIMITS } from "@mastertutor/contracts";
import type { O2Client } from "@mastertutor/observability/query";
import { createO2Query } from "./o2.ts";

const signal = new AbortController().signal;
const client = (reply: unknown, calls: unknown[][] = []): O2Client => ({
  org: "default",
  async call(...args) {
    calls.push(args);
    return reply as never;
  },
});
describe("bounded OpenObserve query responses", () => {
  it("sets search timeout, stream type, body bounds and passes cancellation", async () => {
    const calls: unknown[][] = [];
    const hits = Array.from({ length: 201 }, (_, i) => ({ body: "x".repeat(4000), n: i }));
    const result = await createO2Query(client({ took: 3, total: 500, hits }, calls)).search(
      "containers",
      'SELECT body FROM "containers"',
      { startUs: 1, endUs: 2 },
      200,
      signal,
    );
    expect(calls[0]?.[2]).toContain("type=logs");
    expect(calls[0]?.[3]).toMatchObject({
      timeout: 10,
      query: { size: 200, from: 0, start_time: 1, end_time: 2 },
    });
    expect(calls[0]?.[5]).toEqual({ signal });
    expect(result.rows).toHaveLength(200);
    expect(String(result.rows[0]?.[0])).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });
  it("keeps matrix rows, columns and cells within ResultView bounds", async () => {
    const metric = "a".repeat(100);
    const reply = {
      status: "success",
      data: {
        resultType: "matrix",
        result: Array.from({ length: 21 }, (_, i) => ({
          metric: { name: metric },
          values: Array.from({ length: 301 }, (_, t) => [t, i === 0 ? "NaN" : "2"]),
        })),
      },
    };
    const result = await createO2Query(client(reply)).range(
      "mt_runs_ended",
      { start: 1, end: 2, step: 1 },
      signal,
    );
    expect(result.rows.length).toBeLessThanOrEqual(COPILOT_LIMITS.storedRows);
    expect(result.columns).toHaveLength(21);
    expect(new Set(result.columns).size).toBe(result.columns.length);
    expect(result.columns.every((column) => column.length <= 64)).toBe(true);
    expect(result.rows[0]?.[1]).toBeNull();
    expect(result.truncated).toBe(true);
  });
  it("rejects unsuccessful or non-matrix range replies", async () => {
    await expect(
      createO2Query(client({ status: "error", data: { resultType: "matrix", result: [] } })).range(
        "x",
        { start: 1, end: 2, step: 1 },
        signal,
      ),
    ).rejects.toThrow();
  });
});
