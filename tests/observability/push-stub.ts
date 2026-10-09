// A stand-in push service for the observability suite (compose.suite.yml): accepts any Web Push
// POST over TLS and logs one JSON line per request, with what the suite checks (never the body).
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

createServer(
  { key: readFileSync("/tls/key.pem"), cert: readFileSync("/tls/cert.pem") },
  (req, res) => {
    let bytes = 0;
    req.on("data", (chunk: Buffer) => (bytes += chunk.length));
    req.on("end", () => {
      console.log(
        JSON.stringify({
          push: true,
          method: req.method,
          path: req.url,
          encoding: req.headers["content-encoding"],
          ttl: req.headers["ttl"],
          vapid: String(req.headers["authorization"] ?? "").startsWith("vapid t="),
          bytes,
        }),
      );
      res.writeHead(201).end();
    });
  },
).listen(443, () => console.log("push stub ready"));
