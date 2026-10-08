import { describe, expect, it } from "vitest";
import { GREENMAIL_IMAGE, greenmailOpts } from "../fixtures/vault-sites/greenmail.ts";
import { composeConfig } from "./compose-json.ts";

describe("compose.test.yml greenmail", () => {
  it("uses the same image and options as the Testcontainers helper, on the mail network only", () => {
    const greenmail = composeConfig(".env.test", ["compose.yml", "compose.test.yml"]).services
      .greenmail;
    expect(greenmail?.image).toBe(GREENMAIL_IMAGE);
    expect(greenmail?.environment?.GREENMAIL_OPTS).toBe(greenmailOpts());
    expect(Object.keys(greenmail?.networks ?? {})).toEqual(["mail"]);
    expect(greenmail?.ports ?? []).toEqual([]);
  });
});
