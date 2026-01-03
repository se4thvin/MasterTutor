import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.ts";

function capture() {
  const lines: string[] = [];
  return { lines, destination: { write: (line: string) => void lines.push(line) } };
}

describe("createLogger", () => {
  it("redacts secret-bearing fields at the top level and one level deep", () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: "test", destination });
    log.info(
      {
        password: "p1",
        code: "123456",
        authorization: "Bearer x",
        fill: { password: "p2", sealed: "s", secret: "t", code: "654321" },
        alias: "zybooks",
      },
      "fill",
    );
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.password).toBe("[redacted]");
    expect(entry.code).toBe("[redacted]");
    expect(entry.authorization).toBe("[redacted]");
    expect(entry.fill).toEqual({
      password: "[redacted]",
      sealed: "[redacted]",
      secret: "[redacted]",
      code: "[redacted]",
    });
    expect(entry.alias).toBe("zybooks");
    expect(entry.service).toBe("test");
    for (const secret of ["p1", "p2", "123456", "654321", "Bearer x"]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });
});
