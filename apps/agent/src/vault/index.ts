import { listVaultItemRecords, type Database } from "@mastertutor/db";
import type { VaultKeyPair } from "@mastertutor/sealing/open";
import { defaultSleep, type VaultDeps } from "./context.ts";
import { fillApproval, fillCredential, forgetFillState } from "./fill.ts";
import { createSecretFingerprints } from "./fingerprints.ts";
import { createPasskeys, type PasskeyEnrolment } from "./passkeys.ts";
import {
  register,
  resolveVaultTarget,
  type Log,
  type MaskSources,
  type RegisteredTool,
  type RunHooks,
} from "./runtime.ts";
import { createVaultSessionStore, type VaultSessionStore } from "./sessions.ts";
import { vaultTools } from "./tools.ts";

/** How long fill_credential(otp) watches the inbox (polling the code box) before asking the user (S7). */
export const OTP_IMAP_WAIT_MS = 20_000;

export interface VaultOptions {
  db: Database;
  keys: VaultKeyPair;
  log: Log;
  testMode: boolean;
  resolveRef?: VaultDeps["resolveRef"];
}

/** Spec §3.3 `vault`: the only holder of the private key; everything else sees aliases. */
export interface Vault {
  /** fill_credential and use_passkey, each with its own approve-phase card. */
  readonly tools: readonly RegisteredTool[];
  promptContext(
    run: { workspaceId: string; allowedOrigins: readonly string[] },
    currentOrigin?: string | null,
  ): Promise<string[]>;
  /** A saved sign-in (vault item) exists for this allowed origin. */
  hasSignIn(
    run: { workspaceId: string; allowedOrigins: readonly string[] },
    origin: string,
  ): Promise<boolean>;
  maskSources(runId: string): MaskSources;
  readonly sessions: VaultSessionStore;
  /** For B6's control lock (downstream seam). */
  readonly enrolment: PasskeyEnrolment;
  forgetRun(runId: string): Promise<void>;
}

export function createVault(options: VaultOptions): Vault {
  const fingerprints = createSecretFingerprints();
  const sessions = createVaultSessionStore(options);
  const deps: VaultDeps = {
    db: options.db,
    keys: options.keys,
    log: options.log,
    testMode: options.testMode,
    fingerprints,
    logins: sessions,
    imapUsed: new Map(),
    signInStarted: new Map(),
    totpSteps: new Map(),
    otpImapWaitMs: OTP_IMAP_WAIT_MS,
    now: () => Date.now(),
    sleep: defaultSleep,
    resolveRef: options.resolveRef ?? resolveVaultTarget,
  };
  const passkeys = createPasskeys(deps);
  const [fill, passkey] = vaultTools({
    fill: (ctx, args) => fillCredential(deps, ctx, args),
    fillApproval: (ctx, args) => fillApproval(deps, ctx, args),
    passkey: (ctx, args) => passkeys.use(ctx, args),
    passkeyApproval: (ctx, args) => passkeys.approval(ctx, args),
  });
  // A step's snapshot is immutable. Reuse its one metadata query across promptContext/hasSignIn.
  // Weak keys expire with the snapshot; a later step sees vault additions/removals too.
  const metadata = new WeakMap<object, ReturnType<typeof listVaultItemRecords>>();
  const itemsFor = (run: { workspaceId: string }) => {
    let items = metadata.get(run);
    if (!items) {
      items = listVaultItemRecords(options.db, run.workspaceId);
      metadata.set(run, items);
    }
    return items;
  };
  return {
    tools: [register(fill), register(passkey)],
    async hasSignIn(run, origin) {
      return (
        run.allowedOrigins.includes(origin) &&
        (await itemsFor(run)).some((item) => item.origin === origin)
      );
    },
    async promptContext(run, currentOrigin) {
      const items = (await itemsFor(run))
        .filter((item) => run.allowedOrigins.includes(item.origin) || item.origin === currentOrigin)
        .sort((a, b) => a.alias.localeCompare(b.alias));
      if (items.length === 0) return [];
      // Aliases, origins and field names only (D38 rule 3): never labels, usernames or values.
      const lines = items.map((item) => {
        const fields = item.fields.filter((field) => field !== "imap_password");
        return `- ${item.alias} (${item.origin}): ${[...fields, "otp"].join(", ")}`;
      });
      return [
        // Profile-neutral (P10a-8): which target to pass is in the profile's own instructions, so a
        // computer_use run is never pointed at read_page, a tool it does not have (QA-068).
        `Saved sign-ins for this task. To sign in, call fill_credential with the alias, the field and the target your instructions describe (use_passkey for a passkey). You never see the values; "otp" is a code from email or from the user.\n${lines.join("\n")}`,
      ];
    },
    maskSources: (runId) => fingerprints.forRun(runId),
    sessions,
    enrolment: passkeys.enrolment,
    async forgetRun(runId) {
      await passkeys.disarm(runId);
      fingerprints.forgetRun(runId);
      sessions.forgetRun(runId);
      forgetFillState(deps, runId, deps.now());
    },
  };
}

/** The vault as B1 run hooks (F3): passed to `new Supervisor({ hooks })`. */
export function vaultHooks(vault: Vault): Partial<RunHooks> {
  return {
    functionTools: vault.tools,
    maskSources: (runId) => vault.maskSources(runId),
    sessionStore: vault.sessions,
    promptContext: (run, origin) => vault.promptContext(run, origin),
    hasSignIn: (run, origin) => vault.hasSignIn(run, origin),
    onClick: (run, click) => vault.sessions.onClick(run, click),
    onReleased: (runId) => vault.forgetRun(runId),
  };
}
