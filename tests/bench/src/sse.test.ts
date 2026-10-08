import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "./sse.ts";

describe("createSseParser", () => {
  it("parses id, event and multi-line data across chunk boundaries", () => {
    const got: SseMessage[] = [];
    const feed = createSseParser((m) => got.push(m));
    feed("id: 7\nevent: run_event\nda");
    feed('ta: {"a":\ndata: 1}\n\n: comment\n\nid: 8\nevent: x\ndata: z\n\n');
    expect(got).toEqual([
      { id: "7", event: "run_event", data: '{"a":\n1}' },
      { id: "8", event: "x", data: "z" },
    ]);
  });
  it("handles CRLF line endings and a retry: field", () => {
    const got: SseMessage[] = [];
    createSseParser((m) => got.push(m))(
      "retry: 3000\r\nid: 1\r\nevent: run_event\r\ndata: q\r\n\r\n",
    );
    expect(got).toEqual([{ id: "1", event: "run_event", data: "q" }]);
  });
});
