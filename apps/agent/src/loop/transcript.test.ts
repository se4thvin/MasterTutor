import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import { externalizeImages, resolveGarageRef, type TranscriptEntry } from "./transcript.ts";

const run = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const other = "9b2504e0-4f89-41d3-9a0c-0305e82c3302";
const entry = (item: Record<string, unknown>): TranscriptEntry => ({
  dir: "in",
  item,
  responseId: null,
  userEventId: null,
});

describe("resolveGarageRef", () => {
  it("resolves only this run's own image keys", () => {
    expect(resolveGarageRef(run, `garage:runs/${run}/transcript/1-0-ab.png`)).toBe(
      `runs/${run}/transcript/1-0-ab.png`,
    );
    expect(resolveGarageRef(run, `garage:runs/${other}/transcript/1-0.png`)).toBeNull();
    expect(resolveGarageRef(run, `garage:runs/${run}/transcript/../../${other}/x.png`)).toBeNull();
    expect(resolveGarageRef(run, `runs/${run}/transcript/1-0.png`)).toBeNull();
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
