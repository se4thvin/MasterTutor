"use client";

import Link from "next/link";
import type { VaultAuditAction, VaultAuditView } from "@mastertutor/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { BadgeTone, IconName } from "@/lib/ui/vocabulary.ts";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { MEDIA } from "@/lib/breakpoints.ts";
import { useMediaQuery } from "@/lib/hooks/use-media-query.ts";
import { formatDateTime, hostOf } from "@/lib/notes/format.ts";
import { FIELD_META } from "@/lib/vault/fields.ts";

/** Every audit action has a word and an icon; a refusal is warn-toned but never colour alone. */
const ACTION_META: Record<VaultAuditAction, { label: string; icon: IconName; tone: BadgeTone }> = {
  create: { label: "Added", icon: "add", tone: "neutral" },
  update: { label: "Changed", icon: "edit", tone: "neutral" },
  delete: { label: "Deleted", icon: "delete", tone: "neutral" },
  fill: { label: "Filled", icon: "password", tone: "ok" },
  passkey: { label: "Passkey used", icon: "passkey", tone: "ok" },
  otp_received: { label: "Code received", icon: "codeOtp", tone: "tint" },
  denied: { label: "Denied", icon: "needsReview", tone: "warn" },
};

const PAGE_SIZE = 50;

/** Audit fields are free text from the server; known vault fields get their display name. */
const fieldLabel = (field: string) =>
  Object.hasOwn(FIELD_META, field) ? FIELD_META[field as keyof typeof FIELD_META].label : field;

const Action = ({ entry }: { entry: VaultAuditView }) => {
  const m = ACTION_META[entry.action];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
};

const When = ({ at }: { at: string }) => <time dateTime={at}>{formatDateTime(at)}</time>;

export function AuditView() {
  const wide = useMediaQuery(MEDIA.md);
  const audit = useInfiniteQuery(
    orpc.vault.audit.infiniteOptions({
      input: (cursor: string | null) => ({ limit: PAGE_SIZE, cursor }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
    }),
  );
  // Rows from pages after the first are marked, so only what "Load more" added eases in.
  const entries =
    audit.data?.pages.flatMap((p, page) =>
      p.items.map((entry, i) => ({ entry, appended: page > 0, i })),
    ) ?? [];
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings", href: "/settings" }, { label: "Audit log" }]} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead
          title="Audit log"
          lede="Every time a sign-in was added, changed, used or refused. It can't be edited."
        />
        {audit.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading audit log">
            <Skeleton className="h-64 rounded-lg" />
          </div>
        ) : audit.isError && !audit.data ? (
          <LoadError
            title="Couldn't load the audit log."
            onRetry={() => void audit.refetch()}
            retrying={audit.isFetching}
          />
        ) : wide ? (
          <div className="group table-scroll">
            <table className="data-table" aria-label="Vault audit">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Sign-in</th>
                  <th scope="col">Field</th>
                  <th scope="col">Run</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(({ entry: e, appended, i }) => (
                  <tr
                    key={e.id}
                    data-qa="audit-entry"
                    data-appended={appended ? "" : undefined}
                    style={appended ? ({ "--i": Math.min(i, 12) } as CSSProperties) : undefined}
                  >
                    <td className="whitespace-nowrap">
                      <When at={e.at} />
                    </td>
                    <td>
                      <Action entry={e} />
                    </td>
                    <td>
                      <span className="mono">{e.alias}</span>
                      {e.origin ? <span className="t-foot"> · {hostOf(e.origin)}</span> : null}
                    </td>
                    <td>{e.field ? fieldLabel(e.field) : "–"}</td>
                    <td>
                      {e.runId ? (
                        <Link className="mono" href={`/runs/${e.runId}`}>
                          Run {e.runId.slice(-6)}
                        </Link>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td>{e.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="group audit-list" aria-label="Vault audit">
            {entries.map(({ entry: e, appended, i }) => (
              <li
                key={e.id}
                data-qa="audit-entry"
                className="audit-item"
                data-appended={appended ? "" : undefined}
                style={appended ? ({ "--i": Math.min(i, 12) } as CSSProperties) : undefined}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Action entry={e} />
                  <span className="mono audit-alias">{e.alias}</span>
                </div>
                <span className="t-foot">
                  <When at={e.at} />
                  {e.field ? ` · ${fieldLabel(e.field)}` : ""} · {e.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
        {audit.hasNextPage ? (
          <div className="flex justify-center py-6">
            <Button onClick={() => void audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
