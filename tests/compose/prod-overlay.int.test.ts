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

  it("joins no shared network: the only external one is mastertutor-cdp (review I2)", () => {
    // dokploy-network is shared with other tenants, whose service names (postgres, garage, …)
    // would answer web's bare-name lookups. Traefik reaches web over mastertutor-cdp instead.
    expect(config.networks).not.toHaveProperty("dokploy-network");
    const external = Object.entries(config.networks).filter(([, network]) => network.external);
    expect(external.map(([key, network]) => [key, network.name])).toEqual([
      ["cdp", "mastertutor-cdp"],
    ]);
    for (const [name, service] of Object.entries(config.services)) {
      expect(Object.keys(service.networks ?? {}), name).not.toContain("dokploy-network");
    }
  });

  it("resolves web's database, S3 and n.eko hosts only to our own services (review I2)", () => {
    const web = env(config.services.web);
    const hosts = [web.DATABASE_URL!, web.S3_ENDPOINT!].map((url) => new URL(url).hostname);
    for (const host of [...hosts, ...slots]) expect(config.services, host).toHaveProperty(host);
    expect(Object.keys(config.services.web!.networks ?? {}).sort()).toEqual([
      "backend",
      "cdp",
      "edge",
    ]);
  });

  it("serves web through its own router on mastertutor-cdp, with an ACME certificate", () => {
    const l = labels(config.services.web);
    const router = "traefik.http.routers.mastertutor-web";
    expect(l["traefik.enable"]).toBe("true");
    expect(l["traefik.docker.network"]).toBe("mastertutor-cdp");
    expect(l[`${router}.rule`]).toBe(`Host(\`${DOMAIN}\`)`);
    expect(l[`${router}.entrypoints`]).toBe("websecure");
    expect(l[`${router}.tls`]).toBe("true");
    expect(l[`${router}.tls.certresolver`]).toBe("letsencrypt");
    expect(l[`${router}.service`]).toBe("mastertutor-web");
    expect(l["traefik.http.services.mastertutor-web.loadbalancer.server.port"]).toBe("3000");
  });

  it("redirects http:// to https:// with its own router and middleware (re-review N1)", () => {
    const l = labels(config.services.web);
    const router = "traefik.http.routers.mastertutor-web-http";
    expect(l[`${router}.rule`]).toBe(`Host(\`${DOMAIN}\`)`);
    expect(l[`${router}.entrypoints`]).toBe("web");
    expect(l[`${router}.middlewares`]).toBe("mastertutor-https-redirect");
    expect(l[`${router}.service`]).toBe("mastertutor-web");
    expect(l["traefik.http.middlewares.mastertutor-https-redirect.redirectscheme.scheme"]).toBe(
      "https",
    );
    expect(l["traefik.http.middlewares.mastertutor-https-redirect.redirectscheme.permanent"]).toBe(
      "true",
    );
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
  it("puts the AppArmor profile on the slots only", () => {
    for (const [name, service] of Object.entries(config.services)) {
      if (slots.includes(name)) continue;
      expect(
        (service.security_opt ?? []).filter((o) => o.startsWith("apparmor=")),
        name,
      ).toEqual([]);
    }
  });

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
    const forced = prod({
      AGENT_TEST_MODE: "1",
      OPENAI_BASE_URL: "http://llm-mock:8080/v1",
      SLOT_EGRESS_ALLOW_CIDRS: "10.0.0.0/8",
    });
    for (const slot of slots) {
      expect(env(forced.services[slot]).SLOT_EGRESS_ALLOW_CIDRS, slot).toBe(""); // review I3
    }
    expect(env(forced.services.agent).AGENT_TEST_MODE).toBe("0");
    expect(env(forced.services.agent).OPENAI_BASE_URL).toBe("");
    expect(env(forced.services.web).OPENAI_BASE_URL).toBe("");
    expect(prodModeProblems(forced)).toEqual([]);
  });
  it("builds and runs production-only images, never the CI :local tags (review I4)", () => {
    const base = composeConfig(".env.test", ["compose.yml"]);
    const ciImages = new Set(Object.values(base.services).map((service) => service.image));
    for (const [name, service] of Object.entries(config.services)) {
      if (!base.services[name]?.image?.startsWith("mastertutor/")) continue;
      expect(service.image, name).toMatch(/^mastertutor\/[a-z-]+:prod$/);
      expect(ciImages.has(service.image), name).toBe(false);
    }
    const runtime = ["migrate", "agent", "garage-init"].map((n) => config.services[n]!.image);
    expect(new Set(runtime).size).toBe(1);
  });

  it("bounds every service's memory, CPU, processes and logs on the shared host (review I5)", () => {
    for (const [name, service] of Object.entries(config.services)) {
      expect(Number(service.mem_limit), name).toBeGreaterThan(0);
      expect(Number(service.cpus), name).toBeGreaterThan(0);
      expect(service.pids_limit, name).toBeGreaterThan(0);
      expect(service.logging, name).toMatchObject({
        driver: "json-file",
        options: { "max-size": expect.any(String), "max-file": expect.any(String) },
      });
    }
    for (const slot of slots) {
      expect(Number(config.services[slot]!.mem_limit), slot).toBe(4 * 1024 ** 3);
      expect(Number(config.services[slot]!.cpus), slot).toBe(2);
    }
  });

  it("runs pdf-worker from the production image with no env, on the pdf network only (B5 I-1)", () => {
    const worker = config.services["pdf-worker"]!;
    expect(worker.image).toBe("mastertutor/node-runtime:prod");
    expect(Object.keys(worker.networks ?? {})).toEqual(["pdf"]);
    expect(worker.environment ?? {}).toEqual({});
    expect(worker.read_only).toBe(true);
  });

  it("runs docling under the pdf profile on its own network, wired to the agent (P9-32, D42)", () => {
    const pdf = prod({}, ["pdf"]);
    const docling = pdf.services.docling!;
    expect(Object.keys(docling.networks ?? {})).toEqual(["pdf"]);
    expect(pdf.networks.pdf).toMatchObject({ internal: true });
    expect(pdf.networks.pdf?.external).toBeFalsy();
    expect(Object.keys(pdf.services.agent!.networks ?? {}).sort()).toEqual([
      "backend",
      "cdp",
      "pdf",
    ]);
    expect(env(pdf.services.agent).DOCLING_URL).toBe("http://docling:5001");
    expect(docling.ports ?? []).toEqual([]);
    expect(Number(docling.mem_limit)).toBeGreaterThan(0);
    expect(Number(docling.cpus)).toBeGreaterThan(0);
    expect(docling.pids_limit).toBeGreaterThan(0);
    expect(docling.logging).toMatchObject({ driver: "json-file" });
    expect(prodModeProblems(pdf)).toEqual([]);
  });
});

// D47: compose.prod.yml must also run on the Mac with no Dokploy, through one local override.
const LOCAL_OVERRIDE = `
networks:
  cdp: !override
    name: mastertutor-cdp
    internal: true
    ipam:
      config:
        - subnet: 172.30.231.0/24
          ip_range: 172.30.231.128/25
services:
  web:
    labels:
      traefik.http.routers.mastertutor-web.tls.certresolver: !reset null
      traefik.http.routers.mastertutor-web-http.rule: !reset null
      traefik.http.routers.mastertutor-web-http.entrypoints: !reset null
      traefik.http.routers.mastertutor-web-http.middlewares: !reset null
      traefik.http.routers.mastertutor-web-http.service: !reset null
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
    const web = labels(local.services.web);
    expect(web["traefik.http.routers.mastertutor-web.rule"]).toBe("Host(`localhost`)");
    expect(web["traefik.http.routers.mastertutor-web.tls"]).toBe("false");
    expect(web).not.toHaveProperty("traefik.http.routers.mastertutor-web.tls.certresolver");
    // Locally the main router already listens on `web`: no redirect router may collide with it.
    expect(Object.keys(web).filter((key) => key.includes("mastertutor-web-http"))).toEqual([]);
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
