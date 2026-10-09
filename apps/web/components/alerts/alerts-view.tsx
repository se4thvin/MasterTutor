"use client";

import { OBSERVABILITY_APP_PATH, type AlertView } from "@mastertutor/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar } from "@/components/ui/toolbar.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { formatDateTime } from "@/lib/notes/format.ts";

const PAGE_SIZE = 50;

/** /settings/alerts (spec §13.3): newest first, each one acknowledgeable, and the way to the dashboards. */
export function AlertsView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const alerts = useInfiniteQuery(
    orpc.alerts.list.infiniteOptions({
      input: (cursor: string | null) => ({ limit: PAGE_SIZE, cursor }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items: AlertView[] = alerts.data?.pages.flatMap((page) => page.items) ?? [];
  const loaded = items.length > 0;

  // A push opens /settings/alerts#alert-<id>. The rows arrive after navigation, so CSS :target
  // never matches them: the hash is read here, and that row is marked current and scrolled to.
  const [targeted, setTargeted] = useState<string | null>(null);
  useEffect(() => {
    const read = () =>
      setTargeted(
        location.hash.startsWith("#alert-") ? location.hash.slice("#alert-".length) : null,
      );
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (loaded && targeted)
      document.getElementById(`alert-${targeted}`)?.scrollIntoView({ block: "center" });
  }, [loaded, targeted]);

  const acknowledge = async (id: string) => {
    setPending(id);
    try {
      await api.alerts.acknowledge({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: orpc.alerts.list.key() }),
        qc.invalidateQueries({ queryKey: orpc.alerts.active.key() }),
      ]);
    } catch {
      toast({ title: "Couldn't acknowledge the alert.", icon: "needsReview", tone: "danger" });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings", href: "/settings" }, { label: "Alerts" }]} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead
          title="Alerts"
          lede="When runs fail, requests are rejected, browser slots crash, spend jumps or errors spike."
        />
        {/* A plain link: /observability hands the owner to OpenObserve on obs.<app host> (D50 I-2). */}
        <nav className="group" aria-label="Dashboards">
          <a className="row row-link" href={OBSERVABILITY_APP_PATH}>
            <span>
              <Icon name="usage" /> Open dashboards
            </span>
            <Icon name="external" />
          </a>
        </nav>
        <h2 className="t-title3 group-title">History</h2>
        {alerts.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading alerts">
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : alerts.isError && !alerts.data ? (
          <LoadError
            title="Couldn't load alerts."
            onRetry={() => void alerts.refetch()}
            retrying={alerts.isFetching}
          />
        ) : !loaded ? (
          <p className="muted">No alerts yet.</p>
        ) : (
          <ul className="group" aria-label="Alerts">
            {items.map((alert) => (
              <li
                key={alert.id}
                id={`alert-${alert.id}`}
                className="row alert-row"
                aria-current={alert.id === targeted ? "true" : undefined}
              >
                <span className="min-w-0">
                  {alert.label}
                  <small>
                    <time dateTime={alert.firedAt}>{formatDateTime(alert.firedAt)}</time>
                  </small>
                </span>
                {alert.acknowledgedAt ? (
                  <span className="muted">Acknowledged</span>
                ) : (
                  <Button
                    disabled={pending === alert.id}
                    onClick={() => void acknowledge(alert.id)}
                  >
                    Acknowledge
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {alerts.hasNextPage ? (
          <div className="flex justify-center py-6">
            <Button
              onClick={() => void alerts.fetchNextPage()}
              disabled={alerts.isFetchingNextPage}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
