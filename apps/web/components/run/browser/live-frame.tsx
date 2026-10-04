"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import { reconnectDelayMs } from "../stream/run-events.ts";
import { liveFailure } from "./live-policy.ts";
import { watchVideo } from "./live-video.ts";

export type LiveStatus =
  | "off"
  | "connecting"
  | "live"
  | "retrying"
  | "in_use"
  | "unavailable"
  /** The embed's session decoded no video in time (I1): the frame offers Retry. */
  | "no_video";

interface LiveFrameProps {
  runId: string;
  slotName: string | null;
  /** Bumped by the view after a Reconnecting episode: open the live view again (B6 §8). */
  epoch: number;
  title: string;
  interactive: boolean;
  onStatus(status: LiveStatus): void;
}

/** A Retry may find the closed session still connected in n.eko for a moment (CONFLICT). */
const RETRY_CONFLICT_RETRIES = 3;

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
  // Bumped by Retry: a fresh n.eko session (openLive logs in again; a session ends with its
  // websocket). Never automatic: fresh sessions do not recover a stuck slot (I1).
  const [retry, setRetry] = useState(0);
  // I1: the session decoded no video in time. The notice stays until a frame arrives.
  const [noVideo, setNoVideo] = useState(false);
  // Every load of the embed is a new session, including one the embed starts itself (n.eko's
  // client reconnecting): each is watched for video.
  const [loads, setLoads] = useState(0);
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
        const closing = next === "in_use" && retry > 0 && attempt < RETRY_CONFLICT_RETRIES;
        if (next === "retry" || closing) {
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
  }, [runId, slotName, epoch, retry]);

  // Each session gets NO_VIDEO_MS to decode a frame; after that the notice shows until one does.
  useEffect(() => {
    if (!embed) return undefined;
    setNoVideo(false);
    let stopLate: (() => void) | undefined;
    const stop = watchVideo(
      () => ref.current,
      (result) => {
        if (result === "video") return;
        setNoVideo(true);
        report("no_video");
        stopLate = watchVideo(
          () => ref.current,
          () => {
            setNoVideo(false);
            report("live");
          },
          Infinity,
        );
      },
    );
    return () => {
      stop();
      stopLate?.();
    };
  }, [embed, loads]);

  useEffect(() => {
    if (interactive) ref.current?.focus();
  }, [interactive, embed]);

  if (!embed) return null;
  return (
    <>
      <div className="run-live" inert={!interactive}>
        <iframe
          ref={ref}
          onLoad={() => setLoads((n) => n + 1)}
          src={embed}
          title={title}
          allow="autoplay; clipboard-read; clipboard-write"
          referrerPolicy="same-origin"
          tabIndex={interactive ? 0 : -1}
        />
      </div>
      {noVideo && (
        <div className="run-reconnect glass" role="status">
          <span>
            <b>Live view unavailable</b> · Showing the last screenshot
          </span>
          <button
            type="button"
            className="btn btn-gray run-banner-btn"
            onClick={() => {
              setEmbed(null);
              setRetry((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}
