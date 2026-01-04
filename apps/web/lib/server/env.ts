import { WebEnv, parseEnv } from "@mastertutor/contracts";

let cached: WebEnv | undefined;

/** Parsed once per process; instrumentation.ts calls it at server start so bad env fails fast. */
export function getWebEnv(): WebEnv {
  cached ??= parseEnv(WebEnv, process.env);
  return cached;
}
