// Benchmark fixture (test-only, no dependencies). A consent overlay, a sign-in form, then a book with
// three participation activities. Progress is kept server-side, so a separate run can verify completion
// from the page. Interactive elements sit at fixed coordinates for the scripted mock runs.
// /__reset answers only loopback peers: the harness reaches it with `docker compose exec`, never
// over the network, so neither the agent nor a slot can reset progress.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const ACTIVITIES = ["a1", "a2", "a3"] as const;
type ActivityId = (typeof ACTIVITIES)[number];
const MAX_BODY = 10_000;

export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const CONSENT = `<div id="consent" role="dialog" aria-modal="true" aria-label="Cookie consent"
style="position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.45)"><div style="position:absolute;left:0;right:0;bottom:0;height:120px;background:#fff">
<p style="position:absolute;left:40px;top:20px;margin:0">This site uses cookies.</p>
<button class="at" style="left:1000px;top:38px;width:200px"
onclick="document.cookie='consent=1; Path=/; SameSite=Lax';document.getElementById('consent').remove()">Accept</button></div></div>`;

function page(req: IncomingMessage, title: string, body: string): string {
  const consented = /(?:^|;\s*)consent=1(?:;|$)/.test(req.headers.cookie ?? "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;font:16px system-ui;background:#fff}.at{position:absolute}.f{width:400px;height:44px;box-sizing:border-box}
button.at,input.at{height:44px;box-sizing:border-box}</style></head><body>${body}${consented ? "" : CONSENT}</body></html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > MAX_BODY) throw new Error("body too large");
  }
  return data;
}

export async function startFixtureServer(options: {
  user: string;
  password: string;
  port: number;
}): Promise<{ url: string; close(): Promise<void> }> {
  const sessions = new Set<string>();
  const done = new Set<ActivityId>();
  const signedIn = (req: IncomingMessage) => {
    const id = /(?:^|;\s*)sid=([a-f0-9]{32})/.exec(req.headers.cookie ?? "")?.[1];
    return id !== undefined && sessions.has(id);
  };
  const send = (
    res: ServerResponse,
    status: number,
    html = "",
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(html);
  };
  const status = (id: ActivityId, n: number) =>
    done.has(id)
      ? `<span role="img" aria-label="Activity ${n} completed">✓ Activity ${n} completed</span>`
      : `<span role="img" aria-label="Activity ${n} not completed">○ Activity ${n} not completed</span>`;
  const progress = () =>
    `Participation: ${done.size} of 3 activities completed (${Math.round((done.size / 3) * 100)}%)`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    try {
      if (url.pathname === "/healthz") return send(res, 200, "ok");
      if (url.pathname === "/__reset" && req.method === "POST") {
        if (!isLoopback(req.socket.remoteAddress)) return send(res, 403);
        sessions.clear();
        done.clear();
        return send(res, 204);
      }
      if (url.pathname === "/signin" && req.method === "GET") {
        return send(
          res,
          200,
          page(
            req,
            "Sign in",
            `<h1 class="at" style="left:440px;top:180px">Sign in</h1>
<form method="post" action="/signin">
<input class="at f" style="left:440px;top:280px" name="email" type="email" autocomplete="username" aria-label="Email">
<input class="at f" style="left:440px;top:350px" name="password" type="password" autocomplete="current-password" aria-label="Password">
<button class="at f" style="left:440px;top:420px" type="submit">Sign in</button></form>`,
          ),
        );
      }
      if (url.pathname === "/signin" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        if (form.get("email") !== options.user || form.get("password") !== options.password) {
          return send(res, 401, page(req, "Sign in", "<p>Wrong email or password.</p>"));
        }
        const id = randomBytes(16).toString("hex");
        sessions.add(id);
        return send(res, 303, "", {
          location: "/book",
          "set-cookie": `sid=${id}; HttpOnly; SameSite=Lax; Path=/`,
        });
      }
      if (!signedIn(req)) return send(res, 303, "", { location: "/signin" });
      if (url.pathname === "/book") {
        return send(
          res,
          200,
          page(
            req,
            "Book",
            `<h1 class="at" style="left:440px;top:120px">Fixture Book</h1>
<p class="at" style="left:440px;top:200px">${progress()}</p>
<a class="at f" style="left:440px;top:300px;display:block;line-height:44px" href="/book/activities">Section 1.1 activities</a>`,
          ),
        );
      }
      if (url.pathname === "/book/activities") {
        return send(
          res,
          200,
          page(
            req,
            "Section 1.1",
            `<a class="at" style="left:1000px;top:40px;width:200px;height:44px;line-height:44px;display:block" href="/book">Back to book</a>
<p class="at" style="left:200px;top:60px">${progress()}</p>
<h2 class="at" style="left:200px;top:140px;margin:0">PARTICIPATION ACTIVITY 1: Which planet is the Red Planet? ${status("a1", 1)}</h2>
<label class="at" style="left:40px;top:200px;width:120px;height:44px"><input type="radio" name="p" value="venus"> Venus</label>
<label class="at" style="left:200px;top:200px;width:160px;height:44px"><input type="radio" name="p" value="mars"> Mars</label>
<button class="at" style="left:420px;top:200px;width:120px" onclick="if(document.querySelector('input[value=mars]').checked)complete('a1')">Check</button>
<h2 class="at" style="left:200px;top:330px;margin:0">PARTICIPATION ACTIVITY 2: Press Start, then Next twice ${status("a2", 2)}</h2>
<button class="at" style="left:200px;top:390px;width:120px" onclick="window.s=1">Start</button>
<button class="at" style="left:340px;top:390px;width:120px" onclick="if(window.s&&++window.s>=3)complete('a2')">Next</button>
<h2 class="at" style="left:200px;top:520px;margin:0">PARTICIPATION ACTIVITY 3: Type the number 42 ${status("a3", 3)}</h2>
<input class="at" style="left:200px;top:580px;width:160px" aria-label="Answer" id="a3">
<button class="at" style="left:380px;top:580px;width:120px" onclick="if(document.getElementById('a3').value.trim()==='42')complete('a3')">Check</button>
<script>function complete(id){fetch('/api/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}).then(()=>location.reload())}</script>`,
          ),
        );
      }
      if (url.pathname === "/api/complete" && req.method === "POST") {
        const id = (JSON.parse(await readBody(req)) as { id?: unknown }).id;
        if (!ACTIVITIES.includes(id as ActivityId)) return send(res, 400);
        done.add(id as ActivityId);
        return send(res, 204);
      }
      return send(res, 404, "Not found");
    } catch {
      return send(res, 400);
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const user = process.env.BENCH_FIXTURE_USER ?? "";
  const password = process.env.BENCH_FIXTURE_PASSWORD ?? "";
  if (!user || !password)
    throw new Error("BENCH_FIXTURE_USER and BENCH_FIXTURE_PASSWORD are required");
  const { url } = await startFixtureServer({
    user,
    password,
    port: Number(process.env.PORT ?? 8080),
  });
  console.log(`bench-activities on ${url}`);
}
