export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebEnv } = await import("./lib/server/env.ts");
    getWebEnv();
  }
}
