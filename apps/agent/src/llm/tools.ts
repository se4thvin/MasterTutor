import { FUNCTION_TOOLS, FUNCTION_TOOL_NAMES, type FunctionToolName } from "@mastertutor/contracts";
import { zodResponsesFunction, type ResponsesTool } from "./openai.ts";

export const TOOL_DESCRIPTIONS: Record<FunctionToolName, string> = {
  read_page:
    "Read the current page. mode 'interactive' lists visible interactive elements with a ref, role, name, allowlisted attributes and a click point in screenshot pixels (null when off-screen or covered). mode 'text' returns the visible text. Pass sinceHash from a previous result to get {unchanged:true} when nothing changed.",
  capture:
    "Save page content verbatim into this run's note (text comes from the DOM or PDF, never from you). scope 'page', 'selection' or 'element' (with a CSS selector).",
  fill_credential:
    "Fill a login field from the vault. Give the vault alias, the field kind and the element ref of the input from read_page. You never see the secret; the result is {ok:true} or an error code.",
  use_passkey: "Sign in with the passkey stored under this vault alias for the current site.",
  video:
    "Work with the video on the page: 'captions', 'chapters', 'keyframes', or 'transcribe' when there are no captions.",
  annotate:
    "Add your own summary, commentary or heading to the note. It is shown as yours and never edits captured blocks.",
};

/** Exactly the 7 spec tools (spec §6): OpenAI's native computer tool plus six strict functions. */
export function agentTools(): ResponsesTool[] {
  return [
    { type: "computer" },
    ...FUNCTION_TOOL_NAMES.map((name) =>
      zodResponsesFunction({
        name,
        parameters: FUNCTION_TOOLS[name].args,
        description: TOOL_DESCRIPTIONS[name],
      }),
    ),
  ];
}
