import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment files", () => {
  it.each(["compose.yml", "compose.test.yml", ".env.example"])(
    "%s never enables the fixture API",
    (file) => {
      expect(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).not.toContain(
        "WEB_FIXTURE_API",
      );
    },
  );
});
