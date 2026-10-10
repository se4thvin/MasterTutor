import { expect, it } from "vitest";
import { click, done, drive, mock, setup } from "./testing/loop-harness.ts";

it("keeps decide prefixes across restore and starts a fresh seed before image eviction", async () => {
  const h = await setup([click(), click(20, 30), click(30, 40), done()]);
  while (mock.requestsFor(h.name).length < 2) await h.loop.step(new AbortController().signal);
  expect(await drive(await h.reload())).toEqual({ kind: "completed" });
  const requests = mock.requestsFor(h.name).map((r) => r.body);
  const decides = requests.filter((r) => r.text?.format?.name === "agent_turn");
  for (const index of [1, 2]) {
    const previous = decides[index - 1]!.input as unknown[];
    expect(JSON.stringify((decides[index]!.input as unknown[]).slice(0, previous.length))).toBe(
      JSON.stringify(previous),
    );
  }
  expect(requests.filter((r) => r.text?.format?.name === "compaction_summary")).toHaveLength(1);
  expect(JSON.stringify(decides[3]!.input)).toContain("This run continues from a summary");
  expect(decides.map((r) => r.prompt_cache_key)).toEqual(
    Array(4).fill(decides[0]!.prompt_cache_key),
  );
  expect(String(decides[0]!.prompt_cache_key)).not.toContain(h.run.id);
});

it("appends DOM tool results without resending an identical message screenshot", async () => {
  const h = await setup([
    {
      outputs: [
        {
          type: "function",
          name: "read_page",
          args: { mode: "text", sinceHash: null, offset: null },
        },
      ],
    },
    {
      outputs: [
        { type: "function", name: "capture", args: { scope: "page", selector: null, kind: null } },
      ],
    },
    done(),
  ]);
  expect(await drive(h.loop)).toEqual({ kind: "completed" });
  const requests = mock.requestsFor(h.name).map((r) => r.body);
  expect(requests).toHaveLength(3);
  for (let i = 1; i < requests.length; i++) {
    const previous = requests[i - 1]!.input as unknown[];
    expect(JSON.stringify((requests[i]!.input as unknown[]).slice(0, previous.length))).toBe(
      JSON.stringify(previous),
    );
  }
});

it("compacts before a bulky page result would rewrite an earlier output", async () => {
  const read = {
    outputs: [
      {
        type: "function" as const,
        name: "read_page",
        args: { mode: "text", sinceHash: null, offset: null },
      },
    ],
  };
  const h = await setup([read, read, read, done()]);
  h.browser.functionOutput = () =>
    JSON.stringify({ url: "http://site.fixtures.test/", text: "verbatim page text ".repeat(300) });
  expect(await drive(h.loop)).toEqual({ kind: "completed" });
  const requests = mock.requestsFor(h.name).map((r) => r.body);
  const decides = requests.filter((r) => r.text?.format?.name === "agent_turn");
  const prior = decides[2]!.input as unknown[];
  const before = decides[1]!.input as unknown[];
  expect(JSON.stringify(prior.slice(0, before.length))).toBe(JSON.stringify(before));
  expect(requests.filter((r) => r.text?.format?.name === "compaction_summary")).toHaveLength(1);
  expect(JSON.stringify(decides[3]!.input)).toContain("This run continues from a summary");
});

it("reports prefix eligibility from a bounded 32-turn DOM/computer replay", async () => {
  const read = {
    outputs: [
      {
        type: "function" as const,
        name: "read_page",
        args: { mode: "text", sinceHash: null, offset: null },
      },
    ],
  };
  const capture = {
    outputs: [
      {
        type: "function" as const,
        name: "capture",
        args: { scope: "page", selector: null, kind: null },
      },
    ],
  };
  const turns = [
    read,
    ...Array.from({ length: 10 }, (_, i) => [capture, click(10 + i, 20), read]).flat(),
    done(),
  ];
  const h = await setup(turns, { budget: { maxSteps: 150, maxUsd: 100, maxActiveMinutes: 60 } });
  let section = 0;
  h.browser.actionHook = () => {
    section++;
    h.browser.domHash = String(section).padStart(64, "0");
    h.browser.url = `http://site.fixtures.test/section/${section}`;
  };
  h.browser.functionOutput = (name) =>
    name === "read_page"
      ? JSON.stringify({ url: h.browser.url, text: "A verbatim educational passage. ".repeat(250) })
      : JSON.stringify({ noteId: "fixture-note", blockIds: ["fixture-block"] });
  expect(await drive(h.loop, 200)).toEqual({ kind: "completed" });
  const requests = mock.requestsFor(h.name).map((r) => r.body);
  const decides = requests.filter((r) => r.text?.format?.name === "agent_turn");
  expect(decides).toHaveLength(32);
  let previous = "";
  let total = 0;
  let reused = 0;
  for (const request of requests) {
    // Four characters per text token is an estimate, not an OpenAI tokenizer. Tiny fixture
    // images are excluded from any live-image cost claim. Include fixed prompt fields and
    // compaction calls; assume only the immediately preceding prefix remains cached.
    const serialized = JSON.stringify({
      instructions: request.instructions,
      tools: request.tools,
      text: request.text,
      input: request.input,
    });
    let prefix = 0;
    while (
      prefix < Math.min(previous.length, serialized.length) &&
      previous[prefix] === serialized[prefix]
    )
      prefix++;
    const tokens = Math.ceil(serialized.length / 4);
    const cached = prefix / 4 < 1024 ? 0 : Math.floor(prefix / 4 / 128) * 128;
    total += tokens;
    reused += cached;
    previous = serialized;
  }
  expect(reused / total).toBeGreaterThan(0.5);
  console.info(
    `F7 synthetic replay: ${decides.length} decides, ${requests.length - decides.length} compactions; estimated cached ${reused}/${total} (${((100 * reused) / total).toFixed(1)}%)`,
  );
});
