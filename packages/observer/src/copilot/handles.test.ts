import { describe, expect, it } from "vitest";
import { HandleMap } from "./handles.ts";

const A = "6f2c8a3e-0000-4000-8000-00000000000a";
const B = "6f2c8a3e-0000-4000-8000-00000000000b";

describe("HandleMap (spec §7.5)", () => {
  it("gives each run a stable short handle and maps back", () => {
    const map = new HandleMap();
    expect(map.handleOf(A)).toBe("R1");
    expect(map.handleOf(B)).toBe("R2");
    expect(map.handleOf(A)).toBe("R1");
    expect(map.runIdOf("R2")).toBe(B);
    expect(map.runIdOf("R9")).toBeNull();
    expect(new HandleMap(map.toJSON()).handleOf(B)).toBe("R2");
  });
  it("replaces every UUID in text so none reaches the model", () => {
    const map = new HandleMap();
    expect(map.replaceUuids(`run ${A.toUpperCase()} then ${B}`)).toBe("run R1 then R2");
  });
});

it("validates restored entries and allocates past gaps without overwriting a handle", () => {
  const map = new HandleMap({ R2: A.toUpperCase() });
  expect(map.handleOf(A)).toBe("R2");
  expect(map.handleOf(B)).toBe("R3");
  expect(map.runIdOf("R2")).toBe(A);
  expect(() => new HandleMap({ R1: "not-a-uuid" })).toThrow();
});
