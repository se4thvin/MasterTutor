"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Icon } from "@/components/ui/icon.tsx";
import { orpc } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";

/**
 * Unacknowledged alerts, for the owner only (spec §13.3): anyone else gets FORBIDDEN, sees nothing
 * and is not asked again. Fetched on mount and on focus, never polled; Web Push is the real-time path.
 */
export function AlertBanner() {
  const { data } = useQuery({
    ...orpc.alerts.active.queryOptions({ input: {} }),
    retry: false,
    refetchOnWindowFocus: (query) => errorCode(query.state.error) !== "FORBIDDEN",
  });
  const first = data?.items[0];
  if (!first) return null;
  const more = data.items.length - 1;
  return (
    <div className="alert-banner" role="status">
      <Icon name="needsReview" />
      <span>
        <b>{first.label}.</b>
        {more > 0 ? ` And ${more} more.` : ""}
      </span>
      <Link href={`/settings/alerts#alert-${first.id}`}>Alerts</Link>
    </div>
  );
}
