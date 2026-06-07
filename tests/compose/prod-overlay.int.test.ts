import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIVE_STRIP_REGEX,
  MAX_UPLOAD_BYTES,
  liveForwardAuthAddress,
  liveRouterRule,
  liveUploadRouterRule,
  mediaPortForSlot,
} from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { composeConfig, type ComposeService } from "./compose-json.ts";
import { PROD_LIKE_LOCAL_FILES, prodModeProblems } from "./prod-mode.ts";

const DOMAIN = "notes.example.org";
const PROD = ["compose.yml", "compose.prod.yml"] as const;
const prod = (env: Record<string, string> = {}, profiles: string[] = []) =>
  composeConfig(".env.test", PROD, { env: { DOMAIN, ...env }, profiles });
const config = prod();
const slots = Object.keys(config.services)
  .filter((name) => /^browser-\d+$/.test(name))
  .sort();
const labels = (service: ComposeService | undefined) => service?.labels ?? {};
const env = (service: ComposeService | undefined) => service?.environment ?? {};
const M = "traefik.http.middlewares.mastertutor-live";

describe("compose.prod.yml: Dokploy wiring (D41)", () => {
  it("defines the six production slots", () => {
    expect(slots).toEqual([
      "browser-1",
      "browser-2",
      "browser-3",
      "browser-4",
      "browser-5",
      "browser-6",
    ]);
  });

  it("attaches web, and only web, to Dokploy's external network", () => {
    expect(config.networks["dokploy-network"]).toMatchObject({ external: true });
    const attached = Object.entries(config.services)
      .filter(([, service]) => service.networks && "dokploy-network" in service.networks)
      .map(([name]) => name);
    expect(attached).toEqual(["web"]);
  });

  it("joins the host-created external cdp network and keeps agent .10 and web .11 (P9-5)", () => {
    const cdp = config.networks.cdp!;
    expect(cdp).toMatchObject({ name: "mastertutor-cdp", external: true });
    expect(cdp.internal).toBeUndefined();
    // Compose prints `ipam: {}` for every network; an external network must carry no subnet.
    expect(cdp.ipam?.config).toBeUndefined();
    expect(config.services.agent!.networks!.cdp!.ipv4_address).toBe("172.30.231.10");
    expect(config.services.web!.networks!.cdp!.ipv4_address).toBe("172.30.231.11");
  });

  it("adds no pgbackups volume and no /backups mount: Dokploy backs up postgres (P9-6, D54)", () => {
    expect(config.volumes ?? {}).not.toHaveProperty("pgbackups");
    for (const [name, service] of Object.entries(config.services)) {
      expect(
        (service.volumes ?? []).map((volume) => volume.target),
        name,
      ).not.toContain("/backups");
    }
  });

  it("shares the downloads volume between the agent and the slots only", () => {
    const users = Object.entries(config.services)
      .filter(([, service]) =>
        (service.volumes ?? []).some((volume) => volume.source === "downloads"),
      )
      .map(([name]) => name)
      .sort();
    expect(users).toEqual(["agent", ...slots].sort());
  });

  // The TURN_* env ban lives in compose-config.int.test.ts (Task 14, which removes TURN_SECRET).
  it("adds no TURN relay (D42)", () => {
    expect(config.services.coturn).toBeUndefined();
  });

  it("publishes only each slot's own WebRTC mux port, UDP and TCP", () => {
    const published = Object.entries(config.services).flatMap(([name, service]) =>
      (service.ports ?? []).map((port) => ({ name, port: Number(port.published) })),
    );
    expect(published.map((p) => p.name).sort()).toEqual([...slots, ...slots].sort());
    for (const p of published) expect(p.port, p.name).toBe(mediaPortForSlot(p.name));
  });
});

