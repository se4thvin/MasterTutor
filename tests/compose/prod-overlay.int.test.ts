import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIVE_STRIP_REGEX,
  MAX_UPLOAD_BYTES,
  liveForwardAuthAddress,
  liveRouterRule,
  liveUploadRouterRule,
  mediaPortForSlot,
  OBSERVABILITY_APP_PATH,
  observabilityForwardAuthAddress,
  observabilityRouterRule,
  observabilitySessionRouterRule,
  observerRouterRule,
  observerForwardAuthAddress,
} from "@mastertutor/contracts";
import { o2OtlpEndpoint } from "@mastertutor/observability";
import { describe, expect, it } from "vitest";
import { generateSecrets } from "../../scripts/env-init.ts";
import { composeConfig, type ComposeService } from "./compose-json.ts";
import { localPreflightProblems } from "../smoke/prod-smoke.ts";
import { PROD_LIKE_LOCAL_FILES, prodModeProblems } from "./prod-mode.ts";

const DOMAIN = "notes.example.org";
const PROD = ["compose.yml", "compose.prod.yml"] as const;
/**
 * compose.prod.yml requires the D50 secrets (`:?set`), even for services whose profile is off.
 * Test values, generated here rather than added to the shared test env file.
 */
const OBSERVABILITY_SECRETS = Object.fromEntries(
  Object.entries(generateSecrets()).filter(([key]) =>
    /^(OBSERVER_|OBSERVE_|S3_OBSERVE_|VAPID_|ALERT_WEBHOOK_SECRET$)/.test(key),
  ),
);
const prod = (env: Record<string, string> = {}, profiles: string[] = []) =>
  composeConfig(".env.test", PROD, {
    env: { DOMAIN, ...OBSERVABILITY_SECRETS, ...env },
    profiles,
  });
