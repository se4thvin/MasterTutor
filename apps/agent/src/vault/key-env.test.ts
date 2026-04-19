import { generateVaultKeyPair } from "@mastertutor/sealing/open";
import { describe, expect, it } from "vitest";
import { takeVaultKeys } from "./key-env.ts";

describe("takeVaultKeys (S2)", () => {
  it("leaves the private keys only in the key pair: not in process.env, not in the parsed env", async () => {
    const pair = await generateVaultKeyPair();
    const processEnv: NodeJS.ProcessEnv = {
      VAULT_PRIVATE_KEY: pair.privateKeyBase64,
      VAULT_NEXT_PRIVATE_KEY: "next",
      LOG_LEVEL: "info",
    };
    const parsed = { VAULT_PRIVATE_KEY: pair.privateKeyBase64, LOG_LEVEL: "info" as const };
    const { keys, env } = await takeVaultKeys(parsed, processEnv);
    expect(Buffer.from(keys.publicKey).toString("base64")).toBe(pair.publicKeyBase64);
    expect(processEnv).toEqual({ LOG_LEVEL: "info" });
    expect(env).toEqual({ LOG_LEVEL: "info" });
    expect(JSON.stringify(env)).not.toContain(pair.privateKeyBase64);
  });
});
