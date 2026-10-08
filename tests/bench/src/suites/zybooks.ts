import type { SuiteDefinition } from "../types.ts";

/** Task 23 fills this (bypass mode, the vault requirement, signed_in and the readings), on the prod stack (D46, D47). */
export function zybooksSuite(): SuiteDefinition {
  return { id: "zybooks", stack: "local", benchmarks: [] };
}
