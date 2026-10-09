import { describe, expect, it } from "vitest";
import { strictSchemaProblems } from "./testing/strict-schema.ts";
import {
  CaptureArgs,
  CREDENTIAL_ERROR_CODES,
  FillCredentialArgs,
  FOCUSED_TARGET,
  FUNCTION_TOOLS,
  isToolInProfile,
  ReadPageElement,
  ReadPageResult,
  TOOL_PROFILE_TOOLS,
  VideoArgs,
} from "./tools.ts";
import { BLOCK_ORIGINS, BlockOrigin } from "./enums.ts";
import { ComputerAction, TOOL_NAMES, ToolName } from "./tool-call.ts";

describe("tool list", () => {
  it("rejects model-authored note blocks and the annotate tool (D55.1)", () => {
    expect(BLOCK_ORIGINS).not.toContain("model");
    expect(BlockOrigin.safeParse("model").success).toBe(false);
    expect(BlockOrigin.safeParse("ocr_model").success).toBe(true);
    expect(TOOL_NAMES).not.toContain("annotate");
    expect(ToolName.safeParse("annotate").success).toBe(false);
    expect(FUNCTION_TOOLS).not.toHaveProperty("annotate");
    for (const tools of Object.values(TOOL_PROFILE_TOOLS)) {
      expect(tools).not.toContain("annotate");
    }
  });
  it("is exactly the 6 agent tools", () => {
    expect(TOOL_NAMES).toEqual([
      "computer",
      "read_page",
      "capture",
      "fill_credential",
      "use_passkey",
      "video",
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
        elements: [
          {
            ref: "e1",
            tag: "a",
            role: "link",
            name: "Next",
            attrs: { href: "/next" },
            point: { x: 5, y: 5 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      ReadPageResult.safeParse({
        ...base,
        elements: [
          {
            ref: "e1",
            tag: "a",
            role: "link",
            name: "Next",
            attrs: { onclick: "steal()" },
            point: { x: 5, y: 5 },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("read_page elements need a point (or null)", () => {
    const base = { hash: "a".repeat(64), url: "https://example.com/", title: "T" };
    const element = { ref: "e1", tag: "a", role: "link", name: "Next", attrs: {} };
    expect(ReadPageResult.safeParse({ ...base, elements: [element] }).success).toBe(false);
    expect(
      ReadPageResult.safeParse({ ...base, elements: [{ ...element, point: null }] }).success,
    ).toBe(true);
  });
  it("video ranges must move forward", () => {
    expect(VideoArgs.safeParse({ op: "keyframes", range: { start: 10, end: 5 } }).success).toBe(
      false,
    );
    expect(VideoArgs.safeParse({ op: "captions", range: null }).success).toBe(true);
  });
});

describe("tool profiles (Phase 10)", () => {
  it("browser_use is the full product tool list", () => {
    expect(TOOL_PROFILE_TOOLS.browser_use).toEqual(TOOL_NAMES);
  });
  it("computer_use is pixels plus the vault-only credential tools", () => {
    expect(TOOL_PROFILE_TOOLS.computer_use).toEqual(["computer", "fill_credential", "use_passkey"]);
    expect(isToolInProfile("computer_use", "read_page")).toBe(false);
    expect(isToolInProfile("computer_use", "capture")).toBe(false);
    expect(isToolInProfile("computer_use", "fill_credential")).toBe(true);
    expect(isToolInProfile("browser_use", "read_page")).toBe(true);
  });
});

describe("fill_credential target", () => {
  it.each(["e1", "e123456", FOCUSED_TARGET])("accepts %s", (target) => {
    expect(FillCredentialArgs.safeParse({ alias: "zz", field: "password", target }).success).toBe(
      true,
    );
  });
  it.each(["Focused", "body", "e", "e1234567", "#password"])("rejects %s", (target) => {
    expect(FillCredentialArgs.safeParse({ alias: "zz", field: "password", target }).success).toBe(
      false,
    );
  });
  it("has an error code for a focused fill with nothing focused", () => {
    expect(CREDENTIAL_ERROR_CODES).toContain("no_focused_field");
  });
});

describe("read_page elements (P10a-2)", () => {
  it("carry a click point and no separate box", () => {
    expect(Object.keys(ReadPageElement.shape)).toContain("point");
    expect(Object.keys(ReadPageElement.shape)).not.toContain("box");
  });
});
