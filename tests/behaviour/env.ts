import { inject } from "vitest";
import type { BehaviourEnv } from "./constants.ts";

declare module "vitest" {
  export interface ProvidedContext {
    behaviour: BehaviourEnv;
  }
}

export function behaviourEnv(): BehaviourEnv {
  return inject("behaviour");
}
