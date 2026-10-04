import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
      /ui\) fetch apps\/web\/playwright-report && fetch apps\/web\/test-results/,
    );
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

  it("never leaves the stack lock without an owner (review Minor 7)", () => {
    // The lock appears only by renaming a directory that already names its owner.
    expect(host).not.toContain('mkdir "$stack_lock"');
    expect(host).toMatch(/echo "\$project" >"\$claim\/owner"/);
    expect(host).toMatch(/mv -T "\$claim" "\$stack_lock"/);
  });
});
