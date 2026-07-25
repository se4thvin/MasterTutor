import type { HandBackInput, OpenLiveResult, RunRef } from "@mastertutor/contracts";
import { requestHandBack, requestTakeover, type ControlRequestResult } from "@mastertutor/db";
import { ORPCError } from "@orpc/server";
import { RUN_MESSAGES } from "../runs/messages.ts";
import { LiveAccessError, openLive, type LiveDeps } from "./open-live.ts";

/** What liveRouter's handlers receive after requireViewer; resHeaders comes from ResponseHeadersPlugin. */
interface LiveHandlerContext {
  viewer: { id: string };
  resHeaders?: Headers;
}

function accessError(error: LiveAccessError): Error {
  switch (error.code) {
    case "not_found":
      return new ORPCError("NOT_FOUND", { message: "Run not found" });
    case "in_use":
      return new ORPCError("CONFLICT", { message: "The live view is open in another tab" });
    case "unavailable":
      return new ORPCError("SERVICE_UNAVAILABLE", {
        message: "The browser is not answering; retry shortly",
      });
  }
}

function controlError(result: Extract<ControlRequestResult, { ok: false }>): Error {
  switch (result.reason) {
    case "not_found":
      return new ORPCError("NOT_FOUND", { message: "Run not found" });
    case "finished":
      return new ORPCError("CONFLICT", { message: RUN_MESSAGES.runFinished });
    case "not_controller":
      return new ORPCError("FORBIDDEN", { message: "Another member is in control of this run" });
  }
}

/** runs.openLive / takeControl / handBack for the one RPC router (E1). deps is read per call. */
export function createLiveHandlers(deps: () => LiveDeps) {
  return {
    async openLive(input: RunRef, context: LiveHandlerContext): Promise<OpenLiveResult> {
      const resHeaders = context.resHeaders;
      if (!resHeaders)
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "runs.openLive needs ResponseHeadersPlugin",
        });
      try {
        const outcome = await openLive(deps(), { runId: input.runId, userId: context.viewer.id });
        for (const cookie of outcome.setCookies) resHeaders.append("set-cookie", cookie);
        return outcome.result;
      } catch (error) {
        if (error instanceof LiveAccessError) throw accessError(error);
        throw error;
      }
    },
    async takeControl(input: RunRef, context: LiveHandlerContext): Promise<{ ok: true }> {
      const result = await requestTakeover(deps().db, {
        runId: input.runId,
        userId: context.viewer.id,
      });
      if (!result.ok) throw controlError(result);
      return { ok: true };
    },
    async handBack(input: HandBackInput, context: LiveHandlerContext): Promise<{ ok: true }> {
      const result = await requestHandBack(deps().db, {
        runId: input.runId,
        userId: context.viewer.id,
        note: input.note,
        keep: input.keep,
      });
      if (!result.ok) throw controlError(result);
      return { ok: true };
    },
  };
}
