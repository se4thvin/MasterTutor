export interface BenchInspect {
  State?: { Running?: boolean };
  Config?: { Labels?: Record<string,string>; Env?: string[] };
}
/** Refuse a stopped, production, or non-agent container before selecting the authorized key. */
export function authorizedKey(bench: BenchInspect): string {
  if (!bench.State?.Running || bench.Config?.Labels?.["com.docker.compose.service"] !== "agent" || bench.Config.Labels["com.docker.compose.project"] !== "mastertutor-bench") throw new Error("not the running bench agent");
  const key = bench.Config.Env?.find(value => value.startsWith("OPENAI_API_KEY="))?.slice("OPENAI_API_KEY=".length);
  if (!key || key.length < 20 || key.length > 2048) throw new Error("key absent");
  return key;
}
