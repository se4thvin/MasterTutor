import { readFile } from "node:fs/promises";
import { generateVaultKeyPair, type VaultKeyPair } from "@mastertutor/sealing/open";
import { describe, expect, it } from "vitest";
import { withVaultKeys } from "./rotate.ts";

const zeroed = (key: Uint8Array) => key.every((byte) => byte === 0);

describe("vault:rotate key handling (review 11, 12)", () => {
  it("zeroes both private keys after use, also when the rotation fails", async () => {
    const [a, b] = [await generateVaultKeyPair(), await generateVaultKeyPair()];
    let seen: VaultKeyPair[] = [];
    expect(
      await withVaultKeys(a.privateKeyBase64, b.privateKeyBase64, async (from, to) => {
        seen = [from, to];
        expect(zeroed(from.privateKey)).toBe(false);
        return "done";
      }),
    ).toBe("done");
    expect(seen.map((pair) => zeroed(pair.privateKey))).toEqual([true, true]);
    await expect(
      withVaultKeys(a.privateKeyBase64, b.privateKeyBase64, async (from, to) => {
        seen = [from, to];
        throw new Error("rotation failed");
      }),
    ).rejects.toThrow("rotation failed");
    expect(seen.map((pair) => zeroed(pair.privateKey))).toEqual([true, true]);
  });

  it("documents a runbook that never puts a private key on a command line", async () => {
    const runbook = await readFile(new URL("../bin/vault-rotate.ts", import.meta.url), "utf8");
    expect(runbook).not.toMatch(/VAULT_(NEXT_)?PRIVATE_KEY=</);
    expect(runbook).toMatch(/set -a; \. \.\/rotate\.env; set \+a/);
  });
});
