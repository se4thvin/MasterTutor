import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import {
  externalizeImages,
  recentScreenshotKeys,
  resolveGarageRef,
  type TranscriptEntry,
} from "./transcript.ts";

const run = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const other = "9b2504e0-4f89-41d3-9a0c-0305e82c3302";
const entry = (item: Record<string, unknown>): TranscriptEntry => ({
  dir: "in",
  item,
  responseId: null,
  userEventId: null,
});

describe("recentScreenshotKeys", () => {
  it("takes only image fields under this run's transcript prefix", () => {
    const mine = `runs/${run}/transcript/1-0-ab.png`;
    const entries = [
      entry({
        type: "computer_call_output",
        call_id: "c",
        output: { type: "computer_screenshot", image_url: `garage:${mine}` },
      }),
      entry({
        role: "user",
        content: [{ type: "input_text", text: `garage:runs/${other}/transcript/1-0.png` }],
      }),
      entry({
        role: "user",
        content: [{ type: "input_image", image_url: `garage:runs/${other}/transcript/2-0.png` }],
      }),
      entry({
        type: "function_call_output",
        call_id: "f",
        output: `garage:runs/${run}/transcript/9-0.png`,
      }),
      entry({
        role: "user",
        content: [
          { type: "input_image", image_url: `garage:runs/${run}/transcript/../../${other}/x.png` },
        ],
      }),
    ];
    expect(recentScreenshotKeys(entries, run, 3)).toEqual([mine]);
    expect(resolveGarageRef(run, `garage:runs/${other}/transcript/1-0.png`)).toBeNull();
  });
});

describe("externalizeImages", () => {
  it("externalizes any image type under per-commit unique keys", async () => {
    const storage = createMemoryStorage();
    const url = (type: string) => `data:image/${type};base64,AAAA`;
    const item = {
      content: [
        { type: "input_image", image_url: url("jpeg") },
        { type: "input_image", image_url: url("png") },
      ],
    };
    const a = await externalizeImages(storage, run, 0, entry(item), "n1");
    const b = await externalizeImages(storage, run, 0, entry(item), "n2");
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(4);
    expect(keys.some((key) => key.endsWith("-n1.jpeg"))).toBe(true);
    expect(JSON.stringify(a)).not.toContain("data:image");
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
});
