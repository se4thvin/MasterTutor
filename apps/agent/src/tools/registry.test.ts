import {
  FillCredentialArgs,
  FillCredentialResult,
  ReadPageArgs,
  ReadPageResult,
} from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/session.ts";
import { Interrupted, StaleRef } from "../runtime/errors.ts";
import { NO_MASK_SOURCES, SECRET_REDACTION, type MaskSources } from "../browser/masking.ts";
import { StepCollector } from "../loop/step-collector.ts";
import { ToolRegistry } from "./registry.ts";
import { ToolError, register, type CallApproval, type ToolContext } from "./types.ts";

const log = createLogger({ service: "test", level: "silent" });
const ctx = (
  signal = new AbortController().signal,
): Omit<ToolContext, "requestWait" | "requestHandOver"> => ({
  runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  workspaceId: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
  session: { page: { url: () => "https://a.com/x" } } as unknown as BrowserSession,
  signal,
  log,
  approval: null,
  step: new StepCollector(),
  mask: NO_MASK_SOURCES,
  slotName: "browser-1",
});
const readArgs = { mode: "text", sinceHash: null } as const;
const fakeReadPage = (run: () => Promise<ReadPageResult>) =>
  register({ name: "read_page", args: ReadPageArgs, result: ReadPageResult, untrusted: true, run });

describe("ToolRegistry", () => {
  it("returns a ToolError's code and message to the model and marks the run failed (B2 seam)", async () => {
    const registry = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new ToolError("selector_not_found", "No element matches the selector");
        }),
      ],
      log,
    );
    expect(await registry.run("read_page", readArgs, ctx())).toEqual({
      output: '{"error":"selector_not_found","message":"No element matches the selector"}',
      notesChanged: false,
      failed: true,
      wait: null,
      handOver: null,
    });
    expect(() => new ToolError("Bad Code", "x")).toThrow(TypeError);
  });
  it("marks every other error answer failed, and a success not", async () => {
    const ok = new ToolRegistry([fakeReadPage(async () => ({ unchanged: true }))], log);
    expect((await ok.run("read_page", readArgs, ctx())).failed).toBe(false);
    expect((await new ToolRegistry([], log).run("capture", {}, ctx())).failed).toBe(true);
    const stale = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new StaleRef("e1");
        }),
      ],
      log,
    );
    expect((await stale.run("read_page", readArgs, ctx())).failed).toBe(true);
  });
  it("wraps untrusted results with the page origin", async () => {
    const registry = new ToolRegistry([fakeReadPage(async () => ({ unchanged: true }))], log);
    const { output, wait } = await registry.run("read_page", readArgs, ctx());
    expect(output).toBe(
      '<untrusted_page_content origin="https://a.com">\n{"unchanged":true}\n</untrusted_page_content>',
    );
    expect(wait).toBeNull();
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
    expect((await stale.run("read_page", readArgs, ctx())).output).toBe('{"error":"stale_ref"}');
    const broken = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new Error("boom with page text");
        }),
      ],
      log,
    );
    expect((await broken.run("read_page", readArgs, ctx())).output).toBe('{"error":"tool_failed"}');
    const aborted = new ToolRegistry(
      [
        fakeReadPage(async () => {
          throw new Interrupted("takeover");
        }),
      ],
      log,
    );
    await expect(aborted.run("read_page", readArgs, ctx())).rejects.toBeInstanceOf(Interrupted);
  });
  it("hands the call's own approval to the tool and reports an OTP wait it requested (F4, F5)", async () => {
    let seen: CallApproval | null = null;
    const fill = register({
      name: "fill_credential",
      args: FillCredentialArgs,
      result: FillCredentialResult,
      untrusted: false,
      run: async (context) => {
        seen = context.approval;
        context.requestWait("otp");
        return { error: "otp_unavailable" as const };
      },
    });
    const approval: CallApproval = {
      kind: "credential_first_use",
      decidedBy: "user-1",
      label: null,
      decidedAt: null,
    };
    const result = await new ToolRegistry([fill], log).run(
      "fill_credential",
      { alias: "site", field: "otp", target: "e1" },
      { ...ctx(), approval },
    );
    expect(result).toEqual({
      output: '{"error":"otp_unavailable"}',
      notesChanged: false,
      failed: false,
      wait: "otp",
      handOver: null,
    });
    expect(seen).toEqual(approval);
  });

  it("redacts registered secret values from every tool result (M13)", async () => {
    const mask: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text) => text.replaceAll("hunter2-secret", SECRET_REDACTION),
    };
    const registry = new ToolRegistry(
      [
        fakeReadPage(async () => ({
          hash: "a".repeat(64),
          url: "https://a.com/x",
          title: "Your password is hunter2-secret",
          text: "echo: hunter2-secret.",
        })),
      ],
      log,
      mask,
    );
    const { output } = await registry.run("read_page", readArgs, ctx());
    expect(output).not.toContain("hunter2-secret");
    expect(output).toContain(`Your password is ${SECRET_REDACTION}`);
  });
});
