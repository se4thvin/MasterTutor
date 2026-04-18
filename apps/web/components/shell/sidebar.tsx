"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import type { Viewer } from "@/lib/server/viewer.ts";
import { NAV_ITEMS, isNavActive } from "./nav-items.ts";
import { RecentNotes } from "./recent-notes.tsx";
import { useRunPulse } from "./use-run-pulse.ts";
import { UserMenu } from "./user-menu.tsx";

const PULSE_TEXT = {
  done: "Run finished",
  failed: "Run failed",
  cancelled: "Run stopped",
} as const;

export function Sidebar({
  viewer,
  onSignOut,
  libraryTree,
}: {
  viewer: Viewer;
  onSignOut: () => Promise<void>;
  libraryTree?: ReactNode;
}) {
  const pathname = usePathname();
  const pulse = useRunPulse();
  return (
    <aside className="sidebar glass" aria-label="Sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="agentNote" size="sm" />
        </span>
        <span className="brand-text">
          <b>MasterTutor</b>
          <small>Faithful notes, by agent</small>
        </span>
      </div>
      <nav className="nav" aria-label="Primary">
        <ul>
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="nav-item"
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {item.href === "/runs" && pulse ? (
                    <span className="nav-meta">
                      <StatusMark status={pulse.status} decorative />
                      <span className="nav-meta-text">
                        {pulse.status === "running"
                          ? `${pulse.count} live`
                          : PULSE_TEXT[pulse.status]}
                      </span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {libraryTree ? (
        <div className="sidebar-section">
          <h2 className="eyebrow sidebar-heading">Folders</h2>
          {libraryTree}
        </div>
      ) : null}
      <RecentNotes />
      <div className="sidebar-foot">
        <UserMenu viewer={viewer} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
