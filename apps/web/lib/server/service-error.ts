import { ORPCError } from "@orpc/server";

type ServiceErrorCode =
  "not_found" | "conflict" | "invalid" | "unauthorized" | "forbidden" | "too_many";

/**
 * Thrown by web services (runs, settings, the library). Services never
 * import oRPC; `served` maps the code to an ORPCError 1:1. Messages are user-facing and never
 * carry secrets or page text.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

const ORPC_CODES = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid: "BAD_REQUEST",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  too_many: "TOO_MANY_REQUESTS",
} as const satisfies Record<ServiceErrorCode, string>;

/** Runs one service call. A ServiceError becomes its ORPCError; anything else stays a 500 without detail. */
export async function served<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ServiceError)
      throw new ORPCError(ORPC_CODES[error.code], { message: error.message });
    throw error;
  }
}
