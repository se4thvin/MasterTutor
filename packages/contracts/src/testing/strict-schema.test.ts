import { describe, expect, it } from "vitest";
import { z } from "zod";
import { strictSchemaProblems } from "./strict-schema.ts";

describe("strictSchemaProblems", () => {
  it("returns no problems for a fully required schema", () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().nullable(),
      c: z.object({ d: z.number() }),
      e: z.array(z.object({ f: z.boolean() })),
    });
    expect(strictSchemaProblems(schema)).toEqual([]);
  });

  it("flags an optional field", () => {
    const problems = strictSchemaProblems(z.object({ a: z.string(), b: z.string().optional() }));
    expect(problems).toEqual(["$.b is optional"]);
  });

  it("flags a nested optional field", () => {
    const problems = strictSchemaProblems(z.object({ a: z.object({ b: z.string().optional() }) }));
    expect(problems).toEqual(["$.a.b is optional"]);
  });

  it("flags a non-object root", () => {
    expect(strictSchemaProblems(z.string())).toContain("$ root is not an object");
  });
});
