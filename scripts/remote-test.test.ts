import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("./remote-test.sh");
const host = read("./remote-test/run-on-host.sh");
const readme = read("./README.md");
const words = (name: string, text: string) =>
  new RegExp(`^${name}="([^"]+)"$`, "m").exec(text)?.[1]?.split(" ") ?? [];
const suites = words("suites", client);
const allSuites = words("all_suites", client);
const cwd = new URL("..", import.meta.url);

/** Runs a script from the repo root; never reaches git, rsync or ssh when arguments are refused. */
function script(path: string, args: string[], env: Record<string, string> = {}) {
  const { MT_CI_MAX_STACKS: _, ...base } = process.env;
  return spawnSync("bash", [path, ...args], { cwd, encoding: "utf8", env: { ...base, ...env } });
}

/** Calls slots.sh functions; returns stdout and the exit status. */
function slots(command: string) {
  const result = spawnSync("bash", ["-c", `source scripts/remote-test/slots.sh && ${command}`], {
    cwd,
    encoding: "utf8",
  });
  return { out: result.stdout.trim(), status: result.status };
}
const vars = (text: string) =>
  Object.fromEntries(text.split("\n").map((line) => line.split("=") as [string, string]));
const slotEnv = (slot: number) => vars(slots(`slot_networks ${slot} && slot_ports ${slot}`).out);
const overlaps = (a: string, b: string) => slots(`cidr_overlaps ${a} ${b}`).status === 0;

/**
 * slots.sh and snapshot.sh run only on the Linux CI host, which has flock and bash 4+ (`exec {fd}>`).
 * A stock Mac has neither, so the cases that execute them run where those exist (the host, Linux
 * CI) and are skipped on a laptop; the static checks run everywhere.
 */
const hostShell =
  spawnSync("bash", ["-c", "command -v flock >/dev/null && ((BASH_VERSINFO[0] >= 4))"]).status ===
  0;

describe("host-only script cases", () => {
  it.runIf(process.env["MT_CI_RUN_ID"] !== undefined)(
    "run on the CI host, never silently skipped there",
    () => {
      expect(hostShell).toBe(true);
    },
  );
});

describe("remote test runner (D45, X4, D48)", () => {
  it("offers the full-stack suites beside the Vitest, image and fixture UI suites", () => {
    expect(suites).toEqual([
      "unit",
      "integration",
      "security",
      "web-build",
      "agent-image",
      "behaviour",
      "ui",
      "e2e",
      "smoke",
      "qa",
      "bench-mock",
    ]);
  });

  it("runs every suite but the long-lived qa stack under `all`", () => {
    expect(allSuites).toEqual(suites.filter((suite) => suite !== "qa"));
    expect(readme).toContain("scripts/remote-test.sh all");
  });

  it("handles and documents every suite it offers", () => {
    for (const suite of suites) {
      expect(host, suite).toMatch(new RegExp(`(^|[ (|])${suite}( \\||\\))`, "m"));
      expect(readme, suite).toContain(`scripts/remote-test.sh ${suite}`);
    }
  });

  it("runs the fixture UI suite with Playwright args and brings its reports back", () => {
    expect(host).toContain('exec pnpm --filter @mastertutor/web test:ui \\"\\$@\\"');
    expect(client).toMatch(
      /ui\) fetch apps\/web\/playwright-report && fetch apps\/web\/test-results && fetch apps\/web\/e2e\/visual\.spec\.ts-snapshots/,
    );
  });

  it("runs fixture-mode UI (visual baselines included) only as the slotted ui suite, never under qa's lock (I3)", () => {
    const qaStack = read("./qa-stack.sh");
    expect(qaStack).not.toMatch(/^ {2}ui\)/m);
    expect(qaStack).not.toContain('playwright test "$@"');
    expect(client).toMatch(/^ {4}e2e \| qa\) fetch apps\/web\/e2e\/\.out ;;$/m);
  });

  it("refuses an unknown suite, arguments to `all` and a bad concurrency before any sync", () => {
    for (const [args, env] of [
      [["nope"], {}],
      [[], {}],
      [["all", "--shard=1/2"], {}],
      [["unit"], { MT_CI_MAX_STACKS: "0" }],
      [["unit"], { MT_CI_MAX_STACKS: "many" }],
    ] as const) {
      const result = script("scripts/remote-test.sh", [...args], env);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stdout).toBe("");
    }
  });

  it("refuses bad runs on the host before touching Docker", () => {
    for (const [args, env] of [
      [["unit", "Bad_Project"], {}],
      [["nope", "mt-check-1"], {}],
      [["smoke", "mt-check-1", "--extra"], {}],
      [["unit", "mt-check-1"], { MT_CI_MAX_STACKS: "31" }],
    ] as const) {
      const result = script("scripts/remote-test/run-on-host.sh", [...args], {
        ...env,
        PATH: "/nonexistent-no-docker:/usr/bin:/bin",
      });
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr, args.join(" ")).toMatch(/^remote-test: /);
    }
  });

  it("keeps the legacy stack lock for qa only; stack suites hold a slot instead", () => {
    expect(host).toContain('stack_lock="$runs_dir/stack.lock"');
    expect(host).not.toContain("behaviour.lock");
    expect(host).toMatch(
      /^ {2}behaviour \| ui \| e2e \| smoke \| bench-mock\)\n {4}acquire_slot /m,
    );
    expect(host).toMatch(/^ {2}qa\)\n {4}take_stack_lock$/m);
  });
});

