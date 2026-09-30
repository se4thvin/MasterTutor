import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LOGIN, OTHER, SITE } from "../behaviour/constants.ts";
import { FIXTURE_HOSTS } from "../fixtures/vault-sites/server.ts";
import { composeConfig, type ComposeConfig } from "./compose-json.ts";

const STACK = ["compose.yml", "compose.test.yml"];
const PROFILES = ["e2e", "e2e-runner", "bench"];
const FIXTURES_SUBNET = "172.30.241.0/24";
const RUN = "mt-config-check";
const SLOTS = ["browser-1", "browser-2"];

let plain: ComposeConfig;
let stack: ComposeConfig;
let remote: ComposeConfig;
beforeAll(() => {
  plain = composeConfig(".env.test", STACK);
  stack = composeConfig(".env.test", STACK, { profiles: PROFILES });
  remote = composeConfig(".env.test", [...STACK, "tests/e2e/compose.remote.yml"], {
    profiles: PROFILES,
    env: { MT_CI_RUN_ID: RUN },
  });
});

const aliases = (service: string) => stack.services[service]?.networks?.fixtures?.aliases ?? [];
const host = (origin: string) => new URL(origin).hostname;

describe("compose.test.yml E2E stack (one overlay, X2)", () => {
  it("keeps the E2E services out of the default stack", () => {
    for (const name of ["llm-mock", "fixtures", "vault-fixtures", "e2e", "bench-fixtures"])
      expect(plain.services[name], name).toBeUndefined();
  });

  it("joins both slots to an internal, pinned fixtures network their egress firewall allows", () => {
    expect(stack.networks.fixtures?.internal).toBe(true);
    expect(stack.networks.fixtures?.ipam?.config?.[0]?.subnet).toBe(FIXTURES_SUBNET);
    for (const slot of SLOTS) {
      expect(Object.keys(stack.services[slot]?.networks ?? {}), slot).toContain("fixtures");
      expect(stack.services[slot]?.environment?.SLOT_EGRESS_ALLOW_CIDRS, slot).toBe(
        FIXTURES_SUBNET,
      );
    }
  });

  it("serves every fixture host from exactly one service (P7-7, P7-26)", () => {
    const nginx = aliases("fixtures");
    const vault = aliases("vault-fixtures");
    expect(nginx).toEqual(
      expect.arrayContaining([
        host(SITE),
        host(OTHER),
        "other.fixtures-isolated.test",
        "ads.fixtures-hung.test",
      ]),
    );
    expect(host(LOGIN)).toBe(FIXTURE_HOSTS.login);
    expect(vault).toEqual(
      expect.arrayContaining([FIXTURE_HOSTS.login, FIXTURE_HOSTS.lookalike, FIXTURE_HOSTS.evil]),
    );
    expect(nginx.filter((alias) => vault.includes(alias))).toEqual([]);
    // Phase 10 Task 22's activity site (X2): its own host, its own profile.
    expect(aliases("bench-fixtures")).toEqual(["bench.fixtures.test"]);
    expect(stack.services["bench-fixtures"]?.profiles).toEqual(["bench"]);
    expect(stack.services["bench-fixtures"]?.environment?.PORT).toBe("8080");
  });

  it("points the agent and web at the llm-mock, which listens beyond loopback (P7-6, D26)", () => {
    for (const service of ["agent", "web"])
      expect(stack.services[service]?.environment?.OPENAI_BASE_URL, service).toBe(
        "http://llm-mock:8090/v1",
      );
    expect(stack.services.agent?.environment?.AGENT_TEST_MODE).toBe("1");
    expect(stack.services["llm-mock"]?.environment?.HOST).toBe("0.0.0.0");
    expect(Object.keys(stack.services["llm-mock"]?.networks ?? {}).sort()).toEqual([
      "backend",
      "edge",
    ]);
    // Least privilege (review Minor 8): mail travels on its own internal network, so the vault
    // fixture reaches greenmail but never postgres or garage.
    expect(stack.networks.mail?.internal).toBe(true);
    expect(Object.keys(stack.services["vault-fixtures"]?.networks ?? {}).sort()).toEqual([
      "fixtures",
      "mail",
    ]);
    expect(Object.keys(stack.services.greenmail?.networks ?? {})).toEqual(["mail"]);
    expect(Object.keys(stack.services.agent?.networks ?? {})).toContain("mail");
  });

  it("runs Playwright inside Traefik's network namespace, on the app's own origin", () => {
    const e2e = stack.services.e2e!;
    expect(e2e.network_mode).toBe("service:traefik");
    expect(e2e.environment?.E2E_BASE_URL).toBe("http://localhost:18080");
    expect(e2e.environment?.E2E_LLM_MOCK_URL).toBe("http://llm-mock:8090");
    expect(e2e.profiles).toEqual(["e2e-runner"]);
  });

  it("derives the app's origin from TEST_HTTP_PORT everywhere it is spelled (review Minor 6)", () => {
    const moved = composeConfig(".env.test", STACK, {
      profiles: PROFILES,
      env: { TEST_HTTP_PORT: "18181" },
    });
    const traefik = moved.services.traefik!;
    expect(traefik.command).toContain("--entrypoints.web.address=:18181");
    expect(traefik.ports?.map((p) => `${p.host_ip}:${p.published}:${p.target}`)).toEqual([
      "127.0.0.1:18181:18181",
    ]);
    expect(moved.services.e2e?.environment?.E2E_BASE_URL).toBe("http://localhost:18181");
    expect(moved.services.web?.environment?.BETTER_AUTH_URL).toBe("http://localhost:18181");
  });

  it("has one test overlay: compose.live-test.yml is folded in (P7-5)", () => {
    expect(existsSync(new URL("../../compose.live-test.yml", import.meta.url))).toBe(false);
    const scripts = (
      JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["compose:live"]).toBeUndefined();
    expect(JSON.stringify(scripts)).not.toContain("compose.live-test.yml");
  });
});

describe("tests/e2e/compose.remote.yml on the shared CI host (X4, D45)", () => {
  const labelled = (labels: Record<string, string> | undefined) =>
    labels?.["mastertutor.ci"] === "1" && labels["mastertutor.ci.run"] === RUN;

  it("labels every container, network and volume for the runner's cleanup", () => {
    for (const [name, service] of Object.entries(remote.services))
      expect(labelled(service.labels), name).toBe(true);
    for (const [name, network] of Object.entries(remote.networks))
      expect(labelled(network.labels), name).toBe(true);
    for (const [name, volume] of Object.entries(remote.volumes ?? {}))
      expect(labelled(volume.labels), name).toBe(true);
  });

  it("confines the slots: AppArmor slot profile on top of seccomp, and nothing published", () => {
    for (const slot of SLOTS) {
      const options = remote.services[slot]?.security_opt ?? [];
      expect(options, slot).toContain("apparmor=mastertutor-slot");
      expect(
        options.some((option) => option.startsWith("seccomp=")),
        slot,
      ).toBe(true);
      expect(remote.services[slot]?.ports ?? [], slot).toEqual([]);
    }
  });

  it("publishes nothing beyond 127.0.0.1", () => {
    for (const [name, service] of Object.entries(remote.services))
      for (const port of service.ports ?? []) expect(port.host_ip, name).toBe("127.0.0.1");
  });
});
