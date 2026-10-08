import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CRASH = new URL("./crash.ts", import.meta.url).href;
const script = (mode: "exit" | "observe", fault: string) => `
import { installCrashHandlers } from ${JSON.stringify(CRASH)};
const log = {
  fatal: (o) => console.log(JSON.stringify(o)),
  error: (o) => console.log(JSON.stringify(o)),
};
installCrashHandlers(${JSON.stringify(mode)}, log, async () => { console.log("flushed"); });
setTimeout(() => { ${fault} }, 0);
`;
const run = (mode: "exit" | "observe", fault = 'throw new TypeError("boom page text");') =>
  spawnSync(process.execPath, ["--input-type=module", "-e", script(mode, fault)], {
    encoding: "utf8",
  });

describe("crash handlers (spec §7.1)", () => {
  it("exit mode logs the code, flushes, prints as Node does and exits 1", () => {
    const result = run("exit");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"errorCode":"uncaught_exception"');
    expect(result.stdout).toContain('"err":"TypeError"');
    expect(result.stdout).toContain("flushed");
    expect(result.stdout).not.toContain("boom page text");
    expect(result.stderr).toContain("TypeError");
  });

  it("an unhandled rejection takes the same path in exit mode", () => {
    const result = run("exit", 'Promise.reject(new RangeError("nope"));');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"origin":"unhandledRejection"');
    expect(result.stdout).toContain('"err":"RangeError"');
  });

  it("observe mode logs and leaves Node's own behaviour unchanged", () => {
    const result = run("observe");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"errorCode":"uncaught_exception"');
    expect(result.stderr).toContain("boom page text");
  });
});
