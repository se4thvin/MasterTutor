import { createHash, randomBytes, randomInt, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buildReactLogin } from "./build-react.ts";
import * as page from "./pages.ts";
import { sendMail } from "./smtp.ts";
import { codesEqual, verifyTotp } from "./totp.ts";

export const FIXTURE_HOSTS = {
  login: "login.fixtures.test",
  lookalike: "log1n.fixtures.test",
  other: "other.fixtures.test",
  // Another site (out-of-process iframes) that B1's network policy treats as a fixture host, so a
  // navigation to it is reported as a new origin instead of silently dropped (R-E12).
  evil: "evil.fixtures-isolated.test",
} as const;
export type FixtureHost = keyof typeof FIXTURE_HOSTS;
export const FIXTURE_MAIL_FROM = "no-reply@fixtures.test";

export interface FixtureAccount {
  email: string;
  password: string;
  totpSeed: string;
  pin: string;
}

export interface RecordedRequest {
  host: string;
  method: string;
  path: string;
  body: string;
}

export interface VaultFixtures {
  readonly port: number;
  origin(host: FixtureHost): string;
  readonly requests: RecordedRequest[];
  /** Every fixture origin, in FIXTURE_HOSTS order. */
  readonly origins: readonly string[];
  lastEmailCode(): string | null;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > 65_536) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

const html = (
  res: ServerResponse,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
) => send(res, status, "text/html; charset=utf-8", body, headers);

