import { describe, expect, it } from "vitest";
import { TurnContext } from "./turn-context.ts";
import type { TranscriptEntry } from "./transcript.ts";

const NOTE =
  "Executor: the same action with the same arguments had no effect three times in a row. The page hash is unchanged; try something else.";
const start = () => {
  const context = new TurnContext([]);
  context.observeActions([], "page");
  context.accept();
  return context;
};

function restore(context: TurnContext): TurnContext {
  const entry: TranscriptEntry = {
    dir: "in",
    item: {},
    responseId: null,
    userEventId: null,
    turnContext: context.checkpoint(),
  };
  return new TurnContext([entry]);
}

describe("D56 ineffective action feedback", () => {
  it("emits one note at three and does not lose it on an uncommitted retry or compaction", () => {
    const context = start();
    for (let i = 0; i < 2; i++) {
      context.observeActions(["click"], "page");
      expect(context.messages()).toEqual([]);
      context.accept();
    }
    context.observeActions(["click"], "page");
    expect(context.messages()).toEqual([NOTE]);
    expect(context.messages(true)).toEqual([NOTE]);
    context.observeActions(["click"], "page"); // previous input was aborted
    expect(context.messages()).toEqual([NOTE]);
    context.accept();
    context.observeActions(["click"], "page");
    expect(context.messages()).toEqual([]);
  });

  it("counts across worker restore without storing action arguments or page details", () => {
    let context = start();
    for (let i = 0; i < 2; i++) {
      context.observeActions(["PRIVATE_TEST_ARGUMENT"], "page");
      context.accept();
      context = restore(context);
    }
    context.observeActions(["PRIVATE_TEST_ARGUMENT"], "page");
    expect(context.messages()).toEqual([NOTE]);
    expect(JSON.stringify(context.checkpoint())).not.toContain("PRIVATE_TEST_ARGUMENT");
  });

  it("resets on changed arguments or a changed page", () => {
    const context = start();
    for (const [action, page] of [
      ["a", "page"],
      ["a", "page"],
      ["b", "page"],
      ["b", "next"],
      ["b", "next"],
    ]) {
      context.observeActions([action!], page!);
      expect(context.messages()).toEqual([]);
      context.accept();
    }
  });

  it("notices three identical actions in one batch and emits only one note", () => {
    const context = start();
    context.observeActions(["click", "click", "click", "click"], "page");
    expect(context.messages()).toEqual([NOTE]);
  });
});
