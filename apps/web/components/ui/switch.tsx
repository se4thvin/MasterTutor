"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cx } from "@/lib/cx.ts";

/**
 * `busy` is for a change in flight: the switch keeps its focus and tab stop (Base UI's `disabled`
 * would drop it from the tab order), says it is unavailable and busy, and ignores input (readOnly).
 * `disabled` stays for switches that cannot be used at all.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  tone = "default",
  disabled,
  busy = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <BaseSwitch.Root
      className={cx("switch", tone === "danger" && "switch-danger")}
      checked={checked}
      disabled={disabled}
      readOnly={busy}
      aria-disabled={busy || disabled || undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
