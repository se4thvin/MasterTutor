import { cx } from "@/lib/cx.ts";
import type { IconName } from "@/lib/ui/vocabulary.ts";
import { icons } from "./icons.ts";

export type { IconName } from "@/lib/ui/vocabulary.ts";
export type IconSize = "sm" | "md" | "lg" | "xl";

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** When set, the icon is meaningful on its own; otherwise it is decorative. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = "md", label, className }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      className={cx("ic", `ic-${size}`, className)}
      strokeWidth={1.6}
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
