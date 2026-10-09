import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeConfig } from "../compose/compose-json.ts";

// A fake docker CLI: logs every call; `network inspect` answers from STUB_NETWORK (unset = missing),
// `inspect -f` (Traefik's address on mastertutor-cdp) answers STUB_TRAEFIK_IP.
const STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$1 $2" in
  "network inspect")
    [[ -n "\${STUB_NETWORK:-}" ]] || exit 1
    [[ " $* " == *" -f "* ]] && echo "$STUB_NETWORK"
    exit 0 ;;
  "inspect -f") echo "\${STUB_TRAEFIK_IP:-}"; exit 0 ;;
  "network create" | "network connect") exit 0 ;;
esac
exit 3
`;

function run(script: string, args: string[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "mt-host-"));
  writeFileSync(join(dir, "docker"), STUB);
  chmodSync(join(dir, "docker"), 0o755);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const result = spawnSync("bash", [`infra/host/${script}`, ...args], {
    encoding: "utf8",
    env: { PATH: `${dir}:${process.env.PATH}`, STUB_LOG: log, ...env },
  });
  return { ...result, calls: readFileSync(log, "utf8") };
}

describe("create-cdp-network.sh (P9-12)", () => {
  const prefix = "10.231.7";

  it("uses exactly compose.yml's cdp settings and changes nothing without --yes", () => {
    const base = composeConfig(".env.test", ["compose.yml"], {
      env: { CDP_SUBNET_PREFIX: prefix },
    });
    const ipam = base.networks.cdp!.ipam!.config![0]!;
    expect(base.networks.cdp!.internal).toBe(true);
    const dry = run("create-cdp-network.sh", [], { CDP_SUBNET_PREFIX: prefix });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(`--internal --subnet ${ipam.subnet} --ip-range ${ipam.ip_range}`);
    expect(dry.stdout).toContain("mastertutor-cdp");
    expect(dry.calls).not.toContain("network create");
  });

  it("creates the network only with --yes", () => {
    const applied = run("create-cdp-network.sh", ["--yes"], { CDP_SUBNET_PREFIX: prefix });
    expect(applied.status).toBe(0);
    expect(applied.calls).toContain(
      `network create --driver bridge --internal --subnet ${prefix}.0/24 --ip-range ${prefix}.128/25`,
    );
  });

  it("accepts a matching existing network and refuses a mismatched one, never modifying it", () => {
    const ok = run("create-cdp-network.sh", ["--yes"], {
      CDP_SUBNET_PREFIX: prefix,
      STUB_NETWORK: `true ${prefix}.0/24 ${prefix}.128/25`,
    });
    expect(ok.status).toBe(0);
    expect(ok.calls).not.toContain("network create");
    const bad = run("create-cdp-network.sh", ["--yes"], {
      CDP_SUBNET_PREFIX: prefix,
      STUB_NETWORK: `false ${prefix}.0/24 ${prefix}.128/25`,
    });
    expect(bad.status).toBe(1);
    expect(bad.calls).not.toContain("network create");
  });

  it("rejects an invalid prefix", () => {
    expect(run("create-cdp-network.sh", [], { CDP_SUBNET_PREFIX: "10.231.700" }).status).toBe(2);
  });

  it("refuses any argument but --yes, changing nothing (review minor)", () => {
    for (const arg of ["-y", "--Yes", "yes"]) {
      const result = run("create-cdp-network.sh", [arg], { CDP_SUBNET_PREFIX: prefix });
      expect(result.status, arg).toBe(2);
      expect(result.calls, arg).toBe("");
    }
  });
});

describe("attach-traefik.sh (P9-13)", () => {
  it("prints the connect command at .12 without --yes, and runs it with --yes", () => {
    const dry = run("attach-traefik.sh", [], {});
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(
      "network connect --ip 172.30.231.12 mastertutor-cdp dokploy-traefik",
    );
    expect(dry.calls).not.toContain("network connect");
    const applied = run("attach-traefik.sh", ["--yes"], {});
    expect(applied.calls).toContain(
      "network connect --ip 172.30.231.12 mastertutor-cdp dokploy-traefik",
    );
  });

  it("is idempotent at .12 and fails at any other address", () => {
    const same = run("attach-traefik.sh", ["--yes"], { STUB_TRAEFIK_IP: "172.30.231.12" });
    expect(same.status).toBe(0);
    expect(same.calls).not.toContain("network connect");
    const wrong = run("attach-traefik.sh", ["--yes"], { STUB_TRAEFIK_IP: "172.30.231.200" });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("172.30.231.200");
    expect(wrong.calls).not.toContain("network connect");
  });
});

describe("attach-traefik.sh arguments (review minor)", () => {
  it("refuses any argument but --yes and an invalid prefix, changing nothing", () => {
    for (const arg of ["-y", "--Yes"]) {
      const result = run("attach-traefik.sh", [arg], {});
      expect(result.status, arg).toBe(2);
      expect(result.calls, arg).toBe("");
    }
    const bad = run("attach-traefik.sh", ["--yes"], { CDP_SUBNET_PREFIX: "172.30" });
    expect(bad.status).toBe(2);
    expect(bad.calls).toBe("");
  });
});

describe("create-obs-network.sh and attach-traefik.sh --network obs (D50)", () => {
  it("prints the internal network create without --yes, runs it with --yes, and checks an existing one", () => {
    const dry = run("create-obs-network.sh", [], {});
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(
      "would run: docker network create --driver bridge --internal mastertutor-obs",
    );
    expect(dry.calls).not.toContain("network create");
    const applied = run("create-obs-network.sh", ["--yes"], {});
    expect(applied.calls).toContain("network create --driver bridge --internal mastertutor-obs");
    const ok = run("create-obs-network.sh", ["--yes"], { STUB_NETWORK: "true" });
    expect(ok.status).toBe(0);
    expect(ok.calls).not.toContain("network create");
    const bad = run("create-obs-network.sh", ["--yes"], { STUB_NETWORK: "false" });
    expect(bad.status).toBe(1);
    expect(bad.calls).not.toContain("network create");
    for (const arg of ["-y", "--network"]) {
      const refused = run("create-obs-network.sh", [arg], {});
      expect(refused.status, arg).toBe(2);
      expect(refused.calls, arg).toBe("");
    }
  });

  it("attaches Traefik to mastertutor-obs with no fixed address, only with --yes, idempotently", () => {
    const dry = run("attach-traefik.sh", ["--network", "obs"], {});
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(
      "would run: docker network connect mastertutor-obs dokploy-traefik",
    );
    expect(dry.calls).not.toContain("network connect");
    const applied = run("attach-traefik.sh", ["--network", "obs", "--yes"], {});
    expect(applied.calls).toContain("network connect mastertutor-obs dokploy-traefik");
    expect(applied.calls).not.toContain("mastertutor-cdp");
    const same = run("attach-traefik.sh", ["--yes", "--network", "obs"], {
      STUB_TRAEFIK_IP: "172.18.0.5",
    });
    expect(same.status).toBe(0);
    expect(same.calls).not.toContain("network connect");
    for (const args of [["--network"], ["--network", "cdp"], ["obs"], ["--network", "obs", "-y"]]) {
      const refused = run("attach-traefik.sh", args, {});
      expect(refused.status, args.join(" ")).toBe(2);
      expect(refused.calls, args.join(" ")).toBe("");
    }
  });
});

describe("no host-wide changes (D41, D45, D42)", () => {
  it("ships no sysctl, ufw or TURN script", () => {
    const tracked = spawnSync("git", ["ls-files", "infra/host"], { encoding: "utf8" }).stdout;
    expect(tracked).not.toMatch(/sysctl|99-mastertutor|firewall|ufw|turn/i);
  });
});

it("prepares the separate observer ingress network without connecting it to OpenObserve", () => {
  const dry = run("create-obs-network.sh", ["--network", "observer"], {});
  expect(dry.status).toBe(0);
  expect(dry.stdout).toContain("--internal mastertutor-observer");
  expect(dry.calls).not.toContain("network create");
  const create = run("create-obs-network.sh", ["--network", "observer", "--yes"], {});
  expect(create.calls).toContain("network create --driver bridge --internal mastertutor-observer");
  const attach = run("attach-traefik.sh", ["--network", "observer", "--yes"], {});
  expect(attach.calls).toContain("network connect mastertutor-observer dokploy-traefik");
});
