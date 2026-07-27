import { describe, expect, it } from "vitest";
import { SeamMismatch, bypassNewOrigins, parseTrace } from "./evidence.ts";
import { computer, fill, observe, readPage, readPageFailed, traceOf } from "./trace-fixtures.ts";

const BOOK = "https://learn.example/book/1";

describe("parseTrace on real-shaped rows (X14)", () => {
  it("unwraps CallResult.output and the untrusted envelope into a ReadPageResult", () => {
    const trace = traceOf([observe(BOOK), readPage(BOOK, "3 of 3 activities completed")]);
    expect(trace.steps[1]!.readPage).toEqual({
      hash: "a".repeat(64),
      url: BOOK,
      title: "t",
      text: "3 of 3 activities completed",
    });
  });
  it("copies url and screenshot from the preceding observe step onto act steps", () => {
    const first = observe(BOOK);
    const trace = traceOf([first, computer({ type: "click", x: 5, y: 5, button: "left" })]);
    expect(trace.steps[1]).toMatchObject({
      url: BOOK,
      screenshotKey: first.screenshotKey,
      tool: "computer",
    });
  });
  it("counts only clicks, drags, keys and typing as interaction (P10b-7)", () => {
    const trace = traceOf([
      observe(BOOK),
      computer({ type: "click", x: 5, y: 5, button: "left" }),
      computer({ type: "double_click", x: 5, y: 5 }),
      computer({
        type: "drag",
        path: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
      computer({ type: "keypress", keys: ["ENTER"] }),
      computer({ type: "type", text: "answer" }),
      computer({ type: "scroll", x: 1, y: 1, scroll_x: 0, scroll_y: 300 }),
      computer({ type: "move", x: 1, y: 1 }),
      computer({ type: "wait" }),
      computer({ type: "screenshot" }),
    ]);
    expect(trace.steps.slice(1).map((s) => s.interaction)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
  it("reads fill_credential error codes and ignores tool errors as evidence", () => {
    const trace = traceOf([
      observe(BOOK),
      fill(null),
      fill("field_type_mismatch"),
      readPageFailed(),
    ]);
    expect(trace.steps.slice(1).map((s) => [s.credentialError, s.readPage])).toEqual([
      [null, null],
      ["field_type_mismatch", null],
      [null, null],
    ]);
  });
  it("throws SeamMismatch when a wrapped read_page result does not parse", () => {
    const bad = {
      ...readPage(BOOK, "x"),
      result: {
        kind: "function",
        output: '<untrusted_page_content origin="x">\nnot json\n</untrusted_page_content>',
      },
    };
    expect(() => traceOf([observe(BOOK), bad])).toThrow(SeamMismatch);
    expect(() => parseTrace("r", { status: "nope" })).toThrow(SeamMismatch);
  });
  it("lists new origins approved in bypass as breaches (P10b-22)", () => {
    const trace = traceOf([], {
      approvals: [
        {
          kind: "new_origin",
          status: "approved",
          decidedBy: "bypass",
          origin: "https://elsewhere.example",
          safetyCodes: [],
        },
        {
          kind: "new_origin",
          status: "denied",
          decidedBy: "policy",
          origin: "https://other.example",
          safetyCodes: [],
        },
      ],
    });
    expect(bypassNewOrigins(trace)).toEqual(["https://elsewhere.example"]);
  });
});
