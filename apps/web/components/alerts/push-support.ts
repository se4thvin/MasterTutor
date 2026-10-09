import type { PushConfig } from "@mastertutor/contracts";

export type PushSupport = "insecure" | "ios_install" | "unsupported" | "unavailable" | "ready";

export const PUSH_HINTS: Record<Exclude<PushSupport, "ready"> | "stopped", string> = {
  insecure: "Phone alerts need the deployed HTTPS site. Alerts still appear here in the app.",
  ios_install:
    "On iPhone, add MasterTutor to your Home Screen first (Share → Add to Home Screen), then open it from there to turn on phone alerts.",
  unsupported:
    "This browser can't receive push notifications. Alerts still appear here in the app.",
  unavailable: "Phone alerts aren't set up on this server.",
  stopped: "Phone alerts stopped on this device. Turn them on again to keep getting them.",
};

interface PushSupportInput {
  secureContext: boolean;
  standalone: boolean;
  iOS: boolean;
  hasPush: boolean;
  config: PushConfig | undefined;
}

/** What the Notifications row can offer here (spec §13.4), checked in order. */
export function pushSupport(input: PushSupportInput): PushSupport {
  if (!input.secureContext) return "insecure";
  if (input.iOS && !input.standalone) return "ios_install";
  if (!input.hasPush) return "unsupported";
  if (!input.config?.available) return "unavailable";
  return "ready";
}

/** Reads the browser once, on the client. iPadOS reports itself as a Mac with touch. */
export function browserPushInput(config: PushConfig | undefined): PushSupportInput {
  const iOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    secureContext: window.isSecureContext,
    standalone:
      (navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches,
    iOS,
    hasPush: "serviceWorker" in navigator && "PushManager" in window,
    config,
  };
}

/** The VAPID public key as pushManager.subscribe wants it (base64url, unpadded, to bytes). */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** What the switch shows: the server's word, not just the browser's (review I-3). */
export type PhoneAlertState = "on" | "off" | "stopped";

/**
 * A browser subscription the server no longer holds was removed by its push service (404/410):
 * say so, and drop it so turning alerts on again makes a fresh one. Rotations are re-sent by the
 * service worker and failed saves are undone at once, so neither lands here. If the server can't
 * be asked, nothing is changed.
 */
export async function phoneAlertState(input: {
  subscription: { endpoint: string; unsubscribe(): Promise<boolean> } | null;
  registered(endpoint: string): Promise<boolean>;
}): Promise<PhoneAlertState> {
  const subscription = input.subscription;
  if (!subscription) return "off";
  const registered = await input.registered(subscription.endpoint).catch(() => true);
  if (registered) return "on";
  await subscription.unsubscribe().catch(() => false);
  return "stopped";
}
