/**
 * The agent's preload (spec §6.3): node --import ./packages/telemetry/src/register-agent.ts
 * apps/agent/src/main.ts. Instrumentations must be registered before the AWS SDK first loads
 * node:http, which happens while main.ts's imports are evaluated.
 */
import { preload } from "./preload.ts";
preload("agent");
