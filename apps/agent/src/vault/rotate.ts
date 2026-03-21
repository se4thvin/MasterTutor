import type { VaultSecretField } from "@mastertutor/contracts";
import { SealError, sealValue, wipe, type SealBinding } from "@mastertutor/sealing";
import { openSealed, vaultKeyPairFromPrivate, type VaultKeyPair } from "@mastertutor/sealing/open";
import type { Sql } from "postgres";

export interface RotationReport {
  secrets: number;
  sessions: number;
  otpCodes: number;
  alreadyRotated: number;
  deadOtpCodes: number;
}

/** Names the row that neither key opens; carries no key or plaintext. */
export class RotationError extends Error {
  constructor(table: string, id: string) {
    super(`vault:rotate: ${table} row ${id} opens with neither key; nothing was changed`);
    this.name = "RotationError";
  }
}

/** null when `to` already opens the box; otherwise the box re-sealed for `to`. */
async function reseal(
  sealed: Uint8Array,
  binding: SealBinding,
  from: VaultKeyPair,
  to: VaultKeyPair,
): Promise<Uint8Array | null> {
  try {
    await wipe(await openSealed(to, sealed, binding));
    return null;
  } catch (error) {
    if (!(error instanceof SealError && error.code === "cannot_open")) throw error;
  }
  const value = await openSealed(from, sealed, binding);
  try {
    return await sealValue(to.publicKey, binding, value);
  } finally {
    await wipe(value);
  }
}

/**
 * Spec §9 key rotation: one transaction re-seals vault_secrets, browser_sessions and live
 * otp_codes. Writers block on the table lock; re-running after the redeploy is safe.
 */
export async function rotateVaultKeys(
  sql: Sql,
  from: VaultKeyPair,
  to: VaultKeyPair,
): Promise<RotationReport> {
  return sql.begin(async (tx) => {
    await tx`lock table vault_secrets, browser_sessions, otp_codes in exclusive mode`;
    const report: RotationReport = {
      secrets: 0,
      sessions: 0,
      otpCodes: 0,
      alreadyRotated: 0,
      deadOtpCodes: 0,
    };
    const attempt = async (table: string, id: string, sealed: Uint8Array, binding: SealBinding) => {
      try {
        return await reseal(sealed, binding, from, to);
      } catch (error) {
        if (error instanceof SealError && error.code === "cannot_open")
          throw new RotationError(table, id);
        throw error;
      }
    };

    const secrets = await tx<
      {
        id: string;
        sealed: Buffer;
        field: VaultSecretField;
        workspace_id: string;
        alias: string;
        origin: string;
      }[]
    >`select s.id, s.sealed, s.field, i.workspace_id, i.alias, i.origin
      from vault_secrets s join vault_items i on i.id = s.item_id`;
    for (const row of secrets) {
      const next = await attempt("vault_secrets", row.id, row.sealed, {
        kind: "secret",
        workspaceId: row.workspace_id,
        alias: row.alias,
        origin: row.origin,
        field: row.field,
      });
      if (next === null) report.alreadyRotated++;
      else {
        await tx`update vault_secrets set sealed = ${Buffer.from(next)}, updated_at = now() where id = ${row.id}`;
        report.secrets++;
      }
    }

    const sessions = await tx<
      { id: string; sealed_state: Buffer; workspace_id: string; alias: string; origin: string }[]
    >`
      select id, sealed_state, workspace_id, alias, origin from browser_sessions`;
    for (const row of sessions) {
      const next = await attempt("browser_sessions", row.id, row.sealed_state, {
        kind: "session",
        workspaceId: row.workspace_id,
        alias: row.alias,
        origin: row.origin,
      });
      if (next === null) report.alreadyRotated++;
      else {
        await tx`update browser_sessions set sealed_state = ${Buffer.from(next)}, updated_at = now() where id = ${row.id}`;
        report.sessions++;
      }
    }

    const dead =
      await tx`delete from otp_codes where consumed_at is not null or expires_at <= now() returning id`;
    report.deadOtpCodes = dead.length;
    const codes = await tx<{ id: string; sealed: Buffer; run_id: string; workspace_id: string }[]>`
      select o.id, o.sealed, o.run_id, r.workspace_id from otp_codes o join runs r on r.id = o.run_id`;
    for (const row of codes) {
      const next = await attempt("otp_codes", row.id, row.sealed, {
        kind: "otp",
        workspaceId: row.workspace_id,
        runId: row.run_id,
      });
      if (next === null) report.alreadyRotated++;
      else {
        await tx`update otp_codes set sealed = ${Buffer.from(next)} where id = ${row.id}`;
        report.otpCodes++;
      }
    }
    return report;
  });
}

/** Derives both key pairs for `use`, then zeroes both private keys, whatever happened (spec §9). */
export async function withVaultKeys<T>(
  fromPrivateBase64: string,
  toPrivateBase64: string,
  use: (from: VaultKeyPair, to: VaultKeyPair) => Promise<T>,
): Promise<T> {
  const from = await vaultKeyPairFromPrivate(fromPrivateBase64);
  try {
    const to = await vaultKeyPairFromPrivate(toPrivateBase64);
    try {
      return await use(from, to);
    } finally {
      await wipe(to.privateKey);
    }
  } finally {
    await wipe(from.privateKey);
  }
}