/** Fixture login site, WebAuthn site and injection page (spec §12), all on one in-process server. */
export async function startVaultFixtures(options: {
  account: FixtureAccount;
  mail: { smtpHost: string; smtpPort: number; to: string } | null;
}): Promise<VaultFixtures> {
  const { account } = options;
  const reactBundle = await readFile(await buildReactLogin());
  const requests: RecordedRequest[] = [];
  const sessions = new Set<string>();
  const passkeys = new Map<string, Buffer>();
  const challenges = new Set<string>();
  let emailCode: string | null = null;
  let port = 0;
  const origin = (host: FixtureHost) => `http://${FIXTURE_HOSTS[host]}:${port}`;

  function signedIn(req: IncomingMessage): string | null {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
    return sid !== null && sessions.has(sid) ? sid : null;
  }

  function verifyAssertion(
    input: Record<string, string>,
    expectedOrigin: string,
    rpId: string,
  ): boolean {
    const spki = passkeys.get(input.id ?? "");
    if (!spki || !input.clientDataJSON || !input.authenticatorData || !input.signature)
      return false;
    const clientData = Buffer.from(input.clientDataJSON, "base64url");
    const parsed = JSON.parse(clientData.toString("utf8")) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
    if (
      parsed.type !== "webauthn.get" ||
      parsed.origin !== expectedOrigin ||
      !challenges.delete(parsed.challenge ?? "")
    )
      return false;
    const authData = Buffer.from(input.authenticatorData, "base64url");
    if (!authData.subarray(0, 32).equals(createHash("sha256").update(rpId).digest())) return false;
    if (((authData[32] ?? 0) & 0x05) !== 0x05) return false; // user present + user verified
    const signed = Buffer.concat([authData, createHash("sha256").update(clientData).digest()]);
    return verify(
      "sha256",
      signed,
      { key: spki, format: "der", type: "spki" },
      Buffer.from(input.signature, "base64url"),
    );
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = (req.headers.host ?? "").split(":")[0] ?? "";
    const url = new URL(req.url ?? "/", "http://fixture");
    const method = req.method ?? "GET";
    const body = method === "POST" ? await readBody(req) : "";
    requests.push({ host, method, path: url.pathname, body });
    const route = `${method} ${url.pathname}`;

    if (host === FIXTURE_HOSTS.evil || host === FIXTURE_HOSTS.other) {
      if (route === "GET /frame") return html(res, page.evilFrame());
      if (route === "GET /frame-domain")
        return html(res, page.domainChild(), 200, { "origin-agent-cluster": "?0" });
      if (route === "GET /landing") return html(res, page.evilLanding());
      if (route === "GET /steal") return html(res, page.message("Stolen"));
      if (route === "POST /collect") return send(res, 204, "text/plain", "");
      return send(res, 404, "text/plain", "not found");
    }
    if (host !== FIXTURE_HOSTS.login && host !== FIXTURE_HOSTS.lookalike)
      return send(res, 404, "text/plain", "unknown host");
    const here = `http://${host}:${port}`;
    const form = new URLSearchParams(body);
    const json = () => JSON.parse(body || "{}") as Record<string, string>;

    switch (route) {
      case "GET /":
        return html(res, page.index());
      case "GET /password":
        return html(res, page.passwordLogin());
      case "GET /echo":
        return html(res, page.echo());
      case "POST /password": {
        if (form.get("email") !== account.email || form.get("password") !== account.password) {
          return html(res, page.message("Wrong credentials"), 401);
        }
        const sid = randomBytes(16).toString("hex");
        sessions.add(sid);
        return send(res, 303, "text/plain", "", {
          location: "/account",
          "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        });
      }
      case "GET /account": {
        const sid = signedIn(req);
        if (sid === null) return send(res, 303, "text/plain", "", { location: "/password" });
        return html(res, page.account(`tok-${sid.slice(0, 8)}`));
      }
      case "GET /logout": {
        const sid = signedIn(req);
        if (sid !== null) sessions.delete(sid);
        return send(res, 303, "text/plain", "", {
          location: "/password",
          "set-cookie": "sid=; Path=/; Max-Age=0",
        });
      }
      case "GET /react":
        return html(res, page.reactLogin());
      case "GET /react-login.js":
        return send(res, 200, "text/javascript", reactBundle);
      case "POST /api/login": {
        const input = json();
        const ok = input.email === account.email && input.password === account.password;
        return send(res, ok ? 200 : 401, "application/json", JSON.stringify({ ok }));
      }
      case "GET /totp":
        return html(res, page.totp());
      case "POST /totp":
        return verifyTotp(account.totpSeed, form.get("code") ?? "", Date.now())
          ? html(res, page.message("TOTP accepted"))
          : html(res, page.message("TOTP rejected"), 401);
      case "GET /pin":
        return html(res, page.splitPin(account.pin.length, false));
      case "GET /pin-autosubmit":
        return html(res, page.splitPin(account.pin.length, true));
      case "POST /pin": {
        const pin = Array.from(
          { length: account.pin.length },
          (_, i) => form.get(`d${i}`) ?? "",
        ).join("");
        return codesEqual(account.pin, pin)
          ? html(res, page.message("PIN accepted"))
          : html(res, page.message("PIN rejected"), 401);
      }
      case "GET /email-otp":
        return html(res, page.emailOtp());
      case "POST /email-otp/send": {
        if (!options.mail) return send(res, 503, "text/plain", "mail disabled");
        emailCode = String(randomInt(100_000, 1_000_000));
        await sendMail(options.mail.smtpHost, options.mail.smtpPort, {
          from: FIXTURE_MAIL_FROM,
          to: options.mail.to,
          subject: "Your verification code",
          text: `Your one-time verification code is ${emailCode}. It expires in 5 minutes.\n\n(c) 2026 Fixtures Inc.`,
        });
        return send(res, 204, "text/plain", "");
      }
      case "POST /email-otp": {
        const code = Array.from({ length: 6 }, (_, i) => form.get(`c${i}`) ?? "").join("");
        return emailCode !== null && codesEqual(emailCode, code)
          ? html(res, page.message("Code accepted"))
          : html(res, page.message("Code rejected"), 401);
      }
      case "GET /text-trap":
        return html(res, page.textTrap());
      case "GET /tampered":
        return html(res, page.tampered());
      case "GET /iframe-same-site":
        return html(res, page.framed(`${origin("other")}/frame`));
      case "GET /iframe-same-origin":
        return html(res, page.framed(`${here}/child-frame`));
      case "GET /child-frame":
        return html(res, page.childFrame());
      case "GET /iframe-domain":
        return html(res, page.domainParent(`${origin("other")}/frame-domain`), 200, {
          "origin-agent-cluster": "?0",
        });
      case "GET /rewrite":
        return html(res, page.rewrite());
      case "GET /hidden-decoys":
        return html(res, page.hiddenDecoys());
      case "GET /offsite-form":
        return html(res, page.offsiteForm(`${origin("evil")}/collect`, null));
      case "GET /shadowed-action":
        return html(res, page.shadowedAction(`${origin("evil")}/collect`));
      case "GET /javascript-action":
        return html(res, page.shadowedAction("javascript:void 0"));
      case "GET /offsite-button":
        return html(res, page.offsiteForm("/password", `${origin("evil")}/collect`));
      case "GET /show-details":
        return html(res, page.showDetails());
      case "GET /iframe-cross-site":
        return html(res, page.framed(`${origin("evil")}/frame`));
      case "GET /redirect":
        return html(res, page.redirectingPin(account.pin.length, `${origin("evil")}/landing`));
      case "GET /injection":
        return html(res, page.injection(origin("evil")));
      case "GET /download/report.csv":
        return send(res, 200, "text/csv", "a,b\n1,2\n");
      case "GET /webauthn/register":
        return html(res, page.webauthnRegister());
      case "GET /webauthn/login":
        return html(res, page.webauthnLogin());
      case "GET /webauthn/challenge": {
        const challenge = randomBytes(32).toString("base64url");
        challenges.add(challenge);
        return send(res, 200, "application/json", JSON.stringify({ challenge }));
      }
      case "POST /webauthn/register": {
        const input = json();
        if (!input.id || !input.publicKey) return send(res, 400, "text/plain", "bad request");
        passkeys.set(input.id, Buffer.from(input.publicKey, "base64url"));
        return send(res, 200, "application/json", JSON.stringify({ ok: true }));
      }
      case "POST /webauthn/login": {
        const ok = verifyAssertion(json(), here, host);
        return send(res, ok ? 200 : 401, "application/json", JSON.stringify({ ok }));
      }
      case "GET /visible":
        return html(res, page.visible(url.searchParams.get("t") ?? ""));
      default:
        return send(res, 404, "text/plain", "not found");
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return {
    port,
    origin,
    requests,
    origins: (Object.keys(FIXTURE_HOSTS) as FixtureHost[]).map((host) => origin(host)),
    lastEmailCode: () => emailCode,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
