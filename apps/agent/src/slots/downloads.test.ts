import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearRunDownloads } from "./downloads.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const other = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";

describe("clearRunDownloads", () => {
  it("deletes only the run's folder, recursively", async () => {
    const root = await mkdtemp(join(tmpdir(), "downloads-"));
    await mkdir(join(root, runId, "nested"), { recursive: true });
    await writeFile(join(root, runId, "nested", "a.pdf"), "x");
    await mkdir(join(root, other));
    await writeFile(join(root, other, "keep.pdf"), "y");
    await clearRunDownloads(root, runId);
    expect(await readdir(root)).toEqual([other]);
  });
  it("is a no-op when the folder does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "downloads-"));
    await expect(clearRunDownloads(root, runId)).resolves.toBeUndefined();
  });
  it.each(["..", "../etc", "", "not-a-uuid", `${runId}/../..`])("refuses %j", async (bad) => {
    const root = await mkdtemp(join(tmpdir(), "downloads-"));
    await expect(clearRunDownloads(root, bad)).rejects.toThrow();
  });
});
