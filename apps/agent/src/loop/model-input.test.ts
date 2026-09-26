import { describe, expect, it } from "vitest";
import { TINY_PNG } from "../testing/fake-loop-browser.ts";
import { createMemoryStorage } from "../testing/memory-storage.ts";
import {
  BLANK_SCREENSHOT,
  SCREENSHOT_OMITTED,
  buildModelInput,
  contextEntries,
  rehydrateImages,
} from "./model-input.ts";
import type { TranscriptEntry } from "./transcript.ts";

const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ref = (n: number) => `garage:runs/${RUN}/transcript/${n}-0-x.png`;
const entry = (
  dir: "in" | "out",
  item: Record<string, unknown>,
  mark?: "compaction" | "seed",
): TranscriptEntry => ({
  dir,
  item,
  responseId: dir === "out" ? "r" : null,
  userEventId: null,
  ...(mark ? { mark } : {}),
});
const user = (text: string, image: string | null = null) => ({
  role: "user",
  content: [
    { type: "input_text", text },
    ...(image ? [{ type: "input_image", image_url: image, detail: "original" }] : []),
  ],
});
const call = (id: string) => ({ type: "computer_call", call_id: id, actions: [{ type: "wait" }] });
const output = (id: string, image: string) => ({
  type: "computer_call_output",
  call_id: id,
  output: { type: "computer_screenshot", image_url: image },
});
const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" };

describe("buildModelInput (D37: stateless input from run_transcript)", () => {
  it("replays every item in order, reasoning included, then the pending outputs", () => {
    const history = [
      entry("in", user("goal", ref(1))),
      entry("out", reasoning),
      entry("out", call("c1")),
    ];
    const input = buildModelInput(history, [output("c1", ref(2)) as never, user("now") as never]);
    expect(input.map((item) => ("type" in item ? item.type : "message"))).toEqual([
      "message",
      "reasoning",
      "computer_call",
      "computer_call_output",
      "message",
    ]);
    expect(input[1]).toEqual(reasoning);
  });

  it("refuses an input where a call has no output or an output has no call", () => {
    expect(() => buildModelInput([entry("out", call("c1"))], [])).toThrow(/c1/);
    expect(() => buildModelInput([], [output("c9", ref(1)) as never])).toThrow(/c9/);
    expect(() =>
      buildModelInput(
        [entry("out", call("c1"))],
        [output("c1", ref(1)) as never, output("c1", ref(1)) as never],
      ),
    ).toThrow(/c1/);
  });

  it("sends only the newest 3 screenshots as images", () => {
    const history = [
      entry("in", user("goal", ref(1))),
      entry("out", call("c1")),
      entry("in", output("c1", ref(2))),
      entry("out", call("c2")),
      entry("in", output("c2", ref(3))),
      entry("out", call("c3")),
    ];
    const input = buildModelInput(history, [
      output("c3", ref(4)) as never,
      user("now", ref(5)) as never,
    ]);
    const text = JSON.stringify(input);
    expect(text).not.toContain(ref(1));
    expect(text).not.toContain(ref(2));
    for (const n of [3, 4, 5]) expect(text).toContain(ref(n));
    expect(JSON.stringify(input[0])).toContain(SCREENSHOT_OMITTED);
    expect((input[2] as { output: { image_url: string } }).output.image_url).toBe(BLANK_SCREENSHOT);
    expect(history[0]!.item).toEqual(user("goal", ref(1)));
  });

  it("starts from the last compaction seed and never replays compaction exchanges", () => {
    const history = [
      entry("in", user("old goal")),
      entry("out", call("c1")),
      entry("in", output("c1", ref(1)), "compaction"),
      entry(
        "out",
        { type: "message", content: [{ type: "output_text", text: "{}" }] },
        "compaction",
      ),
      entry("in", user("Summary"), "seed"),
      entry("in", user("", ref(2)), "seed"),
      entry("out", call("c2")),
    ];
    expect(contextEntries(history).map((e) => e.item)).toEqual(history.slice(4).map((e) => e.item));
    const input = buildModelInput(history, [output("c2", ref(3)) as never]);
    expect(JSON.stringify(input)).not.toContain("old goal");
    expect(input).toHaveLength(4);
  });
});

