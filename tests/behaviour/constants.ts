export const SITE = "http://site.fixtures.test";
export const OTHER = "http://other.fixtures.test";
export const BEHAVIOUR_SLOTS = ["browser-1", "browser-2"] as const;
export const SLOT_CDP: Record<string, string> = {
  "browser-1": "http://127.0.0.1:19223",
  "browser-2": "http://127.0.0.1:19224",
};
export const COMPOSE_FILE = "tests/behaviour/compose.yml";

export interface BehaviourEnv {
  ownerUrl: string;
  agentUrl: string;
  webUrl: string;
}

export async function cdpBaseUrlForTests(name: string): Promise<string> {
  const url = SLOT_CDP[name];
  if (!url) throw new Error(`unknown behaviour slot ${name}`);
  return url;
}
