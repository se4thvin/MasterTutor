import {
  FUNCTION_TOOLS,
  FUNCTION_TOOL_NAMES,
  isToolInProfile,
  READ_PAGE_MAX_ELEMENTS,
  type FunctionToolName,
  type ToolProfile,
} from "@mastertutor/contracts";
import { zodResponsesFunction, type ResponsesTool } from "./openai.ts";

export const TOOL_DESCRIPTIONS: Record<FunctionToolName, string> = {
  read_page: `Read the current page. mode 'interactive' lists visible interactive elements with a ref, role, name, allowlisted attributes and a click point in screenshot pixels (null when off-screen or covered). mode 'text' returns the visible text. Pass sinceHash from a previous result to get {unchanged:true} when nothing changed. Interactive results hold at most ${READ_PAGE_MAX_ELEMENTS} elements; when total is larger, call again with offset 0, ${READ_PAGE_MAX_ELEMENTS}, ${2 * READ_PAGE_MAX_ELEMENTS}, … to list them all in document order, else pass offset null. A [collapsed] element hides content until it is expanded.`,
  capture:
    "Save page content verbatim into this run's note (text comes from the DOM or PDF, never from you). scope 'page', 'selection' or 'element' (with a CSS selector).",
  fill_credential:
    'Fill a login field from the vault. Give the vault alias, the field kind and the target: the element ref of the input from read_page, or "focused" for the input that has keyboard focus. You never see the secret; the result is {ok:true} or an error code.',
  use_passkey: "Sign in with the passkey stored under this vault alias for the current site.",
  video:
    "Work with the video on the page: 'captions', 'chapters', 'keyframes', or 'transcribe' when there are no captions.",
  annotate:
    "Add your own summary, commentary or heading to the note. It is shown as yours and never edits captured blocks.",
};

/** computer_use has no read_page, so a credential field is clicked first and named "focused". */
const FILL_FOCUSED =
  'Fill a login field from the vault. Click the input first, then give the vault alias, the field kind and target "focused". You never see the secret; the result is {ok:true} or an error code.';

/** The run's tools (spec §6, Phase 10): OpenAI's native computer tool plus the profile's strict functions. */
export function agentTools(profile: ToolProfile): ResponsesTool[] {
  return [
    ...(isToolInProfile(profile, "computer") ? [{ type: "computer" as const }] : []),
    ...FUNCTION_TOOL_NAMES.filter((name) => isToolInProfile(profile, name)).map((name) =>
      zodResponsesFunction({
        name,
        parameters: FUNCTION_TOOLS[name].args,
        description:
          name === "fill_credential" && profile === "computer_use"
            ? FILL_FOCUSED
            : TOOL_DESCRIPTIONS[name],
      }),
    ),
  ];
}