describe("stack slots (scripts/remote-test/slots.sh, D48)", () => {
  it("lists host subnets even when another run removes a network mid-scan", () => {
    // A fake docker: `ls` names two networks, the second is gone by the time it is inspected.
    const docker = `docker() { case "$1 $2" in
      "network ls") printf 'n1\\nn2\\n' ;;
      "network inspect") [[ "\${@: -1}" == n1 ]] && echo "10.9.0.0/24 " || { echo "network \${@: -1} not found" >&2; return 1; } ;;
    esac; }`;
    expect(slots(`${docker}; set -o pipefail; host_subnets`)).toEqual({
      out: "10.9.0.0/24",
      status: 0,
    });
  });

  const slotIds = Array.from({ length: 32 }, (_, slot) => slot);
  const env = slotIds.map(slotEnv);

  it("gives every slot, qa's included, its own subnets and loopback ports", () => {
    const subnets = env.flatMap((e) => [
      `${e.CDP_SUBNET_PREFIX}.0/24`,
      `${e.FIXTURES_SUBNET_PREFIX}.0/24`,
      e.MT_CI_EDGE_SUBNET!,
      e.MT_CI_BACKEND_SUBNET!,
      e.MT_CI_EGRESS_SUBNET!,
    ]);
    expect(new Set(subnets).size).toBe(subnets.length);
    for (const e of env) expect(e.BEHAVIOUR_SUBNET_PREFIX).toBe(e.CDP_SUBNET_PREFIX);
    const ports = env.flatMap((e) =>
      Object.entries(e)
        .filter(([name]) => name.endsWith("_PORT") || /_PORT_\d$/.test(name))
        .map(([, port]) => Number(port)),
    );
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) expect(port).toBeGreaterThan(19_999);
    for (const port of ports) expect(port).toBeLessThan(23_200);
    expect(slotEnv(2)).toMatchObject({ CDP_SUBNET_PREFIX: "10.213.16", TEST_HTTP_PORT: "20280" });
  });

  it("never overlaps the legacy fixed values, so pre-slot branches keep working beside it", () => {
    const legacyPorts = [18080, 19223, 19224, 18091, 18092, 18191, 18192, 3100];
    for (const e of env) {
      for (const subnet of [`${e.CDP_SUBNET_PREFIX}.0/24`, e.MT_CI_EDGE_SUBNET!])
        expect(overlaps(subnet, "172.30.0.0/16"), subnet).toBe(false);
      for (const port of Object.values(e)) expect(legacyPorts).not.toContain(Number(port));
    }
    // Docker's default address pools: slots never compete with auto-assigned networks.
    expect(overlaps("10.213.0.0/16", "172.17.0.0/12")).toBe(false);
    expect(overlaps("10.213.0.0/16", "192.168.0.0/16")).toBe(false);
  });

  it("compares CIDRs by address range", () => {
    expect(overlaps("10.0.0.0/8", "10.213.16.0/21")).toBe(true);
    expect(overlaps("10.213.20.0/24", "10.213.16.0/21")).toBe(true);
    expect(overlaps("10.213.24.0/24", "10.213.16.0/21")).toBe(false);
    expect(overlaps("10.213.15.0/24", "10.213.16.0/21")).toBe(false);
    expect(overlaps("0.0.0.0/0", "10.213.16.0/21")).toBe(true);
  });

  it("detects a slot's leftover networks and busy ports, ignoring other ranges and IPv6", () => {
    expect(
      slots(`slot_conflict 2 "fd00::/64 172.30.231.0/24 10.213.24.0/24" "22 18080 20300"`).out,
    ).toBe("");
    expect(slots(`slot_conflict 2 "10.213.18.0/24" ""`).out).toBe(
      "network 10.213.18.0/24 overlaps 10.213.16.0/21",
    );
    expect(slots(`slot_conflict 2 "" "443 20280"`).out).toBe("port 20280 is in use");
  });

  it("names exactly the variables the stacks read", () => {
    const names = Object.keys(slotEnv(0));
    const used = (file: string) =>
      [...read(file).matchAll(/\$\{([A-Z0-9_]+)(?::?-|:\?|\})/g)].map((match) => match[1]!);
    const consumers = [
      ...used("../tests/behaviour/compose.yml"),
      ...used("../tests/e2e/compose.remote.yml"),
      ...used("../compose.test.yml"),
    ];
    for (const name of names.filter((n) => n !== "WEB_UI_PORT"))
      expect(consumers, name).toContain(name);
    expect(read("../apps/web/playwright.config.ts")).toContain('process.env["WEB_UI_PORT"]');
    for (const name of names.filter((n) => n.startsWith("BEHAVIOUR_")))
      expect(read("../tests/behaviour/constants.ts"), name).toContain(name);
  });
});

