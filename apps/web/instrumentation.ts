export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWebEnv } = await import("./lib/server/env.ts");
    const env = getWebEnv();
    // D50: Next.js names its fetch spans after the full URL (a Web Push endpoint is a per-device
    // capability); without them the undici span ("POST", server.address only) is the record.
    process.env.NEXT_OTEL_FETCH_DISABLED = "1";
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
