import { createHash } from "node:crypto";
import { toOrigin } from "@mastertutor/contracts";
import {
  appendVaultAudit,
  deleteBrowserSessions,
  hasHumanVaultGrant,
  listRunCredentialUses,
  loadBrowserSessions,
  upsertBrowserSession,
  type DbExecutor,
} from "@mastertutor/db";
import { sealValue } from "@mastertutor/sealing";
import { withOpenedText } from "@mastertutor/sealing/open";
import type { LoginNotifier, VaultDeps } from "./context.ts";
import { isLogoutLabel } from "./logout.ts";
import { BrowserStorageState, type SessionStore } from "./runtime.ts";

export const MAX_SESSION_STATE_BYTES = 2 * 1024 * 1024;

export interface VaultSessionStore extends SessionStore, LoginNotifier {
  /** RunHooks.onClick: a logout click deletes this run's sessions on that origin (deviation 6). */
  onClick(
    run: { id: string; workspaceId: string },
    click: { label: string; url: string },
  ): Promise<void>;
  forgetRun(runId: string): void;
}

interface Use {
  alias: string;
  origin: string;
  loggedOut: boolean;
  /** Cached only once true: a grant appears only through a human approval, which re-notes the login. */
  granted: boolean;
  /** sha-256 of the last sealed state, so unchanged state is not sealed again after every act. */
  savedDigest: string | null;
}

function cookieMatchesHost(domain: string, host: string): boolean {
  const bare = domain.replace(/^\./, "");
  return host === bare || host.endsWith(`.${bare}`);
}

/**
 * Spec §5.6 over B1's SessionStore (F9): storageState sealed per alias + origin, saved after a
 * signed-in act, restored on lease, deleted on logout. Slots keep no state of their own. Only a
 * person's grant makes a sign-in lasting (S11).
 */
export function createVaultSessionStore(
  deps: Pick<VaultDeps, "db" | "keys" | "log">,
): VaultSessionStore {
  const runs = new Map<string, { uses: Map<string, Use>; loaded: boolean }>();
  const keyOf = (alias: string, origin: string) => `${alias}\u0000${origin}`;
  const runState = (runId: string) => {
    let state = runs.get(runId);
    if (!state) {
      state = { uses: new Map(), loaded: false };
      runs.set(runId, state);
    }
    return state;
  };
  const fresh = (alias: string, origin: string): Use => ({
    alias,
    origin,
    loggedOut: false,
    granted: false,
    savedDigest: null,
  });
  /** The aliases this run signed in with; recovered from the audit log after a restart. */
  async function usesOf(db: DbExecutor, runId: string): Promise<Map<string, Use>> {
    const state = runState(runId);
    if (!state.loaded) {
      for (const use of await listRunCredentialUses(db, runId)) {
        const key = keyOf(use.alias, use.origin);
        if (!state.uses.has(key)) state.uses.set(key, fresh(use.alias, use.origin));
      }
      state.loaded = true;
    }
    return state.uses;
  }

  return {
    noteLogin(runId, alias, origin) {
      runState(runId).uses.set(keyOf(alias, origin), fresh(alias, origin));
    },

    async load(run) {
      const rows = await loadBrowserSessions(deps.db, run.workspaceId, run.allowedOrigins);
      const merged: BrowserStorageState = { cookies: [], origins: [] };
      for (const row of rows) {
        try {
          const state = await withOpenedText(
            deps.keys,
            row.sealed,
            { kind: "session", workspaceId: run.workspaceId, alias: row.alias, origin: row.origin },
            async (text) => BrowserStorageState.parse(JSON.parse(text)),
          );
          merged.cookies.push(...state.cookies);
          merged.origins.push(...state.origins);
        } catch (error) {
          deps.log.warn(
            { alias: row.alias, origin: row.origin, reason: (error as Error).name },
            "session restore skipped",
          );
        }
      }
      return merged.cookies.length + merged.origins.length > 0 ? merged : null;
    },

    async save(tx, run, { state, page }) {
      // A visible password field means not signed in yet (or signed out): never save that state.
      if (page.origin === null || page.passwordFieldVisible) return;
      const here = page.origin;
      const candidates = [...(await usesOf(tx, run.id)).values()].filter(
        (use) => use.origin === here && !use.loggedOut,
      );
      if (candidates.length === 0) return;
      const host = new URL(here).hostname;
      const scoped: BrowserStorageState = {
        cookies: state.cookies.filter((cookie) => cookieMatchesHost(cookie.domain, host)),
        origins: state.origins.filter((entry) => entry.origin === here),
      };
      const text = JSON.stringify(scoped);
      if (Buffer.byteLength(text) > MAX_SESSION_STATE_BYTES) {
        deps.log.warn({ origin: here }, "session too large to save");
        return;
      }
      const digest = createHash("sha256").update(text).digest("hex");
      for (const use of candidates) {
        if (use.savedDigest === digest) continue;
        use.granted ||= await hasHumanVaultGrant(tx, {
          workspaceId: run.workspaceId,
          alias: use.alias,
          origin: here,
        });
        if (!use.granted) continue;
        const sealed = await sealValue(
          deps.keys.publicKey,
          { kind: "session", workspaceId: run.workspaceId, alias: use.alias, origin: here },
          text,
        );
        await upsertBrowserSession(tx, {
          workspaceId: run.workspaceId,
          alias: use.alias,
          origin: here,
          sealed,
        });
        use.savedDigest = digest;
      }
    },

    async onClick(run, click) {
      if (!isLogoutLabel(click.label)) return;
      const origin = toOrigin(click.url);
      if (origin === null) return;
      try {
        for (const use of (await usesOf(deps.db, run.id)).values()) {
          if (use.origin !== origin) continue;
          use.loggedOut = true;
          await deleteBrowserSessions(deps.db, {
            workspaceId: run.workspaceId,
            alias: use.alias,
            origin,
          });
          await appendVaultAudit(deps.db, {
            workspaceId: run.workspaceId,
            itemId: null,
            alias: use.alias,
            origin,
            field: "session",
            action: "delete",
            runId: run.id,
            approvedBy: null,
            outcome: "logout",
          });
        }
      } catch (error) {
        // A hook never fails the act; the session stays sealed and the user can Forget it.
        deps.log.warn({ origin, reason: (error as Error).name }, "logout bookkeeping failed");
      }
    },

    forgetRun(runId) {
      runs.delete(runId);
    },
  };
}
