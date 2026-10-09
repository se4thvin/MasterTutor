"use client";

import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx.ts";
import { Icon, type IconName } from "./icon.tsx";
import { LIQUID_GLASS } from "./liquid-glass.tsx";

export { Menu };

export function MenuPanel({
  children,
  align = "end",
  side,
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className="popover-positioner"
      >
        <Menu.Popup className={cx("menu", LIQUID_GLASS, className)}>{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

/** Destructive items are red and go last (HIG). */
export function MenuItem({
  icon,
  onSelect,
  destructive = false,
  children,
}: {
  icon?: IconName;
  onSelect: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Menu.Item className={cx("menu-item", destructive && "menu-item-danger")} onClick={onSelect}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span>{children}</span>
    </Menu.Item>
  );
}
