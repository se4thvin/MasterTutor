import type { ApiContract } from "@mastertutor/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const link = new RPCLink({ url: () => `${window.location.origin}/api/rpc` });

/** Typed client for every apiContract procedure. Call directly for secret-bearing requests. */
export const api: ContractRouterClient<ApiContract> = createORPCClient(link);

/** TanStack Query helpers: orpc.notes.list.queryOptions({ input }), orpc.notes.key(), … */
export const orpc = createTanstackQueryUtils(api);
