import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_FILES, dropFiles, uploadToFileDialog } from "./upload.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const file = new File(["hi"], "notes.txt", { type: "text/plain" });

function fakeFetch(status: number) {
  const calls: Array<{ url: string; body: FormData }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as FormData });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("uploads", () => {
  it("posts files to the run's n.eko dialog endpoint", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    expect(await uploadToFileDialog(runId, [file], { fetch: fetchImpl })).toBe("uploaded");
    expect(calls[0]!.url).toBe(`/live/${runId}/api/room/upload/dialog`);
    expect((calls[0]!.body.get("files") as File).name).toBe("notes.txt");
  });

  it("maps n.eko statuses to outcomes", async () => {
    for (const [status, outcome] of [
      [422, "no_file_dialog"],
      [403, "not_in_control"],
      [401, "signed_out"],
      [500, "failed"],
    ] as const) {
      expect(await uploadToFileDialog(runId, [file], { fetch: fakeFetch(status).fetchImpl })).toBe(
        outcome,
      );
    }
  });

  it("drops at a clamped viewport point", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    expect(await dropFiles(runId, [file], { x: 5000.7, y: -3 }, { fetch: fetchImpl })).toBe(
      "uploaded",
    );
    expect(calls[0]!.url).toBe(`/live/${runId}/api/room/upload/drop`);
    expect([calls[0]!.body.get("x"), calls[0]!.body.get("y")]).toEqual(["1279", "0"]);
  });

  it("refuses empty or oversized batches", () => {
    expect(() => uploadToFileDialog(runId, [])).toThrow();
    expect(() =>
      uploadToFileDialog(
        runId,
        Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => file),
      ),
    ).toThrow();
  });
});
