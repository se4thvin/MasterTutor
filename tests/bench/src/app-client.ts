import type { ApiContract } from "@mastertutor/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";

export type BenchApi = ContractRouterClient<ApiContract>;

export class SignUpClosed extends Error {
  constructor() {
    super(
      "Sign-up is closed on this stack: an account already exists (v1 is one workspace). Sign in with that account's BENCH_EMAIL/BENCH_PASSWORD in .env.bench-account, or set AUTH_SIGNUP_OPEN=1 in .env.bench and restart web to add one.",
    );
    this.name = "SignUpClosed";
  }
}

/** The real Better Auth flow over HTTP (D47): no test hook, no seeded session. */
export async function authCookie(
  baseUrl: string,
  email: string,
  password: string,
  mode: "sign-in" | "sign-up",
): Promise<string> {
  const body = mode === "sign-up" ? { email, password, name: "Benchmark" } : { email, password };
  const response = await fetch(`${baseUrl}/api/auth/${mode}/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (mode === "sign-up" && response.status === 403) throw new SignUpClosed();
  if (!response.ok) throw new Error(`${mode} failed with HTTP ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (cookie === "") throw new Error(`${mode} returned no session cookie`);
  return cookie;
}

export function createApi(baseUrl: string, cookie: string): BenchApi {
  const link = new RPCLink({
    url: `${baseUrl}/api/rpc`,
    headers: () => ({ cookie, origin: baseUrl }),
  });
  return createORPCClient(link);
}

/** Spend from the product's own usage API (Task 0's usageReport: runs.usage by day, live while running). */
export async function spentUsd(api: BenchApi, since: string, today: string): Promise<number> {
  const report = await api.settings.usage({ from: since, to: today });
  return report.perDay.reduce((sum, day) => sum + day.usd, 0);
}
