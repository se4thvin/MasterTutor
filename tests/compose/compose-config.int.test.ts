import { AgentEnv, GarageInitEnv, MigrateEnv, WebEnv, parseEnv } from "@mastertutor/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { composeConfig, type ComposeConfig, type ComposeService } from "./compose-json.ts";

const load = (files: string[]): ComposeConfig => composeConfig(".env.test", files);
const env = (service: ComposeService) =>
  Object.fromEntries(
    Object.entries(service.environment ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
const nets = (service: ComposeService) => Object.keys(service.networks ?? {}).sort();
const slots = ["browser-1", "browser-2", "browser-3", "browser-4", "browser-5", "browser-6"];

let base: ComposeConfig;
let test: ComposeConfig;
beforeAll(() => {
  base = load(["compose.yml"]);
  test = load(["compose.yml", "compose.test.yml"]);
});

describe("compose.yml", () => {
  it("gives no service a TURN setting (D42)", () => {
    for (const [name, service] of Object.entries(base.services)) {
      expect(
        Object.keys(env(service)).filter((key) => key.startsWith("TURN_")),
        name,
      ).toEqual([]);
    }
  });
  it("defines the Phase 0 services and six always-on slots", () => {
    expect(Object.keys(base.services).sort()).toEqual(
      ["agent", "garage", "garage-init", "migrate", "postgres", "web", ...slots].sort(),
    );
  });

  it("gives every service an env that its contract accepts", () => {
    expect(() => parseEnv(WebEnv, env(base.services.web!))).not.toThrow();
    expect(() => parseEnv(AgentEnv, env(base.services.agent!))).not.toThrow();
    expect(() => parseEnv(MigrateEnv, env(base.services.migrate!))).not.toThrow();
    expect(() => parseEnv(GarageInitEnv, env(base.services["garage-init"]!))).not.toThrow();
  });

  it("places secrets with least privilege (spec §12 key placement)", () => {
    const web = Object.keys(env(base.services.web!));
    const agent = Object.keys(env(base.services.agent!));
    for (const key of [
      "VAULT_PRIVATE_KEY",
      "NEKO_ADMIN_SECRET",
      "S3_AGENT_ACCESS_KEY_ID",
      "S3_AGENT_SECRET_ACCESS_KEY",
    ]) {
      expect(web).not.toContain(key);
    }
    expect(web).not.toContain("OPENAI_EMBEDDINGS_KEY");
    // D36: one OpenAI key, same interpolated value in web and agent.
    expect(env(base.services.web!).OPENAI_API_KEY).toBeDefined();
    expect(env(base.services.web!).OPENAI_API_KEY).toBe(env(base.services.agent!).OPENAI_API_KEY);
    for (const key of [
      "NEKO_MEMBER_SECRET",
      "BETTER_AUTH_SECRET",
      "LIVE_COOKIE_SECRET",
      "VAULT_PUBLIC_KEY",
    ]) {
      expect(agent).not.toContain(key);
    }
    expect(env(base.services.web!).DATABASE_URL).toMatch(/^postgres:\/\/web_role:/);
    expect(env(base.services.agent!).DATABASE_URL).toMatch(/^postgres:\/\/agent_role:/);
    for (const slot of slots) {
      for (const key of Object.keys(env(base.services[slot]!))) {
        expect(key, slot).not.toMatch(
          /^(VAULT_|OPENAI_|S3_|DATABASE_URL|BETTER_AUTH|LIVE_COOKIE|TURN_)/,
        );
      }
    }
  });

  it("builds the shared node-runtime image from exactly one service", () => {
    const builders = Object.entries(base.services)
      .filter(([, service]) => service.image === "mastertutor/node-runtime:local" && service.build)
      .map(([name]) => name);
    expect(builders).toEqual(["migrate"]);
  });

  it("gives web and agent their own distinct S3 keys", () => {
    const init = env(base.services["garage-init"]!);
    const web = env(base.services.web!);
    const agent = env(base.services.agent!);
    expect(web.S3_ACCESS_KEY_ID).toBe(init.S3_WEB_ACCESS_KEY_ID);
    expect(web.S3_SECRET_ACCESS_KEY).toBe(init.S3_WEB_SECRET_ACCESS_KEY);
    expect(agent.S3_ACCESS_KEY_ID).toBe(init.S3_AGENT_ACCESS_KEY_ID);
    expect(agent.S3_SECRET_ACCESS_KEY).toBe(init.S3_AGENT_SECRET_ACCESS_KEY);
    expect(web.S3_ACCESS_KEY_ID).not.toBe(agent.S3_ACCESS_KEY_ID);
    expect(web.S3_SECRET_ACCESS_KEY).not.toBe(agent.S3_SECRET_ACCESS_KEY);
  });

  it("isolates networks", () => {
    expect(base.networks.cdp?.internal).toBe(true);
    expect(nets(base.services.postgres!)).toEqual(["backend"]);
    expect(nets(base.services.garage!)).toEqual(["backend"]);
    expect(nets(base.services.web!)).toEqual(["backend", "cdp", "edge"]);
    expect(nets(base.services.agent!)).toEqual(["backend", "cdp"]);
    expect(base.services.agent!.networks!.cdp!.ipv4_address).toBe("172.30.231.10");
    expect(base.services.web!.networks!.cdp!.ipv4_address).toBe("172.30.231.11");
    expect(base.services.agent!.cap_drop).toEqual(["ALL"]);
  });

  it("lets agent, web and Traefik reach n.eko on every slot", () => {
    for (const slot of slots) {
      expect(env(base.services[slot]!).NEKO_ALLOWED_IPS).toBe(
        "172.30.231.10,172.30.231.11,172.30.231.12",
      );
    }
  });

  it("defines slots once: only name and media port differ, and only media is published", () => {
    slots.forEach((slot, index) => {
      const service = base.services[slot]!;
      const port = String(59001 + index);
      expect(service.image).toBe("mastertutor/browser-slot:local");
      expect(nets(service)).toEqual(["cdp", "egress"]);
      expect(service.cap_add).toEqual(["NET_ADMIN"]);
      expect(service.restart).toBe("always");
      expect(service.sysctls).toEqual({
        "net.ipv6.conf.all.disable_ipv6": "1",
        "net.ipv6.conf.default.disable_ipv6": "1",
      });
      expect(
        service.security_opt?.some((opt) =>
          /seccomp=.*apps\/browser-slot\/seccomp\/chromium\.json$/.test(opt),
        ),
      ).toBe(true);
      expect(service.tmpfs?.some((t) => t.startsWith("/tmp/chromium-profile"))).toBe(true);
      expect(env(service).SLOT_NAME).toBe(slot);
      expect(env(service).NEKO_WEBRTC_UDPMUX).toBe(port);
      expect(env(service).NEKO_WEBRTC_TCPMUX).toBe(port);
      expect(
        (service.ports ?? []).map((p) => `${p.published}:${p.target}/${p.protocol}`).sort(),
      ).toEqual([`${port}:${port}/tcp`, `${port}:${port}/udp`]);
    });
    for (const name of ["postgres", "garage", "web", "agent", "migrate", "garage-init"]) {
      expect(base.services[name]!.ports ?? [], name).toEqual([]);
    }
  });
});

describe("compose.test.yml overlay", () => {
  it("runs two slots on static cdp addresses behind a loopback-only Traefik on the app's port", () => {
    const active = Object.keys(test.services).filter((name) => name.startsWith("browser-"));
    expect(active).toEqual(["browser-1", "browser-2"]);
    expect(env(test.services.agent!).BROWSER_SLOTS).toBe("browser-1,browser-2");
    expect(env(test.services.migrate!).BROWSER_SLOTS).toBe("browser-1,browser-2");
    for (const [slot, ip] of [
      ["browser-1", "172.30.231.21"],
      ["browser-2", "172.30.231.22"],
    ] as const) {
      // WebRTC advertises the slot's own cdp address: the e2e runner reaches it from Traefik's namespace.
      expect(test.services[slot]!.networks!.cdp!.ipv4_address, slot).toBe(ip);
      expect(env(test.services[slot]!).NEKO_WEBRTC_NAT1TO1, slot).toBe(ip);
    }
    const traefik = test.services.traefik!;
    expect(traefik.ports?.map((p) => `${p.host_ip}:${p.published}:${p.target}`)).toEqual([
      "127.0.0.1:18080:18080",
    ]);
    expect(traefik.command).toContain("--entrypoints.web.address=:18080");
    expect(traefik.networks!.cdp!.ipv4_address).toBe("172.30.231.12");
  });
});
