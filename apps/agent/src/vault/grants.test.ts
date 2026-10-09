import { PersonDecider, POLICY_DECIDER } from "@mastertutor/contracts";
import type { Database, VaultItemRecord } from "@mastertutor/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  insertVaultGrant: vi.fn(async () => undefined),
  getVaultGrantApprover: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("@mastertutor/db", () => db);
const { approvedBy } = await import("./grants.ts");

const item: VaultItemRecord = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  alias: "site",
  origin: "https://a.example",
  label: "Site",
  fields: ["password"],
  imap: null,
};
const deps = { db: {} as Database };

beforeEach(() => {
  db.insertVaultGrant.mockClear();
  db.getVaultGrantApprover.mockClear();
});

describe("approvedBy never writes a grant the policy decided (review 8, R-E7)", () => {
  it("consults no grant at all for a page on another origin", async () => {
    db.getVaultGrantApprover.mockResolvedValueOnce("user-2");
    const approval = {
      kind: "credential_first_use",
      decidedBy: PersonDecider.parse("user-1"),
      label: null,
      decidedAt: null,
    };
    expect(await approvedBy(deps, approval, item, "https://a.example.evil.test/")).toBeNull();
    expect(await approvedBy(deps, null, item, "https://b.example/")).toBeNull();
    expect(db.insertVaultGrant).not.toHaveBeenCalled();
    expect(db.getVaultGrantApprover).not.toHaveBeenCalled();
  });

  it("lets a policy approval authorize this call only", async () => {
    const approval = {
      kind: "credential_first_use",
      decidedBy: POLICY_DECIDER as typeof POLICY_DECIDER,
      label: null,
      decidedAt: null,
    };
    expect(await approvedBy(deps, approval, item, item.origin)).toBe("policy");
    expect(db.insertVaultGrant).not.toHaveBeenCalled();
  });

  it("never turns a bypass-mode approval into a lasting grant (D44, m7)", async () => {
    const approval = {
      kind: "credential_first_use",
      // The loop maps bypass to policy before tools see it; the type refuses it, this checks the
      // tool would still not grant if one slipped through.
      decidedBy: "bypass" as typeof POLICY_DECIDER,
      label: null,
      decidedAt: null,
    };
    expect(await approvedBy(deps, approval, item, item.origin)).toBe("bypass");
    expect(db.insertVaultGrant).not.toHaveBeenCalled();
  });

  it("turns a person's approval into a lasting grant", async () => {
    const approval = {
      kind: "credential_first_use",
      decidedBy: PersonDecider.parse("user-1"),
      label: null,
      decidedAt: null,
    };
    expect(await approvedBy(deps, approval, item, item.origin)).toBe("user-1");
    expect(db.insertVaultGrant).toHaveBeenCalledWith(deps.db, {
      itemId: item.id,
      origin: item.origin,
      approvedBy: "user-1",
    });
  });

  it("falls back to an existing grant when the call needed no approval", async () => {
    db.getVaultGrantApprover.mockResolvedValueOnce("user-2");
    expect(await approvedBy(deps, null, item, item.origin)).toBe("user-2");
    expect(db.insertVaultGrant).not.toHaveBeenCalled();
  });
});
