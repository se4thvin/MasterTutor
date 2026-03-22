import { FUNCTION_TOOLS } from "@mastertutor/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalContext, ToolContext } from "./runtime.ts";
import { vaultTools } from "./tools.ts";

describe("vault tools", () => {
  it("exposes fill_credential and use_passkey with the contract schemas, as trusted output", async () => {
    const card = {
      kind: "credential_first_use",
      alias: "site",
      origin: "https://a.example",
    } as const;
    const actions = {
      fill: vi.fn(async () => ({ ok: true as const })),
      fillApproval: vi.fn(async () => card),
      passkey: vi.fn(async () => ({ error: "no_passkey" as const })),
      passkeyApproval: vi.fn(async () => null),
    };
    const [fill, passkey] = vaultTools(actions);
    expect([fill.name, passkey.name]).toEqual(["fill_credential", "use_passkey"]);
    expect(fill.args).toBe(FUNCTION_TOOLS.fill_credential.args);
    expect(fill.result).toBe(FUNCTION_TOOLS.fill_credential.result);
    expect(passkey.args).toBe(FUNCTION_TOOLS.use_passkey.args);
    expect(passkey.result).toBe(FUNCTION_TOOLS.use_passkey.result);
    expect([fill.untrusted, passkey.untrusted]).toEqual([false, false]);
    const ctx = {} as ToolContext;
    const args = { alias: "site", field: "password", target: "e1" } as const;
    expect(await fill.run(ctx, args)).toEqual({ ok: true });
    expect(actions.fill).toHaveBeenCalledWith(ctx, args);
    // Both tools raise their own approve-phase card (N8: no RunHooks.functionApproval).
    const approvalCtx = {} as ApprovalContext;
    expect(await fill.approval?.(approvalCtx, args)).toEqual(card);
    expect(actions.fillApproval).toHaveBeenCalledWith(approvalCtx, args);
    expect(await passkey.approval?.(approvalCtx, { alias: "site" })).toBeNull();
    expect(actions.passkeyApproval).toHaveBeenCalledWith(approvalCtx, { alias: "site" });
  });
});