describe("compose.prod.yml: per-slot /live routers (spec §10.2.2, B6 §8, P9-1 to P9-4, D59)", () => {
  it("routes each slot with liveRouterRule and auth before strip, at priority 1000", () => {
    for (const slot of slots) {
      const l = labels(config.services[slot]);
      const router = `traefik.http.routers.mastertutor-live-${slot}`;
      expect(l["traefik.enable"]).toBe("true");
      expect(l["traefik.docker.network"]).toBe("mastertutor-cdp");
      expect(l[`${router}.rule`]).toBe(liveRouterRule(slot, DOMAIN));
      expect(l[`${router}.priority`]).toBe("1000");
      expect(l[`${router}.entrypoints`]).toBe("websecure");
      expect(l[`${router}.tls`]).toBe("true");
      expect(l[`${router}.middlewares`]).toBe(
        "mastertutor-live-auth,mastertutor-live-strip,mastertutor-live-headers",
      );
      expect(l[`${router}.service`]).toBe(`mastertutor-live-${slot}`);
      expect(l[`traefik.http.services.mastertutor-live-${slot}.loadbalancer.server.port`]).toBe(
        "8080",
      );
    }
  });

  it("caps n.eko upload bodies at MAX_UPLOAD_BYTES, after auth, on a more specific router (D59)", () => {
    for (const slot of slots) {
      const l = labels(config.services[slot]);
      const router = `traefik.http.routers.mastertutor-live-upload-${slot}`;
      expect(l[`${router}.rule`]).toBe(liveUploadRouterRule(slot, DOMAIN));
      expect(l[`${router}.priority`]).toBe("1001");
      expect(l[`${router}.entrypoints`]).toBe("websecure");
      expect(l[`${router}.tls`]).toBe("true");
      expect(l[`${router}.middlewares`]).toBe(
        "mastertutor-live-auth,mastertutor-live-upload-limit,mastertutor-live-strip,mastertutor-live-headers",
      );
      expect(l[`${router}.service`]).toBe(`mastertutor-live-${slot}`);
    }
  });

  it("defines identical middlewares on every slot: ForwardAuth by .11, Cookie only, frame guards (P9-1, P9-3)", () => {
    const expected = {
      [`${M}-auth.forwardauth.address`]: liveForwardAuthAddress(),
      [`${M}-auth.forwardauth.authResponseHeaders`]: "Cookie",
      [`${M}-auth.forwardauth.trustForwardHeader`]: "false",
      [`${M}-strip.stripprefixregex.regex`]: LIVE_STRIP_REGEX,
      [`${M}-headers.headers.contentSecurityPolicy`]: "frame-ancestors 'self'",
      [`${M}-headers.headers.contentTypeNosniff`]: "true",
      [`${M}-upload-limit.buffering.maxRequestBodyBytes`]: String(MAX_UPLOAD_BYTES),
    };
    for (const slot of slots) {
      const middlewares = Object.fromEntries(
        Object.entries(labels(config.services[slot])).filter(([key]) =>
          key.startsWith("traefik.http.middlewares."),
        ),
      );
      expect(middlewares, slot).toEqual(expected);
    }
    expect(JSON.stringify(config)).not.toContain("http://web:3000");
  });

  it("follows CDP_SUBNET_PREFIX for the ForwardAuth address", () => {
    const other = prod({ CDP_SUBNET_PREFIX: "10.231.7" });
    expect(labels(other.services["browser-1"])[`${M}-auth.forwardauth.address`]).toBe(
      liveForwardAuthAddress("10.231.7"),
    );
  });

  it("mirrors B6 A14's test router set (P9-33)", () => {
    const dynamic = readFileSync("infra/traefik/test-dynamic.yml", "utf8");
    expect(dynamic).toMatch(/middlewares: \[live-auth, live-strip, live-headers\]/);
    expect(dynamic).toMatch(
      /middlewares: \[live-auth, live-upload-limit, live-strip, live-headers\]/,
    );
    for (const kind of [
      "forwardAuth:",
      "stripPrefixRegex:",
      "headers:",
      "buffering:",
      "maxRequestBodyBytes:",
    ]) {
      expect(dynamic, kind).toContain(kind);
    }
  });
});

describe("compose.prod.yml: slot hardening (P9-8, D58)", () => {
  it("runs production slots under the mastertutor-slot AppArmor profile, keeping seccomp", () => {
    for (const slot of slots) {
      expect(config.services[slot]!.security_opt, slot).toEqual(
        expect.arrayContaining([
          "apparmor=mastertutor-slot",
          expect.stringMatching(/^seccomp=.*apps\/browser-slot\/seccomp\/chromium\.json$/),
        ]),
      );
    }
  });

  it("pins the n.eko base image by digest", () => {
    const dockerfile = readFileSync("apps/browser-slot/Dockerfile", "utf8");
    expect(dockerfile).toMatch(
      /^FROM ghcr\.io\/m1k1o\/neko\/chromium:3\.1\.6@sha256:[0-9a-f]{64}$/m,
    );
  });
});

