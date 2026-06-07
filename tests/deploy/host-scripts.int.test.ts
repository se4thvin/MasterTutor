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

describe("no host-wide changes (D41, D45, D42)", () => {
  it("ships no sysctl, ufw or TURN script", () => {
    const tracked = spawnSync("git", ["ls-files", "infra/host"], { encoding: "utf8" }).stdout;
    expect(tracked).not.toMatch(/sysctl|99-mastertutor|firewall|ufw|turn/i);
  });
});