/** D50: workers and slots log to the collector through Docker's fluentd driver (spec §9). */
const CONTAINER_LOGS = /^(browser-\d+|pdf-worker|audio-capture|docling)$/;
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
      "observe",
      "telemetry",
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
    const full = prod({}, ["pdf", "observability"]);
    for (const [name, service] of Object.entries(full.services)) {
      expect(Number(service.mem_limit), name).toBeGreaterThan(0);
      expect(Number(service.cpus), name).toBeGreaterThan(0);
      expect(service.pids_limit, name).toBeGreaterThan(0);
      if (CONTAINER_LOGS.test(name))
        expect(service.logging, name).toMatchObject({
          driver: "fluentd",
          options: {
            "fluentd-address": "127.0.0.1:24224",
            "fluentd-async": "true",
            mode: "non-blocking",
            "cache-max-size": expect.any(String),
            "cache-max-file": expect.any(String),
          },
        });
      else
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

  it("records slot audio only in audio-capture: no env, read-only, on pulse and audio only, the slots' only Pulse peer (B4 I7)", () => {
    const capture = config.services["audio-capture"]!;
    expect(capture.image).toBe("mastertutor/audio-capture:prod");
    expect(capture.environment ?? {}).toEqual({});
    expect(capture.read_only).toBe(true);
    expect(capture.user).toBe("1000:1000");
    expect(capture.cap_drop).toEqual(["ALL"]);
    expect(Object.keys(capture.networks ?? {}).sort()).toEqual(["audio", "pulse"]);
    const address = capture.networks!.pulse!.ipv4_address;
    for (const slot of slots)
      expect(env(config.services[slot]).PULSE_ALLOWED_IP, slot).toBe(address);
    expect(Object.keys(config.services.agent!.networks ?? {})).not.toContain("pulse");
    expect(Object.keys(config.services.web!.networks ?? {})).not.toContain("audio");
    expect(env(config.services.agent).AUDIO_CAPTURE_URL).toBe("http://audio-capture:5003");
    expect(prodModeProblems(config)).toEqual([]);
  });

  it("runs docling under the pdf profile on its own network, wired to the agent (P9-32, D42)", () => {
    const pdf = prod({}, ["pdf"]);
    const docling = pdf.services.docling!;
    expect(Object.keys(docling.networks ?? {})).toEqual(["pdf"]);
    expect(pdf.networks.pdf).toMatchObject({ internal: true });
    expect(pdf.networks.pdf?.external).toBeFalsy();
    expect(Object.keys(pdf.services.agent!.networks ?? {}).sort()).toEqual([
      "audio",
      "backend",
      "cdp",
      "pdf",
      "telemetry",
    ]);
    expect(env(pdf.services.agent).DOCLING_URL).toBe("http://docling:5001");
    expect(docling.ports ?? []).toEqual([]);
    expect(Number(docling.mem_limit)).toBeGreaterThan(0);
    expect(Number(docling.cpus)).toBeGreaterThan(0);
    expect(docling.pids_limit).toBeGreaterThan(0);
    expect(docling.logging).toMatchObject({ driver: "fluentd" });
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
      traefik.http.routers.mastertutor-observability-session.tls.certresolver: !reset null
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
      env: {
        ...OBSERVABILITY_SECRETS,
        DOMAIN: "localhost",
        TRAEFIK_ENTRYPOINT: "web",
        TRAEFIK_TLS: "false",
      },
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

describe("the D47 bench stack", () => {
  it("is production mode: AGENT_TEST_MODE=0, no WEB_FIXTURE_API, no llm-mock", () => {
    const bench = composeConfig(".env.test", PROD_LIKE_LOCAL_FILES, {
      env: {
        ...OBSERVABILITY_SECRETS,
        DOMAIN: "localhost",
        TRAEFIK_ENTRYPOINT: "web",
        TRAEFIK_TLS: "false",
      },
      profiles: ["pdf", "observability"],
    });
    expect(env(bench.services.agent).AGENT_TEST_MODE).toBe("0");
    for (const [name, service] of Object.entries(bench.services)) {
      expect(Object.keys(env(service)), name).not.toContain("WEB_FIXTURE_API");
    }
    expect(bench.services["llm-mock"]).toBeUndefined();
    // Its loopback Traefik is the one local exception (final review I1): accepted for the bench
    // and smoke checks, refused by production's check-env.
    expect(prodModeProblems(bench, { localIngress: true })).toEqual([]);
    expect(prodModeProblems(bench)).toEqual(["service traefik: not a production service (D47)"]);
  });

  it("passes the local prod smoke's preflight (final review I1)", () => {
    expect(
      localPreflightProblems(".env.test", {
        ...OBSERVABILITY_SECRETS,
        DOMAIN: "localhost",
        TRAEFIK_ENTRYPOINT: "web",
        TRAEFIK_TLS: "false",
      }),
    ).toEqual([]);
  });
});

describe("observability in production (D50)", () => {
  const obs = prod({}, ["pdf", "observability"]);
  const R = "traefik.http.routers.mastertutor-observability";
  const A = "traefik.http.middlewares.mastertutor-observability-auth.forwardauth";

  it("serves OpenObserve on obs.<DOMAIN> only through owner ForwardAuth (D50 ruling I-2)", () => {
    const l = labels(obs.services.openobserve);
    expect(l[`${R}.rule`]).toBe(observabilityRouterRule(DOMAIN));
    expect(l[`${R}.priority`]).toBe("900");
    expect(l[`${R}.entrypoints`]).toBe("websecure");
    expect(l[`${R}.tls`]).toBe("true");
    expect(l[`${R}.tls.certresolver`]).toBe("letsencrypt");
    expect(l[`${R}.middlewares`]).toBe(
      "mastertutor-observability-root,mastertutor-observability-auth,mastertutor-live-headers",
    );
    // `docker compose config` prints a literal `$` escaped as `$$`.
    const root = "traefik.http.middlewares.mastertutor-observability-root.redirectregex";
    expect(l[`${root}.regex`]!.replaceAll("$$", "$")).toBe("^(https?://[^/]+)/?$");
    expect(l[`${root}.replacement`]!.replaceAll("$$", "$")).toBe("${1}/observability/web/");
    expect(env(obs.services.openobserve).ZO_WEB_URL).toBe(`https://obs.${DOMAIN}/observability`);
    expect(l[`${A}.address`]).toBe(observabilityForwardAuthAddress());
    expect(l[`${A}.authResponseHeaders`]).toBe("Authorization,Cookie");
    expect(l[`${A}.trustForwardHeader`]).toBe("false");
    expect(l["traefik.docker.network"]).toBe("mastertutor-obs");
    expect(obs.services.openobserve!.ports ?? []).toEqual([]);
    expect(obs.networks["observe-edge"]).toMatchObject({ name: "mastertutor-obs", external: true });
    const other = prod({ CDP_SUBNET_PREFIX: "10.231.7" }, ["observability"]);
    expect(labels(other.services.openobserve)[`${A}.address`]).toBe(
      observabilityForwardAuthAddress("10.231.7"),
    );
  });

  it("routes the obs host's session path to web, above OpenObserve and without ForwardAuth, and leaves the app's /observability to web", () => {
    const S = "traefik.http.routers.mastertutor-observability-session";
    const web = labels(obs.services.web);
    expect(web[`${S}.rule`]).toBe(observabilitySessionRouterRule(DOMAIN));
    expect(Number(web[`${S}.priority`])).toBeGreaterThan(900);
    expect(web[`${S}.service`]).toBe("mastertutor-web");
    expect(web[`${S}.tls.certresolver`]).toBe("letsencrypt");
    expect(web).not.toHaveProperty(`${S}.middlewares`);
    const rules = Object.values(obs.services).flatMap((service) =>
      Object.entries(labels(service))
        .filter(([key]) => key.endsWith(".rule"))
        .map(([, rule]) => rule),
    );
    const appHost = `Host(\`${DOMAIN}\`)`;
    expect(
      rules.filter((rule) => rule.includes(appHost) && rule.includes(OBSERVABILITY_APP_PATH)),
    ).toEqual([]);
  });

  it("separates the observer ingress from the OpenObserve external network", () => {
    const external = Object.entries(obs.networks).filter(([, network]) => network.external);
    expect(external.map(([key, network]) => [key, network.name]).sort()).toEqual([
      ["cdp", "mastertutor-cdp"],
      ["observe-edge", "mastertutor-obs"],
      ["observer-edge", "mastertutor-observer"],
    ]);
    expect(Object.keys(obs.services.openobserve!.networks ?? {}).sort()).toEqual([
      "observe",
      "observe-edge",
      "observe-store",
    ]);
    expect(Object.keys(obs.services.garage!.networks ?? {}).sort()).toEqual([
      "backend",
      "observe-store",
    ]);
    for (const network of ["telemetry", "observe", "observe-store"])
      expect(obs.networks[network], network).toMatchObject({ internal: true });
  });

  it("points web and agent at the collector, the collector at OpenObserve, and the agent preloads telemetry", () => {
    expect(env(obs.services.web).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel-collector:4318");
    expect(env(obs.services.agent).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel-collector:4318");
    expect(env(obs.services["otel-collector"]).OBSERVE_OTLP_ENDPOINT).toBe(
      o2OtlpEndpoint("http://openobserve:5080", "default"),
    );
    expect(obs.services.agent!.command).toEqual([
      "node",
      "--import",
      "./packages/telemetry/src/register-agent.ts",
      "apps/agent/src/main.ts",
    ]);
  });

  it("publishes the collector's fluent-forward port on loopback only, and nothing else new", () => {
    expect(obs.services["otel-collector"]!.ports).toEqual([
      expect.objectContaining({ target: 24224, published: "24224", host_ip: "127.0.0.1" }),
    ]);
    for (const name of ["openobserve", "observability-init"])
      expect(obs.services[name]!.ports ?? [], name).toEqual([]);
  });

  it("keeps the workers' networks and empty env (final I8) while their logs reach the collector", () => {
    for (const name of ["pdf-worker", "audio-capture"])
      expect(obs.services[name]!.environment ?? {}).toEqual({});
    expect(prodModeProblems(obs)).toEqual([]);
  });
});

describe("Copilot deployment (D52)", () => {
  const config = prod({}, ["observability"]);
  const observer = config.services.observer!;
  it("routes only the app Copilot prefix through credential-replacing ForwardAuth", () => {
    const l = labels(observer);
    expect(l["traefik.docker.network"]).toBe("mastertutor-observer");
    expect(l["traefik.http.routers.mastertutor-observer.rule"]).toBe(observerRouterRule(DOMAIN));
    expect(l["traefik.http.routers.mastertutor-observer.priority"]).toBe("960");
    expect(l["traefik.http.middlewares.mastertutor-observer-auth.forwardauth.address"]).toBe(
      observerForwardAuthAddress(),
    );
    expect(
      l["traefik.http.middlewares.mastertutor-observer-auth.forwardauth.authResponseHeaders"],
    ).toBe("Authorization,Cookie,X-Mt-User,X-Mt-Workspace");
    expect(
      l["traefik.http.middlewares.mastertutor-observer-auth.forwardauth.trustForwardHeader"],
    ).toBe("false");
    expect(l["traefik.http.services.mastertutor-observer.loadbalancer.server.port"]).toBe("4000");
  });
  it("uses only the view role and private service networks with no published port", () => {
    expect(observer.ports ?? []).toEqual([]);
    expect(new URL(env(observer).DATABASE_URL!).username).toBe("observer_role");
    expect(env(observer).OPENAI_BASE_URL).toBe("");
    expect(Object.keys(observer.networks ?? {}).sort()).toEqual([
      "observer-db",
      "observer-edge",
      "observer-egress",
      "observer-query",
      "telemetry",
    ]);
    expect(config.networks["observer-db"]).toMatchObject({ internal: true });
    expect(
      Object.entries(config.services)
        .filter(([, service]) => "observer-db" in (service.networks ?? {}))
        .map(([name]) => name)
        .sort(),
    ).toEqual(["observer", "postgres"]);
    const proxy = config.services["observer-query"]!;
    expect(proxy.image).toBe(observer.image);
    expect(proxy.command).toEqual(["node", "apps/observer/src/query-proxy-main.ts"]);
    expect(env(observer).OBSERVE_COPILOT_PASSWORD).toBeUndefined();
    expect(env(observer).OBSERVE_URL).toBeUndefined();
    expect(env(observer).OBSERVER_QUERY_URL).toBe("http://observer-query:4001");
    expect(env(proxy).OBSERVE_COPILOT_PASSWORD).toBeTruthy();
    expect(env(proxy).OPENAI_API_KEY).toBeUndefined();
    expect(proxy.ports ?? []).toEqual([]);
    expect(Object.keys(proxy.networks ?? {}).sort()).toEqual(["observe", "observer-query"]);
    expect(config.networks["observer-query"]).toMatchObject({ internal: true });
    expect(
      Object.entries(config.services)
        .filter(([, service]) => "observer-query" in (service.networks ?? {}))
        .map(([name]) => name)
        .sort(),
    ).toEqual(["observer", "observer-query"]);
    expect(observer.image).toBe("mastertutor/observer:prod");
    expect(observer.read_only).toBe(true);
    expect(observer.user).toBe("1000:1000");
    expect(prodModeProblems(config)).toEqual([]);
  });
});

it("keeps the Copilot same-origin write guard aligned with the TLS test app", () => {
  const config = composeConfig(
    ".env.test",
    [
      "compose.yml",
      "compose.test.yml",
      "tests/observability/compose.observability.yml",
      "tests/observability/compose.suite.yml",
    ],
    {
      profiles: ["observability", "e2e"],
      env: {
        ...OBSERVABILITY_SECRETS,
        TEST_HTTP_PORT: "28081",
        MT_OBS_TLS_DIR: "/tmp/observer-test-tls",
      },
    },
  );
  expect(env(config.services.observer).PUBLIC_URL).toBe(env(config.services.web).BETTER_AUTH_URL);
});
