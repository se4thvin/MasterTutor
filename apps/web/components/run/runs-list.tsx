"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { orpc } from "@/lib/api/client.ts";
import { formatDateTime } from "@/lib/notes/format.ts";
import { markStatus } from "@/lib/status.ts";

const TEXT: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Needs you",
  sleeping: "Paused",
  completed: "Finished",
  failed: "Stopped",
  cancelled: "Cancelled",
};

/** Every run, newest first, each a link to its run view (X2). */
export function RunsList() {
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { status: null, limit: 50 } }));
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
  if (runs.data.items.length === 0) {
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
    <nav className="group" aria-label="Runs">
      {runs.data.items.map((run) => (
        <Link key={run.id} className="row row-link" href={`/runs/${run.id}`}>
          <span className="run-list-main">
            <StatusMark status={markStatus(run.status)} decorative />
            <span className="min-w-0 run-list-text">
              <bdi className="run-list-goal">{run.goal.split("\n")[0]}</bdi>
              <small>
                {TEXT[run.status]} · {formatDateTime(run.createdAt)}
              </small>
            </span>
          </span>
          <Icon name="chevronRight" />
        </Link>
      ))}
    </nav>
  );
}
