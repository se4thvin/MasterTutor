import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { ScopeScreenInput } from "@mastertutor/contracts";
import { scopeScreenToken } from "@mastertutor/contracts/server";
import { listVaultItemRecords } from "@mastertutor/db";
import type { VaultDeps } from "./context.ts";
import { withItemSecret } from "./secrets.ts";
import { createSecretFingerprints } from "./fingerprints.ts";
import { screenText } from "../notes/note-writer.ts";

/** Opens workspace vault values only inside the vault, reusing its exact and distinctive screen. */
async function safeScope(deps: Pick<VaultDeps, "db" | "keys">, workspaceId: string, text: string) {
  const fingerprints = createSecretFingerprints();
  let safe = true;
  try {
    for (const item of await listVaultItemRecords(deps.db, workspaceId)) {
      for (const field of item.fields) {
        await withItemSecret(deps, workspaceId, item, field, async (secret) => {
          // Exact matching also covers short values that the page screen intentionally excludes.
          if (secret && text.includes(secret)) safe = false;
          fingerprints.rememberSecret("scope", secret);
        });
      }
    }
    screenText(fingerprints.forRun("scope"), text);
    return safe;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "secret_on_page") return false;
    throw error;
  } finally {
    fingerprints.forgetRun("scope");
  }
}

/** Internal verdict-only endpoint. No text, values or upstream errors are logged or returned. */
export async function startScopeScreenServer(
  options: Pick<VaultDeps, "db" | "keys"> & {
    token: string;
    port: number;
    host?: string;
  },
) {
  const authorization = Buffer.from(`Bearer ${scopeScreenToken(options.token)}`);
  const server = createServer(async (req, res) => {
    const reply = (status: number, body: unknown = {}) =>
      res
        .writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(body));
    if (req.method !== "POST" || req.url !== "/scope-screen") {
      reply(404);
      return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      reply(401);
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          reply(413);
          return;
        }
        chunks.push(chunk);
      }
      const parsed = ScopeScreenInput.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!parsed.success) {
        reply(400);
        return;
      }
      const { workspaceId, text } = parsed.data;
      reply(200, { safe: await safeScope(options, workspaceId, text) });
    } catch {
      reply(503);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
