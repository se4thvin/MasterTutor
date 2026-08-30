import { describe, expect, it, vi } from "vitest";
import type { BenchApi } from "./app-client.ts";
import { SessionStillSaved, checkVaultItem, ensureFreshLogin } from "./vault-check.ts";

const req = {
  alias: "site",
  origin: "https://learn.example",
  fields: ["username", "password"] as const,
};
const api = (items: unknown[]) =>
  ({
    vault: {
      list: vi.fn(async () => ({ items })),
      forgetSession: vi.fn(async () => ({ ok: true })),
    },
  }) as unknown as BenchApi & {
    vault: { forgetSession: ReturnType<typeof vi.fn> };
  };
const item = (over: Record<string, unknown> = {}) => ({
  alias: "site",
  origin: "https://learn.example",
  fields: ["username", "password"],
  sessionSaved: false,
  ...over,
});

describe("vault check (D34: the harness never sees a secret)", () => {
  it("is ready only when alias, origin and fields match", async () => {
    expect(await checkVaultItem(api([item()]), req)).toBeNull();
    expect(await checkVaultItem(api([item({ fields: ["username"] })]), req)).toMatch(
      /missing: password/,
    );
    expect(await checkVaultItem(api([item({ origin: "https://other.example" })]), req)).toMatch(
      /currently https:\/\/other\.example/,
    );
    expect(await checkVaultItem(api([]), req)).toMatch(/Vault page/);
    expect(await checkVaultItem(api([]), req)).toMatch(/Vault UI only/);
  });
  it("forgets the session, re-lists, and refuses while one is still saved (P10b-4)", async () => {
    const fresh = api([item()]);
    await ensureFreshLogin(fresh, req);
    expect(fresh.vault.forgetSession).toHaveBeenCalledWith({
      alias: "site",
      origin: "https://learn.example",
    });
    await expect(ensureFreshLogin(api([item({ sessionSaved: true })]), req)).rejects.toBeInstanceOf(
      SessionStillSaved,
    );
  });
});
