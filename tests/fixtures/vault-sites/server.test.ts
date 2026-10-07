import { describe, expect, it } from "vitest";
import { fixtureOrigin } from "./server.ts";

describe("fixtureOrigin", () => {
  it("writes origins the way browsers do: the default HTTP port is never spelled out", () => {
    expect(fixtureOrigin("login.fixtures.test", 80)).toBe("http://login.fixtures.test");
    expect(fixtureOrigin("login.fixtures.test", 41234)).toBe("http://login.fixtures.test:41234");
  });
});
