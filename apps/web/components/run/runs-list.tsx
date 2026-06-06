"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { Button, ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { orpc } from "@/lib/api/client.ts";
import { formatDateTime } from "@/lib/notes/format.ts";
import { markStatus } from "@/lib/status.ts";
import { untrustedText } from "./model/untrusted-text.ts";

const TEXT: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Needs you",
  sleeping: "Paused",
  completed: "Finished",
  failed: "Stopped",
  cancelled: "Cancelled",
};

const PAGE = 50;

/** Every run, newest first, each a link to its run view (X2). */
export function RunsList() {
  // Paged, newest first: "Load more" reaches every run (M11).
  const runs = useInfiniteQuery(
    orpc.runs.list.infiniteOptions({
      input: (cursor: string | null) => ({ status: null, limit: PAGE, cursor }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  if (runs.isError) {
    return (
      <LoadError
        title="Couldn't load your runs."
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
      />
    );
  }
  if (!runs.data) {
    return (
      <div className="group" aria-busy="true">
        <Skeleton className="run-list-skel" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon="runs"
        title="No runs yet"
        body="Start a task and the agent's runs show up here."
        actions={
          <ButtonLink href="/new" variant="primary" icon="newTask">
            New task
          </ButtonLink>
        }
      />
    );
  }
  return (
    <>
      <nav className="group" aria-label="Runs">
        {items.map((run) => (
          <Link key={run.id} className="row row-link" href={`/runs/${run.id}`}>
            <span className="run-list-main">
              <StatusMark status={markStatus(run.status)} decorative />
              <span className="min-w-0 run-list-text">
                <bdi className="run-list-goal">{untrustedText(run.goal.split("\n")[0], 4000)}</bdi>
                <small>
                  {TEXT[run.status]} · {formatDateTime(run.createdAt)}
                </small>
              </span>
            </span>
            <Icon name="chevronRight" />
          </Link>
        ))}
      </nav>
      {runs.hasNextPage ? (
        <div className="run-list-more">
          <Button onClick={() => void runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}
