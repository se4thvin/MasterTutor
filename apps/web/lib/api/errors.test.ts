import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { errorCopy } from "./errors.ts";

describe("errorCopy", () => {
  it("maps codes to fixed copy and never echoes the server message", () => {
    const err = new ORPCError("CONFLICT", { message: "alias hunter2 is taken" });
    expect(errorCopy(err)).toBe("That name is already taken.");
    expect(errorCopy(err)).not.toContain("hunter2");
  });
  it("falls back for unknown errors", () => {
    expect(errorCopy(new Error("boom secret"), "Couldn't save.")).toBe("Couldn't save.");
  });
});
