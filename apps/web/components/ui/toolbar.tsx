import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { LiquidGlass } from "./liquid-glass.tsx";

/** Sticky glass header for each screen; content scrolls beneath it. */
export function Toolbar({ children }: { children: ReactNode }) {
  // Its hairline fades in on scroll (a scroll-linked animation), so it keeps its own delay.
  return (
    <LiquidGlass as="header" className="toolbar" data-motion-keep-delay="">
      {children}
    </LiquidGlass>
  );
}

export function Crumbs({ items }: { items: ReadonlyArray<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className={last ? "crumb-current" : "crumb"}>
              {item.href && !last ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
              {last ? null : <Icon name="chevronRight" size="sm" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ToolbarSpacer() {
  return <span className="toolbar-spacer" />;
}
