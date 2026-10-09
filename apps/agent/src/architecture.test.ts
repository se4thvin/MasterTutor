import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

async function importsOf(dir: string): Promise<Array<{ file: string; from: string }>> {
  const files = (await readdir(join(SRC, dir))).filter((name) => name.endsWith(".ts"));
  const found: Array<{ file: string; from: string }> = [];
  for (const file of files) {
    const text = await readFile(join(SRC, dir, file), "utf8");
    for (const match of text.matchAll(/from "(\.\.\/[a-z-]+)\//g))
      found.push({ file: `${dir}/${file}`, from: match[1]! });
  }
  return found;
}

describe("module boundaries (CLAUDE.md principle 5: no circular dependencies)", () => {
  it("notes never import capture, video or pdf (preflight F15)", async () => {
    const banned = new Set(["../capture", "../video", "../pdf"]);
    expect((await importsOf("notes")).filter((entry) => banned.has(entry.from))).toEqual([]);
  });

  it("the agent reaches slot audio only through the audio-capture contract (B4 review I7)", async () => {
    const offenders: string[] = [];
    for (const dir of ["video", "loop", "tools", "capture", "notes", "browser", "vault", "live"]) {
      for (const file of (await readdir(join(SRC, dir))).filter((name) => name.endsWith(".ts"))) {
        const text = await readFile(join(SRC, dir, file), "utf8");
        for (const match of text.matchAll(/from "\.\.\/audio\/([a-z-]+)\.ts"/g))
          if (match[1] !== "protocol") offenders.push(`${dir}/${file} → audio/${match[1]}`);
        if (/node:child_process/.test(text) && /parec/.test(text))
          offenders.push(`${dir}/${file} runs parec`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guardrails depend on tools, never the other way round", async () => {
    expect((await importsOf("tools")).filter((entry) => entry.from === "../guardrails")).toEqual(
      [],
    );
  });
});

describe("approval modes reach only the approval decisions (D44 hard invariants)", () => {
  it("only the approval boundary reads the mode; browser, masking, vault and tools cannot", async () => {
    const readers: string[] = [];
    for (const dir of ["browser", "vault", "tools", "guardrails", "slots", "runtime"]) {
      const walk = async (path: string): Promise<void> => {
        for (const entry of await readdir(join(SRC, path), { withFileTypes: true })) {
          const child = join(path, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.name.endsWith(".ts") && !entry.name.includes(".test."))
            if (
              /approvalMode|ApprovalMode|BYPASS_DECI|decideByPolicy|policyDecider|decideSafetyChecks|AUTO_MODE_DECISIONS/.test(
                await readFile(join(SRC, child), "utf8"),
              )
            )
              readers.push(child);
        }
      };
      await walk(dir);
    }
    // So bypass mode cannot switch off the network policy, the sandbox, secret masking, the
    // vault's origin pinning, the kill switch or takeover: none of them can see the mode.
    // D52: the Observer is part of the approval boundary and can only tighten decisions.
    const approvalBoundary = new Set([
      "guardrails/observer/guard.ts",
      "guardrails/observer/types.ts",
    ]);
    expect(readers.filter((file) => !approvalBoundary.has(file))).toEqual([]);
  });
});

describe("the agent process holds no PDF parser (B5 review I-1)", () => {
  /** Every module main.ts loads, following relative imports; bare specifiers are collected. */
  async function agentGraph(): Promise<{ files: Set<string>; packages: Set<string> }> {
    const files = new Set<string>();
    const packages = new Set<string>();
    const visit = async (file: string): Promise<void> => {
      if (files.has(file)) return;
      files.add(file);
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        const spec = match[1]!;
        if (spec.startsWith(".")) await visit(resolve(dirname(file), spec));
        else packages.add(spec);
      }
    };
    await visit(join(SRC, "main.ts"));
    return { files, packages };
  }

  it("main.ts never reaches pdf.js, the canvas binding or the worker's code", async () => {
    const { files, packages } = await agentGraph();
    expect([...files].filter((file) => file.includes("/pdf/worker/"))).toEqual([]);
    expect([...packages].filter((pkg) => /^(pdfjs-dist|@napi-rs\/canvas)(\/|$)/.test(pkg))).toEqual(
      [],
    );
    // The client is reached: PDFs are sent to the pdf-worker service.
    expect([...files].some((file) => file.endsWith("/pdf/pdf-worker.ts"))).toBe(true);
  });
});

describe("tool profiles stay out of the browser and the vault (pre-flight §3.3(d))", () => {
  it("browser/ and vault/ never read the tool profile", async () => {
    const readers: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(join(SRC, path), { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test."))
          if (
            /toolProfile|ToolProfile|TOOL_PROFILE|isToolInProfile/.test(
              await readFile(join(SRC, child), "utf8"),
            )
          )
            readers.push(child);
      }
    };
    for (const dir of ["browser", "vault"]) await walk(dir);
    expect(readers).toEqual([]);
  });
});
