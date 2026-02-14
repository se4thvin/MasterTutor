"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";
import type { Viewer } from "@/lib/server/viewer.ts";
import { NAV_ITEMS, isNavActive } from "./nav-items.ts";
import { RecentNotes } from "./recent-notes.tsx";
import { UserMenu } from "./user-menu.tsx";

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
  const live = useQuery(orpc.runs.list.queryOptions({ input: { status: "running", limit: 20 } }));
  const liveCount = live.data?.items.length ?? 0;
  return (
    <aside className="sidebar" aria-label="Sidebar">
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
                  <span className="nav-label" data-qa-allow-clip>
                    {item.label}
                  </span>
                  {item.href === "/runs" && liveCount > 0 ? (
                    <span className="nav-meta">
                      <span className="live-dot" aria-hidden="true" />
                      <span className="nav-meta-text">{liveCount} live</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {libraryTree ? <div className="sidebar-section">{libraryTree}</div> : null}
      <RecentNotes />
      <div className="sidebar-foot">
        <UserMenu viewer={viewer} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
