/**
 * Tool names and the computer tool's action allowlist. Their own module, not ./tools.ts, so approval
 * cards and run events (in client bundles) can parse them without pulling every tool's argument and
 * result schemas.
 */
import { z } from "zod";
import { VIEWPORT } from "./constants.ts";

/** Exactly these tools reach the model (spec §6). There is no exec_* tool. */
export const TOOL_NAMES = [
  "computer",
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
  "annotate",
] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;

const X = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.width - 1);
const Y = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.height - 1);
const Point = z.object({ x: X, y: Y });
const ScrollDelta = z.number().int().min(-10_000).max(10_000);

export const COMPUTER_ACTION_TYPES = [
  "click",
  "double_click",
  "drag",
  "move",
  "scroll",
  "keypress",
  "type",
  "wait",
  "screenshot",
] as const;
/** Allowlist over OpenAI's native computer_call actions; anything else is rejected. */
export const ComputerAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: X,
    y: Y,
    button: z.enum(["left", "right", "wheel", "back", "forward"]).default("left"),
  }),
  z.object({ type: z.literal("double_click"), x: X, y: Y }),
  z.object({ type: z.literal("drag"), path: z.array(Point).min(2).max(100) }),
  z.object({ type: z.literal("move"), x: X, y: Y }),
  z.object({ type: z.literal("scroll"), x: X, y: Y, scroll_x: ScrollDelta, scroll_y: ScrollDelta }),
  z.object({ type: z.literal("keypress"), keys: z.array(z.string().min(1).max(32)).min(1).max(8) }),
  z.object({ type: z.literal("type"), text: z.string().max(5_000) }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("screenshot") }),
]);
export type ComputerAction = z.infer<typeof ComputerAction>;
