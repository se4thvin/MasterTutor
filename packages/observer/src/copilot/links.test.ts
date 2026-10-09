import { describe, expect, it } from "vitest";
import { o2TraceLink, runLink } from "./links.ts";

describe("server-built links (spec §7.5)", () => {
  it("links a run in the app and its traces in OpenObserve on the obs host", () => {
    expect(runLink("6f2c8a3e-0000-4000-8000-00000000000a")).toBe(
      "/runs/6f2c8a3e-0000-4000-8000-00000000000a",
    );
    const link = new URL(
      o2TraceLink("https://mt.example.com", "6f2c8a3e-0000-4000-8000-00000000000a", {
        fromUs: 1,
        toUs: 2,
      }),
    );
    expect(link.origin).toBe("https://obs.mt.example.com");
  });
});

it("uses the spike's pinned trace parameters and refuses malformed ids", () => {
  const url = new URL(
    o2TraceLink("https://mt.example.com", "6f2c8a3e-0000-4000-8000-00000000000a", {
      fromUs: 1,
      toUs: 2,
    }),
  );
  expect(url.searchParams.get("org_identifier")).toBe("default");
  expect(url.searchParams.has("sql_mode")).toBe(false);
  expect(Buffer.from(url.searchParams.get("query")!, "base64").toString()).toBe(
    "mt_run_id = '6f2c8a3e-0000-4000-8000-00000000000a'",
  );
  expect(() => runLink("../settings")).toThrow();
});
