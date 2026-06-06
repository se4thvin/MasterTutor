import { MAX_UPLOAD_BYTES } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import * as upload from "./upload.ts";
import { MAX_UPLOAD_FILES, dropFiles } from "./upload.ts";

const runId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const file = new File(["hi"], "notes.txt", { type: "text/plain" });
const point = { x: 10, y: 10 };

function fakeFetch(status: number) {
  const calls: Array<{ url: string; body: FormData }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as FormData });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("uploads (drop is the only path in v1)", () => {
  it("drops files at a clamped viewport point on the run's n.eko", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    expect(await dropFiles(runId, [file], { x: 5000.7, y: -3 }, { fetch: fetchImpl })).toBe(
      "uploaded",
    );
    expect(calls[0]!.url).toBe(`/live/${runId}/api/room/upload/drop`);
    expect((calls[0]!.body.get("files") as File).name).toBe("notes.txt");
    expect([calls[0]!.body.get("x"), calls[0]!.body.get("y")]).toEqual(["1279", "0"]);
  });

  it("maps statuses to outcomes: 401 is signed out, 403 is not in control", async () => {
    for (const [status, outcome] of [
      [403, "not_in_control"],
      [401, "signed_out"],
      [500, "failed"],
    ] as const) {
      expect(await dropFiles(runId, [file], point, { fetch: fakeFetch(status).fetchImpl })).toBe(
        outcome,
      );
    }
  });

  it("refuses empty or oversized batches", () => {
    expect(() => dropFiles(runId, [], point)).toThrow();
    expect(() =>
      dropFiles(
        runId,
        Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => file),
        point,
      ),
    ).toThrow();
  });

  it("refuses more than MAX_UPLOAD_BYTES without sending anything (I2)", async () => {
    const { calls, fetchImpl } = fakeFetch(204);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES)], "big.bin");
    expect(await dropFiles(runId, [big, file], point, { fetch: fetchImpl })).toBe("too_large");
    expect(calls).toEqual([]);
  });

  it("offers no file-chooser upload: n.eko 3.1.6 cannot fill the dialog in this image", () => {
    expect("uploadToFileDialog" in upload).toBe(false);
  });
});
