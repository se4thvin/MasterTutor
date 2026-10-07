export const SITE = "http://site.fixtures.test";
export const OTHER = "http://other.fixtures.test";
/** The vault-fixture site (tests/fixtures/vault-sites; the `vault-fixtures` service in compose.test.yml). */
export const LOGIN = "http://login.fixtures.test";
export const BEHAVIOUR_SLOTS = ["browser-1", "browser-2"] as const;
export const SLOT_CDP: Record<string, string> = {
  "browser-1": "http://127.0.0.1:19223",
  "browser-2": "http://127.0.0.1:19224",
};
export const COMPOSE_FILE = "tests/behaviour/compose.yml";
/**
 * The files `up` and `down` use. On the shared CI host (scripts/remote-test.sh sets
 * BEHAVIOUR_REMOTE_HOST=1) the slots also take compose.remote.yml's AppArmor profile.
 */
export const COMPOSE_UP_FILES =
  process.env.BEHAVIOUR_REMOTE_HOST === "1"
    ? [COMPOSE_FILE, "tests/behaviour/compose.remote.yml"]
    : [COMPOSE_FILE];

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

/** n.eko and the X idle probe of each behaviour slot, published on loopback (compose.yml). */
export const SLOT_NEKO: Record<string, string> = {
  "browser-1": "http://127.0.0.1:18091",
  "browser-2": "http://127.0.0.1:18092",
};
export const SLOT_IDLE: Record<string, string> = {
  "browser-1": "http://127.0.0.1:18191/",
  "browser-2": "http://127.0.0.1:18192/",
};
/** The test-only n.eko secrets in compose.yml's x-slot-env (dummy values, never production). */
export const BEHAVIOUR_NEKO_ADMIN_SECRET = "behaviour-admin-secret-0123456789abcdef";
export const BEHAVIOUR_NEKO_MEMBER_SECRET = "behaviour-member-secret-0123456789abcde";

export function nekoBaseUrlForTests(name: string): string {
  const url = SLOT_NEKO[name];
  if (!url) throw new Error(`unknown behaviour slot ${name}`);
  return url;
}

export function idleUrlForTests(name: string): string {
  const url = SLOT_IDLE[name];
  if (!url) throw new Error(`unknown behaviour slot ${name}`);
  return url;
}

/** The host folder the behaviour stack mounts as the slots' `/downloads` volume (the agent's view of it). */
export const BEHAVIOUR_DOWNLOADS =
  process.env.BEHAVIOUR_DOWNLOADS ?? "/tmp/mastertutor-behaviour-downloads";