describe("slot allocation while other runs clean up (runner race, bench:mock exit 123)", () => {
  // A fake docker: `network ls` lists three networks, but another run's cleanup removed `gone`
  // before `inspect`, which then exits 1 ("network not found") for it.
  // `aaa` is a leftover in slot 0's block. STUB_LS_FAIL makes listing itself fail (no daemon).
  const DOCKER = `#!/usr/bin/env bash
case "$1 $2" in
  "network ls") [[ -n "\${STUB_LS_FAIL:-}" ]] && exit 1; printf 'aaa\\ngone\\nccc\\n' ;;
  "network inspect")
    case "\${@: -1}" in
      aaa) echo "10.213.3.0/24 " ;;
      ccc) echo "172.30.231.0/24 " ;;
      *) echo "Error: No such network: \${@: -1}" >&2; exit 1 ;;
    esac ;;
  *) exit 3 ;;
esac
`;
  const SS = "#!/usr/bin/env bash\necho 'LISTEN 0 4096 127.0.0.1:18080 0.0.0.0:*'\n";

  function allocate(env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "mt-slots-"));
    for (const [name, body] of [
      ["docker", DOCKER],
      ["ss", SS],
    ] as const) {
      writeFileSync(join(dir, name), body);
      chmodSync(join(dir, name), 0o755);
    }
    // As run-on-host.sh runs it: errexit, nounset and pipefail on.
    return spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail; source scripts/remote-test/slots.sh; acquire_slot 3 "${dir}"; echo "slot $SLOT"`,
      ],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
      },
    );
  }

  it.runIf(hostShell)(
    "ignores a network that vanished mid-inspect and still skips a real leftover",
    () => {
      const result = allocate();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("slot 1");
      expect(result.stderr).toContain("skipping stack slot 0: network 10.213.3.0/24");
    },
  );

  it.runIf(hostShell)("fails rather than allocate blind when the networks cannot be listed", () => {
    expect(allocate({ STUB_LS_FAIL: "1" }).status).not.toBe(0);
  });

  it("checks the host only after taking the seat, so check and allocation are one step", () => {
    const body = /^acquire_slot\(\) \{[\s\S]*?^\}/m.exec(read("./remote-test/slots.sh"))?.[0] ?? "";
    expect(body.indexOf("host_subnets")).toBeGreaterThan(body.indexOf("flock -n"));
  });
});

describe("per-run snapshots of one worktree's sync (remote-test/snapshot.sh)", () => {
  /** Runs snapshot.sh functions in a scratch tree: base/ is the synced worktree. */
  function snapshot(script: string) {
    const dir = mkdtempSync(join(tmpdir(), "mt-snap-"));
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail; source "$1/scripts/remote-test/snapshot.sh"; cd "$2"; ${script}`,
        "bash",
        fileURLToPath(cwd),
        dir,
      ],
      { encoding: "utf8" },
    );
    return { ...result, dir };
  }
  const SETUP = `mkdir -p base/src base/node_modules/x base/apps/web/test-results base/apps/web/.next
    echo v1 >base/src/a.ts; echo dep >base/node_modules/x/i.js; echo old >base/apps/web/test-results/r
    echo built >base/apps/web/.next/b`;

  it.runIf(hostShell)("copies the sources, never node_modules, build output or old results", () => {
    const { status, stdout, stderr, dir } = snapshot(`${SETUP}
      take_snapshot "$PWD/base" "$PWD/run/src" "$PWD/sync.lock"
      find run/src -type f | sort`);
    expect(status, stderr).toBe(0);
    expect(stdout.trim()).toBe("run/src/src/a.ts");
    expect(readFileSync(join(dir, "run/src/src/a.ts"), "utf8")).toBe("v1\n");
  });

  it.runIf(hostShell)("keeps the run's files when a later sync rewrites the worktree", () => {
    const { status, stdout, stderr } = snapshot(`${SETUP}
      take_snapshot "$PWD/base" "$PWD/run/src" "$PWD/sync.lock"
      echo v2 >base/src/a.ts; echo new >base/src/b.ts
      cat run/src/src/a.ts; ls run/src/src; ls -A run/src | tr '\\n' ' '`);
    expect(status, stderr).toBe(0);
    expect(stdout.split("\n")).toEqual(["v1", "a.ts", "apps src "]);
  });

  it.runIf(hostShell)("waits for a sync in progress, so it never copies a half-synced tree", () => {
    // A sync holds the lock and finishes writing after 500 ms; the snapshot must see its end.
    const { status, stdout, stderr } = snapshot(`${SETUP}
      flock sync.lock bash -c 'sleep 0.5; echo synced >base/src/last.ts' &
      sleep 0.1
      take_snapshot "$PWD/base" "$PWD/run/src" "$PWD/sync.lock"
      cat run/src/src/last.ts`);
    expect(status, stderr).toBe(0);
    expect(stdout.trim()).toBe("synced");
  });

  it.runIf(hostShell)("publishes the run's results back to the synced folder", () => {
    const { status, stdout, stderr } = snapshot(`${SETUP}
      mkdir -p run/src/apps/web/test-results run/src/apps/web/e2e/.out
      echo fresh >run/src/apps/web/test-results/r2; echo out >run/src/apps/web/e2e/.out/o
      publish_results "$PWD/run/src" "$PWD/base" "$PWD/sync.lock"
      ls base/apps/web/test-results; cat base/apps/web/e2e/.out/o`);
    expect(status, stderr).toBe(0);
    expect(stdout.split("\n")).toEqual(["r2", "out", ""]);
  });

  it("syncs under the same per-worktree lock the host's snapshots take", () => {
    expect(client).toContain(
      '--rsync-path="mkdir -p $remote_dir mt-ci/.sync && flock mt-ci/.sync/$name.lock rsync"',
    );
    expect(host).toContain('sync_lock="$HOME/mt-ci/.sync/$(basename "$base").lock"');
    expect(host).toMatch(
      /^take_snapshot "\$base" "\$run_dir\/src" "\$sync_lock"\nroot="\$run_dir\/src"$/m,
    );
  });
});
