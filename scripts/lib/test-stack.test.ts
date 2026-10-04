import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./test-stack.sh", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "mt-test-stack-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** The DC array test-stack.sh builds when sourced from a worktree root named `dir`. */
function dcFrom(dir: string, env: Record<string, string> = {}): string[] {
  const root = join(base, dir);
  mkdirSync(root, { recursive: true });
  const out = execFileSync("bash", ["-c", `source "${script}" && printf '%s\\n' "\${DC[@]}"`], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return out.trim().split("\n");
}

describe("scripts/lib/test-stack.sh compose project (review: per-worktree names)", () => {
  it("names the stack after the worktree, so one worktree's down -v never removes another's stack", () => {
    const dc = dcFrom("houndshark-p7g2");
    expect(dc.slice(0, 4)).toEqual(["docker", "compose", "-p", "mt-houndshark-p7g2"]);
    expect(dcFrom("My Worktree.v2").slice(2, 4)).toEqual(["-p", "mt-my-worktree-v2"]);
  });

  it("never exports the name: other compose tools run from the same shell keep their own (behaviour stack)", () => {
    const root = join(base, "no-export");
    mkdirSync(root, { recursive: true });
    const seen = execFileSync(
      "bash",
      ["-c", `source "${script}" && bash -c 'echo "\${COMPOSE_PROJECT_NAME:-unset}"'`],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    ).trim();
    expect(seen).toBe("unset");
  });

  it("keeps a name the caller set (the remote runner's per-run project)", () => {
    expect(
      dcFrom("houndshark-p7g2", { COMPOSE_PROJECT_NAME: "mt-run-abc123" }).slice(2, 4),
    ).toEqual(["-p", "mt-run-abc123"]);
  });
});

describe("stack_base_url (review M7)", () => {
  const baseUrl = (env: Record<string, string>, envTest: string): string => {
    const root = join(base, `port-${Object.keys(env).length}-${envTest.length}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".env.test"), envTest);
    return execFileSync("bash", ["-c", `source "${script}" && stack_base_url`], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    }).trim();
  };

  it("follows an exported TEST_HTTP_PORT, as Compose's interpolation does", () => {
    expect(baseUrl({ TEST_HTTP_PORT: "18181" }, "TEST_HTTP_PORT=18090\n")).toBe(
      "http://localhost:18181",
    );
  });

  it("falls back to .env.test, then to 18080", () => {
    expect(baseUrl({}, "TEST_HTTP_PORT=18090\n")).toBe("http://localhost:18090");
    expect(baseUrl({}, "OTHER=1\n")).toBe("http://localhost:18080");
  });
});
