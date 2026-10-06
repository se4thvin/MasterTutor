import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GREENMAIL_IMAGE, greenmailOpts } from "../fixtures/vault-sites/greenmail.ts";

const run = promisify(execFile);

describe("compose.test.yml greenmail", () => {
  it("uses the same image and options as the Testcontainers helper, on the backend network only", async () => {
    const { stdout } = await run("docker", [
      "compose",
      "--env-file",
      ".env.test",
      "-f",
      "compose.yml",
      "-f",
      "compose.test.yml",
      "config",
      "--format",
      "json",
    ]);
    const config = JSON.parse(stdout) as {
      services: Record<
        string,
        {
          image?: string;
          environment?: Record<string, string>;
          networks?: Record<string, unknown>;
          ports?: unknown[];
        }
      >;
    };
    const greenmail = config.services.greenmail;
    expect(greenmail?.image).toBe(GREENMAIL_IMAGE);
    expect(greenmail?.environment?.GREENMAIL_OPTS).toBe(greenmailOpts());
    expect(Object.keys(greenmail?.networks ?? {})).toEqual(["backend"]);
    expect(greenmail?.ports ?? []).toEqual([]);
  });
});
