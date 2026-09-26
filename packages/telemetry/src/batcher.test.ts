import { describe, expect, it } from "vitest";
import { BoundedBatcher } from "./batcher.ts";
import type { DropReason } from "@mastertutor/contracts/telemetry";

function harness(send: (batch: number[]) => Promise<void>, maxQueue = 4, maxBatch = 2) {
  const drops: Array<[number, DropReason]> = [];
  const batcher = new BoundedBatcher<number>({
    maxQueue,
    maxBatch,
    intervalMs: 60_000,
    send,
    onDrop: (count, reason) => drops.push([count, reason]),
  });
  return { batcher, drops };
}

describe("BoundedBatcher (spec §7.1)", () => {
  it("drops and counts when the queue is full, without waiting", () => {
    const { batcher, drops } = harness(() => new Promise<void>(() => undefined), 2, 10);
    batcher.add(1);
    batcher.add(2);
    batcher.add(3);
    expect(batcher.size).toBe(2);
    expect(drops).toEqual([[1, "queue_full"]]);
  });

  it("counts a failed export by its batch size and never throws", async () => {
    const { batcher, drops } = harness(async () => {
      throw new Error("collector down");
    });
    batcher.add(1);
    batcher.add(2);
    batcher.add(3);
    await batcher.flush();
    expect(drops).toEqual([
      [2, "export_failed"],
      [1, "export_failed"],
    ]);
    expect(batcher.size).toBe(0);
  });

  it("exports one batch at a time, in order", async () => {
    const seen: number[][] = [];
    const { batcher } = harness(async (batch) => void seen.push(batch), 10, 2);
    for (const n of [1, 2, 3, 4, 5]) batcher.add(n);
    await batcher.flush();
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("flushes on shutdown and drops what arrives after", async () => {
    const seen: number[][] = [];
    const { batcher, drops } = harness(async (batch) => void seen.push(batch), 10, 5);
    batcher.add(1);
    await batcher.shutdown();
    batcher.add(2);
    expect(seen).toEqual([[1]]);
    expect(drops).toEqual([[1, "queue_full"]]);
  });
});
