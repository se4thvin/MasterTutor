import { randomBytes } from "node:crypto";

const NAME = /^[a-z0-9_-]{1,64}$/;
const TAG = /\[scenario:([a-z0-9_-]+)(?:#([a-z0-9]{1,32}))?\]/i;

/**
 * Tags a run's goal for the llm-mock (spec §12). The nonce gives each run its own scenario cursor,
 * so a scenario can run any number of times against one long-lived mock. The mock reads the tag
 * from the goal only (server.ts routeOf), never from page text (D26).
 */
export function scenarioGoal(name: string, text: string): string {
  if (!NAME.test(name)) throw new TypeError(`Invalid scenario name: ${name}`);
  return `[scenario:${name}#${randomBytes(6).toString("hex")}] ${text}`;
}

/** The single parser of the tag format: `[scenario:name]` or `[scenario:name#nonce]`. */
export function scenarioTag(text: string): { name: string; nonce: string | null } | null {
  const match = TAG.exec(text);
  return match ? { name: match[1]!, nonce: match[2] ?? null } : null;
}
