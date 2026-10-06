"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import { reconnectDelayMs } from "../stream/run-events.ts";
import { liveFailure } from "./live-policy.ts";

export type LiveStatus = "off" | "connecting" | "live" | "retrying" | "in_use" | "unavailable";

interface LiveFrameProps {
  runId: string;
  slotName: string | null;
  /** Bumped by the view after a Reconnecting episode: open the live view again (B6 §8). */
  epoch: number;
  title: string;
  interactive: boolean;
  onStatus(status: LiveStatus): void;
}

/**
 * n.eko's client in an iframe (spec §10.2). runs.openLive sets the HttpOnly cookies for
 * /live/<runId>/ and is called again on every slot change. One frame per run per tab: the PiP
 * never mounts on the run's own page (L1).
 * Isolation (S5): while not in control the frame is inert (no focus, no input; the video still
 * plays). `sandbox` is left out on purpose: it cannot isolate a same-origin scripted client.
 */
export function LiveFrame({
  runId,
  slotName,
  epoch,
  title,
  interactive,
  onStatus,
}: LiveFrameProps) {
  const [embed, setEmbed] = useState<string | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const report = useEffectEvent(onStatus);

  useEffect(() => {
    if (slotName === null) {
      setEmbed(null);
      report("off");
      return undefined;
    }
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = async () => {
      report(attempt === 0 ? "connecting" : "retrying");
      try {
        const result = await api.runs.openLive({ runId });
        if (cancelled) return;
        setEmbed(result.sleeping ? null : result.embedPath);
        report(result.sleeping ? "off" : "live");
      } catch (error) {
        if (cancelled) return;
        const next = liveFailure(errorCode(error));
        if (next === "retry") {
          report("retrying");
          timer = setTimeout(() => void open(), reconnectDelayMs(attempt++));
          return;
        }
        setEmbed(null);
        report(next);
      }
    };
    void open();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, slotName, epoch]);

  useEffect(() => {
    if (interactive) ref.current?.focus();
  }, [interactive, embed]);

  if (!embed) return null;
  return (
    <div className="run-live" inert={!interactive}>
      <iframe
        ref={ref}
        src={embed}
        title={title}
        allow="autoplay; clipboard-read; clipboard-write"
        referrerPolicy="same-origin"
        tabIndex={interactive ? 0 : -1}
      />
    </div>
  );
}
