import { SCENARIOS } from "./scenarios/index.ts";
import { startLlmMock } from "./server.ts";

const port = Number(process.env.PORT ?? "8090");
const mock = await startLlmMock({ port, scenarios: SCENARIOS });
console.log(JSON.stringify({ listening: mock.url }));
