"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import {
  PUSH_HINTS,
  base64UrlToBytes,
  browserPushInput,
  pushSupport,
  type PushSupport,
} from "./push-support.ts";

const SW = { url: "/sw.js", scope: "/" } as const;

/** Subscribes this browser and tells the server, or the reverse. */
async function setPhoneAlerts(on: boolean, publicKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.register(SW.url, { scope: SW.scope });
  if (!on) {
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await api.alerts.unsubscribe({ endpoint: subscription.endpoint });
    await subscription.unsubscribe();
    return;
  }
  if ((await Notification.requestPermission()) !== "granted") throw new Error("permission");
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
  const json = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await api.alerts.subscribe({ endpoint: json.endpoint, keys: json.keys });
}

/**
 * Settings → Notifications (spec §13.4). Owner only: for anyone else pushConfig is FORBIDDEN and
 * nothing renders. Where push can't work here, the row says why instead of offering a switch.
 */
export function NotificationsGroup() {
  const toast = useToast();
  const { data: config } = useQuery({
    ...orpc.alerts.pushConfig.queryOptions({ input: {} }),
    retry: false,
  });
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    const state = pushSupport(browserPushInput(config));
    setSupport(state);
    if (state !== "ready") return;
    void navigator.serviceWorker
      .getRegistration(SW.scope)
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setOn(Boolean(subscription)))
      .catch(() => undefined);
  }, [config]);

  if (!config || !support) return null;

  const toggle = async (next: boolean) => {
    if (busy || !config.publicKey) return;
    setBusy(true);
    try {
      await setPhoneAlerts(next, config.publicKey);
      setOn(next);
      toast({ title: next ? "Phone alerts on" : "Phone alerts off", icon: "ok" });
    } catch {
      toast({
        title:
          Notification.permission === "denied"
            ? "Notifications are blocked for this site. Allow them in Settings, then try again."
            : "Couldn't change phone alerts.",
        icon: "needsReview",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="t-title3 group-title">Notifications</h2>
      <div className="group">
        <div className="row">
          <span className="min-w-0">
            Phone alerts
            <small>
              {support === "ready"
                ? "Failed runs, rejected requests, crashing browser slots, spend jumps and error spikes."
                : PUSH_HINTS[support]}
            </small>
          </span>
          {support === "ready" ? (
            <Switch
              label="Phone alerts"
              checked={on}
              busy={busy}
              onCheckedChange={(next) => void toggle(next)}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
