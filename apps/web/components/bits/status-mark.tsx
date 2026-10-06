/*
 * Adapted from React Bits "StatusMark" (TS-TW).
 * Source:  https://reactbits.dev/r/StatusMark-TS-TW.json
 * sha256:  d0a5e2e19c4134098b56f0ab876fb649187c250e14230811c53eca77fe2d403e (fetched 2026-10-06)
 * Licence: Copyright (c) 2026 David Haz, MIT + Commons Clause; see ./LICENSE-react-bits
 *          (https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md).
 *          Not for redistribution as a component kit.
 * Adaptations: CSS-only (no motion runtime). The ring that rewrote stroke-dasharray and
 * stroke-dashoffset every frame is gone: "running" is mockup D's pulsing signal dot (D25 keeps the
 * sidebar's live dot) and "pending" a static dashed ring; the check and cross scale and fade in
 * instead of drawing their stroke; the status changes cross-fade; colours from tokens; the
 * progress, label, strike, size and timing props are removed; a `decorative` mode for marks that
 * sit beside text; reduced motion keeps only the fades (motion.css).
 */
export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";

const SPOKEN: Record<StatusMarkStatus, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";
const CROSS = "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5";

export function StatusMark({
  status,
  label,
  decorative = false,
}: {
  status: StatusMarkStatus;
  label?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className="smark"
      data-status={status}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? SPOKEN[status])}
      aria-hidden={decorative ? true : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className="smark-ring" cx="12" cy="12" r="9" />
        <circle className="smark-disc" cx="12" cy="12" r="9" />
        <circle className="smark-dot" cx="12" cy="12" r="4.5" />
        <path className="smark-check" d={CHECK} />
        <path className="smark-cross" d={CROSS} />
      </svg>
    </span>
  );
}
