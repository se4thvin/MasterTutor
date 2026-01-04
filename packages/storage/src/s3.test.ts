import { describe, expect, it } from "vitest";
import { createStorage } from "./s3.ts";

const storage = createStorage({
  endpoint: "http://127.0.0.1:1",
  region: "garage",
  bucket: "mastertutor",
  accessKeyId: "GK222222222222222222222222",
  secretAccessKey: "2".repeat(64),
});

describe("presignGet", () => {
  it("signs locally with the requested TTL", async () => {
    const url = await storage.presignGet("runs/x/steps/1.png", 300);
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).toContain("/mastertutor/runs/x/steps/1.png");
  });
  it.each([0, 3601, 1.5])("rejects a TTL of %s seconds", async (ttl) => {
    await expect(storage.presignGet("a/b", ttl)).rejects.toThrow(RangeError);
  });
  it("rejects malformed keys before any network call", async () => {
    await expect(storage.presignGet("../etc", 60)).rejects.toThrow(TypeError);
  });
});
