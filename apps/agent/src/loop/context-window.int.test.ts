import { describe, expect, it } from "vitest";
import { agent, done, drive, mock, setup } from "./testing/loop-harness.ts";

// 20,000 repeated BPE-sized words; byte/4 is a reproducible input-size proxy, not API billing.
import { loadTranscript } from "./transcript.ts";

const PAGE = " abc".repeat(20_000);

describe("bulky tool output regression (F1)", () => {
  it("bounds every request over 100 read_page results without dropping persisted text", async () => {
    const turns = Array.from({ length: 100 }, (_, offset) => ({
      outputs: [
        {
          type: "function" as const,
          name: "read_page",
          args: { mode: "text", sinceHash: null, offset },
        },
      ],
    }));
    const s = await setup([...turns, done()], {
      budget: { maxSteps: 1_000, maxUsd: 100, maxActiveMinutes: 60 },
    });
    s.browser.functionOutput = () =>
      JSON.stringify({ url: s.browser.url, hash: s.browser.domHash, text: PAGE });
    let observations = 0;
    s.browser.observeHook = () => {
      s.browser.domHash = String(++observations).padStart(64, "0");
    };
    expect((await drive(s.loop, 500)).kind).toBe("completed");
    const requests = mock
      .requestsFor(s.name)
      .filter((r) => r.body.text?.format?.name === "agent_turn");
    const curve = requests.map((r) =>
      Math.ceil(Buffer.byteLength(JSON.stringify(r.body.input)) / 4),
    );
    console.info("F1 input byte/4 curve", JSON.stringify(curve));
    expect(curve).toHaveLength(101);
    for (const r of requests) {
      const input = JSON.stringify(r.body.input);
      const pages = input.split(PAGE).length - 1;
      expect(pages).toBeLessThanOrEqual(2);
      // Each fixture word is one token. Treat EVERY other serialized UTF-8 byte as a
      // token, including image URLs and JSON framing, for a conservative input ceiling.
      const ceiling = pages * 20_000 + Buffer.byteLength(input.replaceAll(PAGE, ""));
      expect(ceiling).toBeLessThan(140_000);
    }
    expect(Math.max(...curve)).toBeLessThan(70_000);
    const stored = await loadTranscript(agent.db, s.run.id);
    expect(
      stored.filter(
        (e) => e.item.type === "function_call_output" && String(e.item.output).includes(PAGE),
      ),
    ).toHaveLength(100);
  });
});
