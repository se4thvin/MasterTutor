import type { SuiteDefinition } from "../types.ts";

/** Task 22 fills this with the bench-activities fixture benchmarks. */
export function fixturesSuite(): SuiteDefinition {
  return { id: "fixtures", stack: "test", benchmarks: [] };
}
