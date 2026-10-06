import type { ApiContract } from "@mastertutor/contracts";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { endSession } from "../auth/session-end.ts";
import { errorCode } from "./errors.ts";

const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
  // Every call passes here, reads and direct writes alike, so an ended session is handled once.
  // Only the error is read; inputs (which may carry secrets) are never touched.
  interceptors: [
    onError((error) => {
      if (errorCode(error) === "UNAUTHORIZED") endSession();
    }),
  ],
});

/** Typed client for every apiContract procedure. Call directly for secret-bearing requests. */
export const api: ContractRouterClient<ApiContract> = createORPCClient(link);

/** TanStack Query helpers: orpc.notes.list.queryOptions({ input }), orpc.notes.key(), … */
export const orpc = createTanstackQueryUtils(api);
