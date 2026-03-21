import { consumeOtpCode, type VaultItemRecord } from "@mastertutor/db";
import { withOpenedText } from "@mastertutor/sealing/open";
import type { VaultDeps } from "./context.ts";
import { ImapBlocked, waitForImapCode } from "./imap.ts";
import type { ToolContext } from "./runtime.ts";
import { NOT_STORED, withItemSecret } from "./secrets.ts";

export const OTP_LOOKBACK_MS = 5 * 60_000;
const OTP_PATTERN = /^[0-9]{4,8}$/;

/**
 * Spec §9 OTP sources. A code the user typed into CodeSlots always wins, including while the
 * alias's IMAP inbox is being watched (S7). null means the run must wait for the user.
 */
export async function obtainOtp(
  deps: VaultDeps,
  ctx: ToolContext,
  item: VaultItemRecord,
): Promise<{ code: string; source: "code_box" | "imap" } | null> {
  const codeBox = async (): Promise<string | null> => {
    const sealed = await consumeOtpCode(deps.db, ctx.runId);
    if (!sealed) return null;
    const code = await withOpenedText(
      deps.keys,
      sealed,
      { kind: "otp", workspaceId: ctx.workspaceId, runId: ctx.runId },
      async (text) => text,
    );
    return OTP_PATTERN.test(code) ? code : null;
  };
  const typed = await codeBox();
  if (typed) return { code: typed, source: "code_box" };
  const imap = item.imap;
  if (!imap || !item.fields.includes("imap_password")) return null;
  try {
    const found = await withItemSecret(deps, ctx.workspaceId, item, "imap_password", (password) =>
      waitForImapCode({
        config: imap,
        password,
        itemId: item.id,
        notBefore: new Date(deps.now() - OTP_LOOKBACK_MS),
        timeoutMs: deps.otpImapWaitMs,
        signal: ctx.signal,
        used: deps.imapUsed,
        testMode: deps.testMode,
        codeBox,
      }),
    );
    return found === NOT_STORED ? null : found;
  } catch (error) {
    ctx.signal.throwIfAborted();
    // Never log server text: it can echo credentials. The reason code is enough.
    deps.log.warn(
      { alias: item.alias, reason: error instanceof ImapBlocked ? "imap_blocked" : "imap_failed" },
      "otp via IMAP unavailable",
    );
    return null;
  }
}
