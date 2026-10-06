import { describe, expect, it } from "vitest";
import { strictSchemaProblems } from "./testing/strict-schema.ts";
import {
  CaptureArgs,
  ComputerAction,
  FUNCTION_TOOLS,
  ReadPageResult,
  TOOL_NAMES,
  VideoArgs,
} from "./tools.ts";

describe("tool list", () => {
  it("is exactly the 7 spec tools", () => {
    expect(TOOL_NAMES).toEqual([
      "computer",
      "read_page",
      "capture",
      "fill_credential",
      "use_passkey",
      "video",
      "annotate",
    ]);
    expect(TOOL_NAMES.some((name) => name.startsWith("exec"))).toBe(false);
    expect(["computer", ...Object.keys(FUNCTION_TOOLS)].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(Object.entries(FUNCTION_TOOLS))("%s args are strict-mode safe", (_name, tool) => {
    expect(strictSchemaProblems(tool.args)).toEqual([]);
  });
});

describe("ComputerAction", () => {
  it("accepts allowlisted actions and defaults the button", () => {
    expect(ComputerAction.parse({ type: "click", x: 10, y: 20 })).toEqual({
      type: "click",
      x: 10,
      y: 20,
      button: "left",
    });
    expect(ComputerAction.safeParse({ type: "keypress", keys: ["CTRL", "L"] }).success).toBe(true);
  });
  it("rejects unknown actions and off-screen coordinates", () => {
    expect(ComputerAction.safeParse({ type: "exec", code: "rm -rf /" }).success).toBe(false);
    expect(ComputerAction.safeParse({ type: "click", x: 1280, y: 0 }).success).toBe(false);
    expect(ComputerAction.safeParse({ type: "drag", path: [{ x: 1, y: 1 }] }).success).toBe(false);
  });
});

describe("other tool schemas", () => {
  it("capture of an element needs a selector", () => {
    expect(CaptureArgs.safeParse({ scope: "element", selector: null, kind: null }).success).toBe(
      false,
    );
    expect(CaptureArgs.safeParse({ scope: "page", selector: null, kind: "web" }).success).toBe(
      true,
    );
  });
  it("read_page keeps only allowlisted attributes", () => {
    const base = { hash: "a".repeat(64), url: "https://example.com/", title: "T" };
    expect(ReadPageResult.safeParse({ unchanged: true }).success).toBe(true);
    expect(
      ReadPageResult.safeParse({
        ...base,
        elements: [{ ref: "e1", tag: "a", role: "link", name: "Next", attrs: { href: "/next" } }],
      }).success,
    ).toBe(true);
    expect(
      ReadPageResult.safeParse({
        ...base,
        elements: [
          { ref: "e1", tag: "a", role: "link", name: "Next", attrs: { onclick: "steal()" } },
        ],
      }).success,
    ).toBe(false);
  });
  it("video ranges must move forward", () => {
    expect(VideoArgs.safeParse({ op: "keyframes", range: { start: 10, end: 5 } }).success).toBe(
      false,
    );
    expect(VideoArgs.safeParse({ op: "captions", range: null }).success).toBe(true);
  });
});
