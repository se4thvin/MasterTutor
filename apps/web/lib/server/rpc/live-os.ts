import { apiContract } from "@mastertutor/contracts";
import { implement } from "@orpc/server";
import { requireViewer, type SessionContext } from "./require-viewer.ts";

export type LiveContext = SessionContext;

/** The live router's procedure builder: every procedure requires a viewer. */
export const liveOs = implement(apiContract).$context<LiveContext>().use(requireViewer);
