import type { PushConfig, WebEnv } from "@mastertutor/contracts";

/** What web-push signs with (RFC 8292): the env's key pair, and our https origin as the contact. */
export interface VapidKeys {
  /** base64url uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** base64url 32-byte private scalar. */
  privateKey: string;
  /** Contact for the push service: our https origin (Apple requires https: or mailto:). */
  subject: string;
}

type PushEnv = Pick<WebEnv, "BETTER_AUTH_URL" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY">;

/** Web Push needs both VAPID keys and HTTPS (spec §13.4); otherwise null and alerts stay in-app. */
export function vapidKeysOf(env: PushEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const origin = new URL(env.BETTER_AUTH_URL);
  if (origin.protocol !== "https:") return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: origin.origin,
  };
}

/** What the browser is told: whether phone alerts can work here, and the key to subscribe with. */
export function pushConfigOf(env: PushEnv): PushConfig {
  const keys = vapidKeysOf(env);
  return { available: keys !== null, publicKey: keys?.publicKey ?? null };
}
