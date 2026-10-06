import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export type BadgeTone = "ok" | "warn" | "neutral" | "tint" | "signal" | "danger";

/** Status never relies on colour alone: icon + word are required. */
export function Badge({
  tone,
  icon,
  children,
}: {
  tone: BadgeTone;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={icon} size="sm" />
      {children}
    </span>
  );
}
