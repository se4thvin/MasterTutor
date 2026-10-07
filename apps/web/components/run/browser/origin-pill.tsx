import { useId } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { hostAndPath, type Tone } from "../model/copy.ts";

/** The host is shown whole; only the path is truncated (S7). Both are page-derived text (S6). */
export function OriginPill({ url, secure }: { url: string | null; secure: boolean }) {
  const tipId = useId();
  const parts = hostAndPath(url);
  if (!parts) {
    return (
      <div className="run-origin">
        <span className="run-host">New tab</span>
      </div>
    );
  }
  return (
    <div className="run-origin" data-testid="origin-pill">
      <Icon
        name={parts.secure ? "sealed" : "web"}
        size="sm"
        label={parts.secure ? "Secure connection" : "Not secure"}
      />
      <bdi className="run-host">{parts.host}</bdi>
      {parts.path ? <bdi className="run-path">{parts.path}</bdi> : null}
      {secure ? (
        <button
          type="button"
          className="run-keyshield"
          aria-label="Filled securely"
          aria-describedby={tipId}
        >
          <Icon name="filledSecurely" size="sm" />
          <span role="tooltip" id={tipId} className="run-tip">
            <b>Filled securely.</b> A vault alias filled this sign-in. The values never reached the
            agent, and screenshots were masked during the fill.
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function StatePill({ label, tone, pulse }: { label: string; tone: Tone; pulse: boolean }) {
  return (
    <span className="run-pill" data-tone={tone} data-pulse={pulse || undefined}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
