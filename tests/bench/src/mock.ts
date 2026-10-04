import { scenarioGoal } from "../../llm-mock/src/select.ts";

/** Harness tests only (D47): tags the goal for the llm-mock; real runs keep the task as written. */
export function withScenario(task: string, scenario: string | null): string {
  return scenario === null ? task : scenarioGoal(scenario, task);
}
