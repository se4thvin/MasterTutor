import { readFileSync } from "node:fs";
import {
  LIVE_STRIP_REGEX,
  MAX_UPLOAD_BYTES,
  liveForwardAuthAddress,
  liveRouterRule,
  liveUploadRouterRule,
} from "@mastertutor/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { composeConfig, type ComposeConfig } from "./compose-json.ts";

const dynamic = readFileSync(
  new URL("../../infra/traefik/test-dynamic.yml", import.meta.url),
  "utf8",
);
let base: ComposeConfig;
let live: ComposeConfig;

beforeAll(() => {
  base = composeConfig(".env.test", ["compose.yml"]);
  // B6's live overlay is folded into compose.test.yml (Phase 7 Task 1, P7-5).
  live = composeConfig(".env.test", ["compose.yml", "compose.test.yml"]);
});

describe("test file-provider live routers (spec §10.2.2)", () => {
  it("route each slot with the single rule source", () => {
    for (const slot of ["browser-1", "browser-2"]) {
      expect(dynamic).toContain(`rule: '${liveRouterRule(slot, "localhost")}'`);
      expect(dynamic).toContain(`url: http://${slot}:8080`);
    }
    expect(dynamic.match(/middlewares: \[live-auth, live-strip, live-headers\]/g)).toHaveLength(2);
    expect(dynamic.match(/priority: 1000/g)).toHaveLength(2);
    // Either YAML quoting (Prettier writes double quotes).
    expect(dynamic).toMatch(
      new RegExp(`- ["']${LIVE_STRIP_REGEX.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&")}["']`),
    );
  });

  it("send ForwardAuth to web's static cdp address and copy back only the Cookie header (D41, S3)", () => {
    const webIp = base.services.web!.networks!.cdp!.ipv4_address!;
    const address = `http://${webIp}:3000/api/live/auth`;
    expect(address).toBe(liveForwardAuthAddress(webIp.split(".").slice(0, 3).join(".")));
    expect(dynamic).toContain(`address: ${address}`);
    expect(dynamic).not.toContain("http://web:3000/api/live/auth");
    expect(dynamic).toMatch(/authResponseHeaders:\s*\n\s*- Cookie\s*\n/);
    // Only web's own X-Forwarded-* reach the auth check; a client cannot supply them.
    expect(dynamic).toContain("trustForwardHeader: false");
    expect(webIp.endsWith(".11")).toBe(true);
  });

  it("cap an upload's body at MAX_UPLOAD_BYTES, after authentication (I2, carried to A14)", () => {
    for (const slot of ["browser-1", "browser-2"]) {
      expect(dynamic).toContain(`rule: '${liveUploadRouterRule(slot, "localhost")}'`);
    }
    // Authenticated first: nobody without a live session gets 100 MiB buffered.
    expect(
      dynamic.match(/middlewares: \[live-auth, live-upload-limit, live-strip, live-headers\]/g),
    ).toHaveLength(2);
    expect(dynamic.match(/priority: 1001/g)).toHaveLength(2);
    expect(dynamic).toContain(`maxRequestBodyBytes: ${MAX_UPLOAD_BYTES}`);
  });

  it("pins the n.eko base image by digest (S4: the same-origin client never changes underneath)", () => {
    const dockerfile = readFileSync(
      new URL("../../apps/browser-slot/Dockerfile", import.meta.url),
      "utf8",
    );
    expect(dockerfile).toMatch(
      /^FROM ghcr\.io\/m1k1o\/neko\/chromium:3\.1\.6@sha256:[0-9a-f]{64}$/m,
    );
  });

  it("rebuilds n.eko's server from pinned sources with the pion TCP-mux fix (I1), licences kept", () => {
    const dockerfile = readFileSync(
      new URL("../../apps/browser-slot/Dockerfile", import.meta.url),
      "utf8",
    );
    expect(dockerfile).toMatch(/^FROM golang:[\w.-]+@sha256:[0-9a-f]{64} AS neko-server$/m);
    // n.eko v3.1.6's tag commit, fetched by hash and checked.
    expect(dockerfile).toContain(
      'test "$(git rev-parse HEAD)" = 65fba485de2987998c7028b04240b21669d674e0',
    );
    expect(dockerfile).toContain("git apply /tmp/pion-ice-v4.2.2-tcp-mux-nat.patch");
    expect(dockerfile).toContain("COPY --from=neko-server /neko /usr/bin/neko");
    expect(dockerfile).toContain("/usr/share/doc/neko/LICENSE");
    expect(dockerfile).toContain("/usr/share/doc/neko/pion-ice.LICENSE");
    const patch = readFileSync(
      new URL("../../apps/browser-slot/neko/pion-ice-v4.2.2-tcp-mux-nat.patch", import.meta.url),
      "utf8",
    );
    expect(patch).toContain("TestTCPMux_InboundReachesAgentConnKeyedByAnotherLocalAddress");
  });

  it("add the frame and sniffing guards to everything n.eko serves (S4)", () => {
    expect(dynamic).toContain(`contentSecurityPolicy: "frame-ancestors 'self'"`);
    expect(dynamic).toContain("contentTypeNosniff: true");
  });
});

describe("compose stays production-neutral (S6, S7, D42)", () => {
  it("puts no Traefik labels and no TURN settings on slots; Phase 9 owns production routing", () => {
    for (const [name, service] of Object.entries(base.services)) {
      expect(
        Object.keys(service.labels ?? {}).filter((k) => k.startsWith("traefik.")),
        name,
      ).toEqual([]);
      if (name.startsWith("browser-"))
        expect(
          Object.keys(service.environment ?? {}).filter((k) => k.startsWith("TURN_")),
          name,
        ).toEqual([]);
    }
    expect(base.services.coturn).toBeUndefined();
  });

  it("the live overlay runs two slots and tells migrate about both", () => {
    expect(
      Object.entries(live.services)
        .filter(([name, s]) => name.startsWith("browser-") && (s.profiles ?? []).length === 0)
        .map(([name]) => name)
        .sort(),
    ).toEqual(["browser-1", "browser-2"]);
    expect(live.services.migrate!.environment!.BROWSER_SLOTS).toBe("browser-1,browser-2");
  });
});
