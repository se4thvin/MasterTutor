import { ReadPageArgs, ReadPageResult } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { Interrupted, StaleRef } from "../runtime/errors.ts";
import { ToolRegistry } from "./registry.ts";
import { register, type ToolContext } from "./types.ts";

const log = createLogger({ service: "test", level: "silent" });
const ctx = (signal = new AbortController().signal): ToolContext => ({
  runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  workspaceId: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
  session: { page: { url: () => "https://a.com/x" } } as unknown as BrowserSession,
  signal,
  log,
});
const fakeReadPage = (run: () => Promise<ReadPageResult>) =>
  register({ name: "read_page", args: ReadPageArgs, result: ReadPageResult, untrusted: true, run });

describe("ToolRegistry", () => {
  it("wraps untrusted results with the page origin", async () => {
    const registry = new ToolRegistry([fakeReadPage(async () => ({ unchanged: true }))], log);
    const { output } = await registry.run("read_page", { mode: "text", sinceHash: null }, ctx());
    expect(output).toBe(
      '<untrusted_page_content origin="https://a.com">\n{"unchanged":true}\n</untrusted_page_content>',
    );
  });
  it("answers tool_unavailable for tools later phases have not registered", async () => {
    const registry = new ToolRegistry([], log);
    expect((await registry.run("capture", {}, ctx())).output).toBe('{"error":"tool_unavailable"}');
  });
  it("maps failures to codes and lets interruptions through", async () => {
    const stale = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new StaleRef("e3");
        }),
      ],
      log,
    );
    expect((await stale.run("read_page", { mode: "text", sinceHash: null }, ctx())).output).toBe(
      '{"error":"stale_ref"}',
    );
    const broken = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new Error("boom with page text");
        }),
      ],
      log,
    );
    expect((await broken.run("read_page", { mode: "text", sinceHash: null }, ctx())).output).toBe(
      '{"error":"tool_failed"}',
    );
    const aborted = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new Interrupted("takeover");
        }),
      ],
      log,
    );
    await expect(
      aborted.run("read_page", { mode: "text", sinceHash: null }, ctx()),
    ).rejects.toBeInstanceOf(Interrupted);
  });
});
