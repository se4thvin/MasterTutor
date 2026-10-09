import { describe, expect, it } from "vitest";
import { DenialLedger } from "./escalation.ts";

describe("DenialLedger (spec §6.7)", () => {
  it("escalates after 3 consecutive blocked turns", () => {
    const ledger = new DenialLedger();
    ledger.recordTurn(1);
    ledger.recordTurn(1);
    expect(ledger.reachedLimit()).toBe(false);
    ledger.recordTurn(1);
    expect(ledger.reachedLimit()).toBe(true);
  });
  it("resets the streak on a turn with no block, but keeps the total", () => {
    const ledger = new DenialLedger();
    ledger.recordTurn(2);
    ledger.recordTurn(0);
    expect(ledger.state).toEqual({ consecutive: 0, total: 2 });
  });
  it("escalates at 20 blocked items in total", () => {
    const ledger = new DenialLedger({ consecutive: 0, total: 19 });
    ledger.recordTurn(1);
    expect(ledger.reachedLimit()).toBe(true);
  });
  it("starts again when a person clears it", () => {
    const ledger = new DenialLedger({ consecutive: 3, total: 25 });
    ledger.personCleared();
    expect(ledger.state).toEqual({ consecutive: 0, total: 0 });
    expect(ledger.reachedLimit()).toBe(false);
  });
});
