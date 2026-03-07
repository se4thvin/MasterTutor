"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cx } from "@/lib/cx.ts";

export function Switch({
  checked,
  onCheckedChange,
  label,
  tone = "default",
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      className={cx("switch", tone === "danger" && "switch-danger")}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
