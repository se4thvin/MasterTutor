"use client";

import type { SettingsView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api } from "@/lib/api/client.ts";
import { saveSettingsFields } from "@/lib/settings/cache.ts";

/** Turning it on stops every run, so it asks first; turning it off does not. Optimistic either way. */
export function KillSwitchRow({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  // One change at a time: out-of-order responses would otherwise settle on the wrong state.
  const [pending, setPending] = useState(false);
  const apply = async (on: boolean) => {
    if (pending) return;
    setPending(true);
    // Owns only killSwitch; refetches on settle, so a lost response cannot leave the UI wrong.
    const ok = await saveSettingsFields(
      qc,
      ["killSwitch"],
      () => api.settings.setKillSwitch({ on }),
      {
        killSwitch: on,
      },
    );
    setPending(false);
    toast(
      ok
        ? {
            title: on ? "All runs stopped" : "Kill switch off. Runs can start again.",
            icon: on ? "stop" : "ok",
          }
        : { title: "Couldn't change the kill switch.", icon: "needsReview", tone: "danger" },
    );
  };

  return (
    <div className="row">
      <span className="min-w-0">
        Kill switch
        <small>Stops every run within a second and blocks new ones until you turn it off.</small>
      </span>
      <Switch
        label="Kill switch"
        tone="danger"
        checked={settings.killSwitch}
        disabled={pending}
        onCheckedChange={(on) => (on ? setConfirm(true) : void apply(false))}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Stop all runs?"
        description="Every run is cancelled within a second and no new run starts until you turn this off."
        cancelLabel="Keep Running"
        confirmLabel="Stop All Runs"
        destructive
        onConfirm={() => void apply(true)}
      />
    </div>
  );
}
