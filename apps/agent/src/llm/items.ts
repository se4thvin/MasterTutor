import {
  AgentTurn,
  ComputerAction,
  FUNCTION_TOOLS,
  FUNCTION_TOOL_NAMES,
  pointerOf,
  type FunctionToolName,
  type StepAction,
} from "@mastertutor/contracts";
import type { ResponseInputItem } from "./openai.ts";

export interface SafetyCheck {
  id: string;
  code: string | null;
  message: string | null;
}

export type PendingCall =
  | {
      kind: "computer";
      callId: string;
      actions: ComputerAction[];
      safetyChecks: SafetyCheck[];
      invalid: string | null;
    }
  | { kind: "function"; callId: string; name: string; args: unknown; invalid: string | null };

export interface ParsedOutput {
  turn: AgentTurn | null;
  calls: PendingCall[];
}

type Loose = Record<string, unknown>;
export const isFunctionTool = (name: string): name is FunctionToolName =>
  (FUNCTION_TOOL_NAMES as readonly string[]).includes(name);

function parseComputer(item: Loose): PendingCall {
  const callId = String(item.call_id ?? "");
  const raw = Array.isArray(item.actions) ? item.actions : item.action ? [item.action] : [];
  const checks = Array.isArray(item.pending_safety_checks)
    ? (item.pending_safety_checks as Loose[])
    : [];
  const safetyChecks = checks.map((check) => ({
    id: String(check.id ?? ""),
    code: typeof check.code === "string" ? check.code : null,
    message: typeof check.message === "string" ? check.message.slice(0, 500) : null,
  }));
  const actions: ComputerAction[] = [];
  for (const candidate of raw) {
    const parsed = ComputerAction.safeParse(candidate);
    if (!parsed.success)
      return {
        kind: "computer",
        callId,
        actions: [],
        safetyChecks,
        invalid: "an action is not allowed or is out of range",
      };
    actions.push(parsed.data);
  }
  return {
    kind: "computer",
    callId,
    actions,
    safetyChecks,
    invalid: actions.length === 0 ? "no actions" : null,
  };
}

function parseFunction(item: Loose): PendingCall {
  const callId = String(item.call_id ?? "");
  const name = String(item.name ?? "");
  if (!isFunctionTool(name))
    return {
      kind: "function",
      callId,
      name,
      args: null,
      invalid: `unknown tool ${name.slice(0, 40)}`,
    };
  let json: unknown;
  try {
    json = JSON.parse(String(item.arguments ?? ""));
  } catch {
    return { kind: "function", callId, name, args: null, invalid: "arguments are not valid JSON" };
  }
  const parsed = FUNCTION_TOOLS[name].args.safeParse(json);
  return parsed.success
    ? { kind: "function", callId, name, args: parsed.data, invalid: null }
    : {
        kind: "function",
        callId,
        name,
        args: null,
        invalid: "arguments do not match the tool schema",
      };
}

function parseTurn(item: Loose): AgentTurn | null {
  const content = Array.isArray(item.content) ? (item.content as Loose[]) : [];
  const text = content
    .filter((part) => part.type === "output_text")
    .map((part) => String(part.text ?? ""))
    .join("");
  if (!text) return null;
  try {
    const parsed = AgentTurn.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseModelOutput(output: readonly unknown[]): ParsedOutput {
  let turn: AgentTurn | null = null;
  const calls: PendingCall[] = [];
  for (const raw of output) {
    const item = raw as Loose;
    if (item.type === "computer_call") calls.push(parseComputer(item));
    else if (item.type === "function_call") calls.push(parseFunction(item));
    else if (item.type === "message") turn = parseTurn(item) ?? turn;
  }
  return { turn, calls };
}

export const pngDataUrl = (png: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

export function computerCallOutput(
  callId: string,
  dataUrl: string,
  acknowledged: readonly SafetyCheck[],
): ResponseInputItem {
  return {
    type: "computer_call_output",
    call_id: callId,
    output: { type: "computer_screenshot", image_url: dataUrl },
    ...(acknowledged.length > 0
      ? { acknowledged_safety_checks: acknowledged.map((check) => ({ ...check })) }
      : {}),
  };
}

export function functionCallOutput(callId: string, output: string): ResponseInputItem {
  return { type: "function_call_output", call_id: callId, output };
}

export function userMessage(
  texts: readonly string[],
  imageDataUrl: string | null,
): ResponseInputItem {
  return {
    role: "user",
    content: [
      ...texts.map((text) => ({ type: "input_text" as const, text })),
      ...(imageDataUrl
        ? [{ type: "input_image" as const, image_url: imageDataUrl, detail: "original" as const }]
        : []),
    ],
  };
}

function summarizeAction(action: ComputerAction): string {
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
      return `${action.type.replace("_", " ")} (${action.x}, ${action.y})`;
    case "drag":
      return `drag ${action.path.length} points`;
    case "scroll":
      return `scroll ${action.scroll_y > 0 ? "down" : action.scroll_y < 0 ? "up" : "sideways"}`;
    case "keypress":
      return `press ${action.keys.join("+")}`.slice(0, 80);
    case "type":
      return `type "${action.text.slice(0, 40)}${action.text.length > 40 ? "…" : ""}"`;
    case "wait":
      return "wait";
    case "screenshot":
      return "look at the screen";
  }
}

/** What the timeline shows; the point (CSS pixels) drives the overlay cursor. */
export function describeCall(call: PendingCall, scale: number): StepAction | null {
  if (call.kind === "function")
    return isFunctionTool(call.name)
      ? { tool: call.name, summary: call.name.replace("_", " "), point: null }
      : null;
  const first = call.actions[0];
  if (!first) return null;
  const more = call.actions.length > 1 ? ` (+${call.actions.length - 1} more)` : "";
  const point =
    "x" in first ? { x: Math.round(first.x / scale), y: Math.round(first.y / scale) } : null;
  const pointer = pointerOf(first);
  return {
    tool: "computer",
    summary: `${summarizeAction(first)}${more}`.slice(0, 300),
    point,
    ...(pointer ? { pointer } : {}),
  };
}

export function callSignature(call: PendingCall): string {
  return call.kind === "computer"
    ? JSON.stringify(call.actions)
    : `${call.name}:${JSON.stringify(call.args)}`;
}
