import { scopeScreenToken } from "@mastertutor/contracts/server";
import { getWebEnv } from "../env.ts";
import { ServiceError } from "../service-error.ts";

export async function screenCaptureScope(
  workspaceId: string,
  text: string,
  options?: {
    url: string;
    token: string;
  },
): Promise<void> {
  if (!text) return;
  let safe: boolean;
  try {
    const token = options?.token ?? getWebEnv().OBSERVER_INTERNAL_TOKEN;
    if (!token) throw new Error("unavailable");
    const response = await fetch(options?.url ?? "http://agent:8788/scope-screen", {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopeScreenToken(token)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspaceId, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("unavailable");
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("safe" in result) ||
      typeof result.safe !== "boolean"
    )
      throw new Error("unavailable");
    safe = result.safe;
  } catch {
    throw new ServiceError(
      "conflict",
      "Secret screening is unavailable. Nothing was saved; try again shortly.",
    );
  }
  if (!safe)
    throw new ServiceError(
      "invalid",
      "Scope contains a saved secret. Remove it before saving; nothing was saved.",
    );
}
