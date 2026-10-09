import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "./budget.ts";
test("reserve before send; charge failed requests conservatively", () => {
  const budget = new Budget();
  assert.equal(budget.canSend(9.5), true);
  budget.charge(9.5);
  assert.equal(budget.canSend(0.51), false);
  assert.equal(budget.canSend(0.5), true);
  assert.throws(() => budget.charge(-1));
  assert.throws(() => budget.canSend(Number.NaN));
});
test("settle a pre-send reservation without losing previous spend", () => {
  const budget = new Budget(3);
  budget.charge(2);
  budget.settle(2, 0.5);
  assert.equal(budget.spent, 3.5);
  assert.throws(() => budget.settle(1, 2));
  assert.throws(() => new Budget(11));
});
