/**
 * The Observer's roles (D52). Track D adds the document designer (D53b). Each is also a reserved
 * name that can never be a person's decider (RESERVED_DECIDERS in ./approval.ts). Its own module, so
 * approval.ts (in client bundles) need not import the telemetry registry for it.
 */
export const OBSERVER_ROLES = ["guard", "watcher", "copilot"] as const;
export type ObserverRole = (typeof OBSERVER_ROLES)[number];
