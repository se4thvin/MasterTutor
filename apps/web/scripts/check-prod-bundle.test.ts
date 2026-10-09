import { readFileSync } from "node:fs";
import { AgentEnv, WebEnv } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./check-prod-bundle.ts", import.meta.url), "utf8");
const listed = [
  ...(/SERVER_ENV_NAMES = \[([^\]]*)\]/.exec(source)?.[1] ?? "").matchAll(/"([A-Z0-9_]+)"/g),
].map((match) => match[1]!);
const envNames = new Set([...Object.keys(WebEnv.shape), ...Object.keys(AgentEnv.shape)]);

describe("check-prod-bundle server env names", () => {
  it("names only variables our env schemas still define (D36 renamed the OpenAI key)", () => {
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((name) => !envNames.has(name))).toEqual([]);
  });
  it("guards the OpenAI key and both vault keys", () => {
    expect(listed).toEqual(
      expect.arrayContaining(["OPENAI_API_KEY", "VAULT_PRIVATE_KEY", "VAULT_PUBLIC_KEY"]),
    );
  });
  it("guards the push signing key and the observability secrets (D50)", () => {
    expect(listed).toEqual(
      expect.arrayContaining([
        "VAPID_PRIVATE_KEY",
        "ALERT_WEBHOOK_SECRET",
        "OBSERVE_VIEWER_PASSWORD",
      ]),
    );
  });
});
