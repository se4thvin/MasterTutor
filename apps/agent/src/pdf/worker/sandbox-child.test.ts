import type * as childProcess from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CHILD_OUTPUT_BYTES, runInSandbox, SandboxFailed } from "./sandbox.ts";

// The real spawn, observed: its options, and (per test) the child's script swapped for a stand-in
// that misbehaves the way a compromised or broken pdf.js child could (QA-106).
const spawned: Array<{ args: readonly string[]; env: unknown }> = [];
let script: string | null = null;
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>();
  return {
    ...real,
    spawn: (command: string, args: readonly string[], options: childProcess.SpawnOptions) => {
      spawned.push({ args, env: options.env });
      const run = script === null ? args : [...args.slice(0, -1), "-e", script];
      return real.spawn(command, run, options);
    },
  };
});
beforeEach(() => {
  spawned.length = 0;
  script = null;
});

const options = { render: "auto" as const, scale: 2 };
const pdf = new TextEncoder().encode("%PDF-1.7\n");
const live = () => new AbortController().signal;

describe("runInSandbox's child (QA-106)", () => {
  it("spawns the child with an empty environment under the permission model", async () => {
    process.env.MT_SANDBOX_CANARY = "must-not-reach-the-child";
    try {
      await runInSandbox(options, pdf, live());
    } finally {
      delete process.env.MT_SANDBOX_CANARY;
    }
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.env).toEqual({});
    expect(spawned[0]!.args).toContain("--permission");
    expect(spawned[0]!.args).toContain("--disallow-code-generation-from-strings");
  });
  it("rejects output that is off-schema or not JSON", async () => {
    script =
      "process.stdout.write(JSON.stringify({ ok: true, title: null, pages: 'x', renders: [] }))";
    await expect(runInSandbox(options, pdf, live())).rejects.toBeInstanceOf(SandboxFailed);
    script = "process.stdout.write('not json')";
    await expect(runInSandbox(options, pdf, live())).rejects.toBeInstanceOf(SandboxFailed);
  });
  it("kills a child that writes more than MAX_CHILD_OUTPUT_BYTES", async () => {
    const chunks = Math.ceil(MAX_CHILD_OUTPUT_BYTES / (1 << 20)) + 8;
    script = `const b = Buffer.alloc(1 << 20, 97); let i = 0;
      const more = () => { while (i < ${chunks}) { i++; if (!process.stdout.write(b)) return process.stdout.once('drain', more); } };
      more(); setInterval(() => {}, 1000);`;
    await expect(runInSandbox(options, pdf, live())).rejects.toBeInstanceOf(SandboxFailed);
  }, 60_000);
  it("kills a hung child when the run is cancelled, at once", async () => {
    script = "setInterval(() => {}, 1000)";
    const controller = new AbortController();
    const pending = runInSandbox(options, pdf, controller.signal);
    setTimeout(() => controller.abort(new Error("killed")), 200);
    const started = performance.now();
    await expect(pending).rejects.toThrow("killed");
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
