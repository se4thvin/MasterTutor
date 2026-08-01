import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LedgerBusy,
  LedgerRefused,
  assertMayStart,
  ledgerDir,
  openLedger,
  totalUsd,
  type Ledger,
} from "./ledger.ts";

const opened: Ledger[] = [];
const open = (dir: string) => {
  const ledger = openLedger(dir);
  opened.push(ledger);
  return ledger;
};
afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close();
});
const dir = () => mkdtempSync(join(tmpdir(), "bench-ledger-"));

describe("the bench ledger (I1, I2)", () => {
  it("lives in the account's home from the passwd entry, so HOME cannot move it", () => {
    const home = process.env.HOME;
    process.env.HOME = "/tmp/elsewhere";
    try {
      expect(ledgerDir()).toBe(join(userInfo().homedir, ".mastertutor-bench"));
    } finally {
      process.env.HOME = home;
    }
  });

  it("records the intent as running before the run, and its spend at each checkpoint and the end", () => {
    const d = dir();
    const ledger = open(d);
    const id = ledger.start("zybooks", "run --suite zybooks");
    expect(ledger.entries()).toMatchObject([{ id, suite: "zybooks", status: "running", usd: 0 }]);
    ledger.checkpoint(id, 3.25);
    ledger.checkpoint(id, 1); // never lowers recorded spend
    expect(ledger.entries()[0]).toMatchObject({ status: "running", usd: 3.25 });
    ledger.end(id, 7.5, "orchestration/benchmarks/2026-10-08-zybooks-01/record.md");
    expect(ledger.entries()[0]).toMatchObject({
      status: "finished",
      usd: 7.5,
      record: "orchestration/benchmarks/2026-10-08-zybooks-01/record.md",
    });
    expect(statSync(join(d, "ledger.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("totals spend per suite from the ledger alone, a crashed run's last checkpoint included", () => {
    const ledger = open(dir());
    const a = ledger.start("zybooks", "x");
    ledger.end(a, 40, null);
    const b = ledger.start("zybooks", "x");
    ledger.checkpoint(b, 12); // crashed here: no end
    const f = ledger.start("fixtures", "x");
    ledger.end(f, 2, null);
    expect(totalUsd(ledger.entries(), "zybooks")).toBe(52);
    expect(totalUsd(ledger.entries(), "fixtures")).toBe(2);
  });

  it("refuses every new run while one is still running, until `bench resolve <id>`", () => {
    const ledger = open(dir());
    const crashed = ledger.start("fixtures", "x");
    expect(() => assertMayStart(ledger.entries(), "fixtures", null)).toThrow(
      new RegExp(`bench resolve ${crashed}`),
    );
    expect(() => assertMayStart(ledger.entries(), "zybooks", "r")).toThrow(LedgerRefused);
    ledger.resolve(crashed);
    expect(ledger.entries()[0]!.status).toBe("resolved");
    expect(() => assertMayStart(ledger.entries(), "fixtures", null)).not.toThrow();
    expect(() => ledger.resolve(crashed)).toThrow(/not running/);
  });

  it("refuses any further zyBooks run without the reviewed continuation (D46, Task 25B)", () => {
    const ledger = open(dir());
    expect(() => assertMayStart(ledger.entries(), "zybooks", null)).not.toThrow();
    ledger.end(ledger.start("zybooks", "x"), 5, null);
    expect(() => assertMayStart(ledger.entries(), "zybooks", null)).toThrow(
      /continue-after-review/,
    );
    expect(() =>
      assertMayStart(ledger.entries(), "zybooks", "2026-10-08-zybooks-01"),
    ).not.toThrow();
    // Fixture runs are not gated by earlier records.
    ledger.end(ledger.start("fixtures", "x"), 1, null);
    expect(() => assertMayStart(ledger.entries(), "fixtures", null)).not.toThrow();
  });

  it("refuses a concurrent CLI, and takes over a lock whose process is gone", () => {
    const d = dir();
    open(d);
    expect(() => openLedger(d)).toThrow(LedgerBusy);
    opened.pop()!.close();
    writeFileSync(join(d, "ledger.lock"), "2147483646"); // a pid that is not running
    expect(() => open(d)).not.toThrow();
    expect(readFileSync(join(d, "ledger.lock"), "utf8")).toBe(String(process.pid));
  });

  it("refuses a ledger it cannot read, instead of counting it as zero spend", () => {
    const d = dir();
    open(d).end(opened[0]!.start("zybooks", "x"), 5, null);
    appendFileSync(join(d, "ledger.jsonl"), "not json\n");
    expect(() => opened[0]!.entries()).toThrow(/ledger/);
  });
});
