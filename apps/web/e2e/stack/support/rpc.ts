import type { APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./env.ts";

export interface RpcResponse {
  status: number;
  json: unknown;
  code: string | null;
}

/**
 * The oRPC RPC protocol over real HTTP (S1): POST /api/rpc/<router>/<procedure> with
 * {"json": input}, from the app's own Origin (the route refuses cross-site writes, E2).
 */
export async function rpcCall(
  request: APIRequestContext,
  path: string,
  input: unknown,
): Promise<RpcResponse> {
  const response = await request.post(`${BASE_URL}/api/rpc/${path}`, {
    headers: { "content-type": "application/json", origin: BASE_URL },
    data: { json: input },
    failOnStatusCode: false,
  });
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("application/json"))
    return { status: response.status(), json: null, code: null };
  const json = ((await response.json()) as { json?: unknown }).json ?? null;
  const code =
    response.status() >= 400 && json !== null && typeof json === "object" && "code" in json
      ? String((json as { code: unknown }).code)
      : null;
  return { status: response.status(), json, code };
}

export async function rpcOk<T>(
  request: APIRequestContext,
  path: string,
  input: unknown,
): Promise<T> {
  const result = await rpcCall(request, path, input);
  if (result.status !== 200)
    throw new Error(`${path} failed: HTTP ${result.status} ${result.code ?? ""}`);
  return result.json as T;
}
