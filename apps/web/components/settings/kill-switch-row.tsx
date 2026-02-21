"use client";

import type { SettingsView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { api, orpc } from "@/lib/api/client.ts";

/** Turning it on stops every run, so it asks first; turning it off does not. Optimistic either way. */
export function KillSwitchRow({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const key = orpc.settings.get.queryKey({ input: {} });
  const setKillSwitch = (killSwitch: boolean) =>
    qc.setQueryData<SettingsView>(key, (old) => old && { ...old, killSwitch });

  const apply = async (on: boolean) => {
    // A refetch in flight would overwrite the optimistic value with the old one.
    await qc.cancelQueries({ queryKey: key });
    setKillSwitch(on);
    try {
      qc.setQueryData(key, await api.settings.setKillSwitch({ on }));
      toast({
        title: on ? "All runs stopped" : "Kill switch off. Runs can start again.",
        icon: on ? "stop" : "ok",
      });
    } catch {
      // Roll back only the switch, so a concurrent defaults save survives.
      setKillSwitch(!on);
      toast({ title: "Couldn't change the kill switch.", icon: "needsReview", tone: "danger" });
    }
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
