import { costUsd, MODELS } from "@mastertutor/contracts";
export class Budget {
  spent: number;
  constructor(initial = 0) {
    if (!Number.isFinite(initial) || initial < 0 || initial > 10) throw new RangeError("invalid initial spend");
    this.spent = initial;
  }
  readonly cap = 10;
  canSend(reservation: number) {
    if (!Number.isFinite(reservation) || reservation < 0) throw new RangeError("invalid reservation");
    return this.spent + reservation <= this.cap;
  }
  settle(reservation: number, actual: number) {
    if (!Number.isFinite(actual) || actual < 0 || actual > reservation || reservation > this.spent) throw new RangeError("invalid settlement");
    this.spent -= reservation - actual;
  }
  charge(usd: number) {
    if (!Number.isFinite(usd) || usd < 0 || this.spent + usd > this.cap + 1e-9) throw new RangeError("invalid charge");
    this.spent += usd;
  }
}
/** Conservative bound: 4096 tokens per 1280×800 screenshot, plus one per non-image UTF-8 byte. */
export function reserveInput(input: unknown, output = 768) {
  let images = 0;
  const text = JSON.stringify(input, (key, value) => {
    if (key === "image_url") { images++; return ""; }
    return value;
  });
  const bound = images * 4096 + Buffer.byteLength(text) + 4096;
  return costUsd(MODELS.agentPrimary, { input: bound, cached: 0, cacheWrite: bound, output });
}
