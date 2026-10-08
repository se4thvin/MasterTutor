import { inspect } from "node:util";
import { getTelemetry } from "./handle.ts";

export type CrashMode = "exit" | "observe";
type CrashLog = {
  fatal(fields: object, message: string): void;
  error(fields: object, message: string): void;
};

const nameOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "unknown";
let installed = false;

/**
 * Crash handling (spec §7.1). "exit" (agent): log the code, flush (≤ 2 s), print the error as Node
 * does and exit 1, which is today's behaviour plus a log line and a flush; with Node's default
 * --unhandled-rejections=throw, rejections arrive here too. "observe" (web): Next.js owns the
 * process, so only a monitor listener is added and nothing about exiting changes.
 */
export function installCrashHandlers(
  mode: CrashMode,
  log: CrashLog,
  flush: () => Promise<void> = () => getTelemetry().flush(2_000),
): void {
  if (installed) return;
  installed = true;
  if (mode === "observe") {
    process.on("uncaughtExceptionMonitor", (error, origin) => {
      log.error(
        { errorCode: "uncaught_exception", origin, err: nameOf(error) },
        "uncaught exception",
      );
      void flush().catch(() => undefined);
    });
    return;
  }
  let crashing = false;
  process.on("uncaughtException", (error, origin) => {
    if (crashing) process.exit(1);
    crashing = true;
    log.fatal(
      { errorCode: "uncaught_exception", origin, err: nameOf(error) },
      "uncaught exception",
    );
    void flush()
      .catch(() => undefined)
      .finally(() => {
        process.stderr.write(`${inspect(error)}\n`);
        process.exit(1);
      });
  });
}
