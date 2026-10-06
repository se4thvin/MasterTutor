import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "@mastertutor/db";
import type { VaultKeyPair } from "@mastertutor/sealing/open";
import type { SecretFingerprints } from "./fingerprints.ts";
import type { BrowserSession, Log, ResolvedTarget } from "./runtime.ts";

/** Told about every successful sign-in, so the session store knows which alias a page belongs to. */
export interface LoginNotifier {
  noteLogin(runId: string, alias: string, origin: string): void;
}

/** Everything the vault's functions depend on; createVault (Task 13) builds the real one. */
export interface VaultDeps {
  db: Database;
  keys: VaultKeyPair;
  log: Log;
  resolveRef(session: BrowserSession, ref: string): Promise<ResolvedTarget | null>;
  fingerprints: SecretFingerprints;
  logins: LoginNotifier;
  /** IMAP messages whose code was already used, keyed item:uidValidity:uid (Review Focus 5). */
  imapUsed: Set<string>;
  /** How long fill_credential(otp) watches the inbox, polling the code box, before asking the user. */
  otpImapWaitMs: number;
  /** AGENT_TEST_MODE: allows plain-text IMAP to loopback or `greenmail` only; never skips TLS checks. */
  testMode: boolean;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal });
}
