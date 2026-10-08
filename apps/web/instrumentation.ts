export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebEnv } = await import("./lib/server/env.ts");
    const env = getWebEnv();
    // D50: Next.js owns the process, so crash handling only observes (spec §7.1).
    const [{ startTelemetry }, { createLogger }] = await Promise.all([
      import("@mastertutor/telemetry"),
      import("@mastertutor/contracts/server"),
    ]);
    startTelemetry({
      service: "web",
      env,
      crash: "observe",
      log: createLogger({ service: "web", level: env.LOG_LEVEL }),
    });
  }
}
