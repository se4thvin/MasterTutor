"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { MarqueeText } from "@/components/ui/marquee-text.tsx";
import { orpc } from "@/lib/api/client.ts";
import { noteKindIcon } from "@/lib/notes/format.ts";

export function RecentNotes() {
  const { data } = useQuery(orpc.notes.list.queryOptions({ input: { limit: 5 } }));
  if (!data?.items.length) return null;
  return (
    <div className="sidebar-section">
      <h2 className="eyebrow sidebar-heading">Recent notes</h2>
      <ul className="recent">
        {data.items.map((note) => (
          <li key={note.id}>
            <Link
              href={`/notes/${note.id}`}
              className="recent-item"
              aria-label={note.title}
              data-marquee-host=""
            >
              <Icon name={noteKindIcon(note)} />
              <MarqueeText text={note.title} className="recent-title" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
