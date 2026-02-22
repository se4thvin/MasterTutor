"use client";

import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx.ts";

export { Popover };

interface PopoverPanelProps {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  label: string;
  className?: string;
}

export function PopoverPanel({
  children,
  side = "bottom",
  align = "start",
  label,
  className,
}: PopoverPanelProps) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
        className="popover-positioner"
      >
        <Popover.Popup className={cx("popover", className)} aria-label={label}>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
