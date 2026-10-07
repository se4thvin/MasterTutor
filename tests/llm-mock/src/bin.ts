import { SCENARIOS } from "./scenarios/index.ts";
import { startLlmMock } from "./server.ts";

const port = Number(process.env.PORT ?? "8090");
// The Compose service listens on every interface (HOST=0.0.0.0); a local run stays on loopback.
const host = process.env.HOST ?? "127.0.0.1";
const mock = await startLlmMock({ port, host, scenarios: SCENARIOS });
console.log(JSON.stringify({ listening: mock.url }));
