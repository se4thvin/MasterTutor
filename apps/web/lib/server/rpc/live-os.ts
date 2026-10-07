import { apiContract } from "@mastertutor/contracts";
import { implement } from "@orpc/server";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";
import { requireViewer, type SessionContext } from "./require-viewer.ts";

/** The session's viewer plus resHeaders from ResponseHeadersPlugin (B6: openLive sets cookies). */
export type LiveContext = SessionContext & ResponseHeadersPluginContext;

/** The live router's procedure builder: every procedure requires a viewer. */
export const liveOs = implement(apiContract).$context<LiveContext>().use(requireViewer);
