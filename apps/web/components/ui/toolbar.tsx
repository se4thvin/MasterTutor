import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";

/** Sticky glass header for each screen; content scrolls beneath it. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <header className="toolbar glass">{children}</header>;
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