/** Turn-1 outputs recorded from gpt-6-astra (store:false) in the two runs that failed on turn 2. */
const RECORDED_TURN_1 = {
  captionOnly: {
    id: "msg_05127aab4471b68a016ac7b919ed5087d1a3b95ac43ab1ee84",
    role: "assistant",
    type: "message",
    phase: "final_answer",
    status: "completed",
    content: [
      {
        text: '{"status":"continue","needHuman":null,"reason":"I will read the section and save notes.","planUpdate":null}',
        type: "output_text",
        logprobs: [],
        annotations: [],
      },
    ],
  },
  readPage: {
    id: "fc_05da782f2ad05004016ac7b8f73c0c87d18b342d714b4d795c",
    name: "read_page",
    type: "function_call",
    status: "completed",
    call_id: "call_thxE4qdSfSeDAmCHcyJLwBGa",
    arguments: '{"mode":"interactive","sinceHash":null,"offset":null}',
  },
};
const messageImages = (items: readonly unknown[]) =>
  (items as Array<{ content?: unknown }>)
    .flatMap((item) =>
      Array.isArray(item.content) ? (item.content as Array<{ type: string }>) : [],
    )
    .filter((part) => part.type === "input_image").length;

describe("turn 2 after a recorded turn 1 (model_request_rejected, 2026-10-08)", () => {
  // The computer tool is declared on every request, and with it OpenAI refuses more than one
  // message image ("Computer tool cannot use multiple image inputs"); call outputs do not count.
  it("sends only the newest page image after a caption-only reply", () => {
    const history = [entry("in", user("goal", ref(1))), entry("out", RECORDED_TURN_1.captionOnly)];
    const input = buildModelInput(history, [user("Current page: x", ref(2)) as never]);
    expect(messageImages(input)).toBe(1);
    expect(JSON.stringify(input)).toContain(ref(2));
    expect(JSON.stringify(input[0])).toContain(SCREENSHOT_OMITTED);
    expect(input[1]).toEqual(RECORDED_TURN_1.captionOnly);
  });

  it("sends only the newest page image after a recorded function call", () => {
    const history = [entry("in", user("goal", ref(1))), entry("out", RECORDED_TURN_1.readPage)];
    const input = buildModelInput(history, [
      { type: "function_call_output", call_id: RECORDED_TURN_1.readPage.call_id, output: "{}" },
      user("Current page: x", ref(2)) as never,
    ]);
    expect(messageImages(input)).toBe(1);
    expect(JSON.stringify(input.at(-1))).toContain(ref(2));
  });

  it("keeps the newest 3 call screenshots beside the one message image", () => {
    const history = [
      entry("in", user("goal", ref(1))),
      entry("out", call("c1")),
      entry("in", output("c1", ref(2))),
      entry("out", call("c2")),
    ];
    const input = buildModelInput(history, [
      output("c2", ref(3)) as never,
      user("now", ref(4)) as never,
    ]);
    const text = JSON.stringify(input);
    for (const n of [2, 3, 4]) expect(text).toContain(ref(n));
    expect(messageImages(input)).toBe(1);
  });
});

describe("rehydrateImages", () => {
  it("turns this run's garage refs into data URLs and drops foreign or missing ones", async () => {
    const storage = createMemoryStorage();
    await storage.put(ref(1).slice("garage:".length), TINY_PNG, { contentType: "image/png" });
    const foreign = "garage:runs/00000000-0000-4000-8000-000000000000/transcript/1-0-x.png";
    const items = await rehydrateImages(
      [user("a", ref(1)) as never, user("b", foreign) as never, output("c1", ref(7)) as never],
      RUN,
      storage,
    );
    const text = JSON.stringify(items);
    expect(text).toContain(`data:image/png;base64,${TINY_PNG.toString("base64")}`);
    expect(text).not.toContain("garage:");
    expect(JSON.stringify(items[1])).toContain(SCREENSHOT_OMITTED);
    expect((items[2] as { output: { image_url: string } }).output.image_url).toBe(BLANK_SCREENSHOT);
  });
});