describe("compose.prod.yml: production pins (D38, D42, D47)", () => {
  it("is production mode, and no env file can switch on test mode or redirect OpenAI", () => {
    expect(prodModeProblems(config)).toEqual([]);
    const forced = prod({ AGENT_TEST_MODE: "1", OPENAI_BASE_URL: "http://llm-mock:8080/v1" });
    expect(env(forced.services.agent).AGENT_TEST_MODE).toBe("0");
    expect(env(forced.services.agent).OPENAI_BASE_URL).toBe("");
    expect(env(forced.services.web).OPENAI_BASE_URL).toBe("");
    expect(prodModeProblems(forced)).toEqual([]);
  });
  // Deferred until B5 (docling, profile pdf) merges: "runs docling under the pdf profile on its own
  // network, wired to the agent (P9-32, D42)" with DOCLING_URL pinned to http://docling:5001.
});

// D47: compose.prod.yml must also run on the Mac with no Dokploy, through one local override.
const LOCAL_OVERRIDE = `
networks:
  dokploy-network: !override {}
  cdp: !override
    name: mastertutor-cdp
    internal: true
    ipam:
      config:
        - subnet: 172.30.231.0/24
          ip_range: 172.30.231.128/25
services:
${[1, 2, 3, 4, 5, 6]
  .map(
    (n) =>
      `  browser-${n}:\n    security_opt: !override ["seccomp=./apps/browser-slot/seccomp/chromium.json"]`,
  )
  .join("\n")}
`;

describe("compose.prod.yml without Dokploy (D47)", () => {
  it("neutralises every Dokploy-only part through an override and the two Traefik knobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mt-prod-local-"));
    const override = join(dir, "local.yml");
    writeFileSync(override, LOCAL_OVERRIDE);
    const local = composeConfig(".env.test", [...PROD, override], {
      env: { DOMAIN: "localhost", TRAEFIK_ENTRYPOINT: "web", TRAEFIK_TLS: "false" },
    });
    expect(Object.entries(local.networks).filter(([, network]) => network.external)).toEqual([]);
    expect(local.networks.cdp).toMatchObject({ name: "mastertutor-cdp", internal: true });
    for (const slot of slots) {
      const l = labels(local.services[slot]);
      expect(local.services[slot]!.security_opt ?? [], slot).not.toContain(
        "apparmor=mastertutor-slot",
      );
      expect(l[`traefik.http.routers.mastertutor-live-${slot}.rule`]).toBe(
        liveRouterRule(slot, "localhost"),
      );
      expect(l[`traefik.http.routers.mastertutor-live-${slot}.entrypoints`]).toBe("web");
      expect(l[`traefik.http.routers.mastertutor-live-${slot}.tls`]).toBe("false");
    }
    expect(prodModeProblems(local)).toEqual([]);
  });
});

// Task 22A creates tests/bench/compose.local.yml and deletes this .skipIf(...) in its first step.
describe.skipIf(!existsSync(PROD_LIKE_LOCAL_FILES[2]))("the D47 bench stack", () => {
  it("is production mode: AGENT_TEST_MODE=0, no WEB_FIXTURE_API, no llm-mock", () => {
    const bench = composeConfig(".env.test", PROD_LIKE_LOCAL_FILES, {
      env: { DOMAIN: "localhost", TRAEFIK_ENTRYPOINT: "web", TRAEFIK_TLS: "false" },
    });
    expect(env(bench.services.agent).AGENT_TEST_MODE).toBe("0");
    for (const [name, service] of Object.entries(bench.services)) {
      expect(Object.keys(env(service)), name).not.toContain("WEB_FIXTURE_API");
    }
    expect(bench.services["llm-mock"]).toBeUndefined();
    expect(prodModeProblems(bench)).toEqual([]);
  });
});
