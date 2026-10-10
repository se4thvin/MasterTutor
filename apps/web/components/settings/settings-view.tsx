"use client";

import { MODELS } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { NotificationsGroup } from "@/components/alerts/notifications-group.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar } from "@/components/ui/toolbar.tsx";
import { orpc } from "@/lib/api/client.ts";
import { useSignOut } from "@/components/shell/use-sign-out.ts";
import { Suspense } from "react";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { DefaultsForm } from "./defaults-form.tsx";
import { KillSwitchRow } from "./kill-switch-row.tsx";

const { Component: CapturePreferences } = lazyComponent(() =>
  import("./capture-preferences.tsx").then((mod) => mod.CapturePreferences),
);
const ignoreFailure = () => undefined;

export function SettingsView() {
  const signOut = useSignOut();
  const settings = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  const { data } = settings;
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Settings" }]} />
      </Toolbar>
      <div className="wrap slist">
        <PageHead
          title="Settings"
          lede="Safety, defaults for new tasks, and what the agent has used."
        />
        {settings.isError && !data ? (
          <LoadError
            title="Couldn't load settings."
            onRetry={() => void settings.refetch()}
            retrying={settings.isFetching}
          />
        ) : !data ? (
          <div role="status" aria-busy="true" aria-label="Loading settings">
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : (
          <>
            <h2 className="t-title3 group-title">Safety</h2>
            <div className="group">
              <KillSwitchRow settings={data} />
            </div>

            <NotificationsGroup />

            <h2 className="t-title3 group-title">Defaults for new tasks</h2>
            <div className="group group-pad">
              {/* Keyed on the saved defaults only: a kill-switch change must not discard a draft. */}
              <DefaultsForm
                key={JSON.stringify([data.defaultBudget, data.defaultAllowedOrigins])}
                settings={data}
              />
            </div>

            <ChunkBoundary what="capture preferences" onFailed={ignoreFailure}>
              <Suspense fallback={null}>
                <CapturePreferences />
              </Suspense>
            </ChunkBoundary>

            <h2 className="t-title3 group-title">Agent</h2>
            <div className="group">
              <div className="row">
                <span className="min-w-0">
                  Model<small>Planning and page understanding</small>
                </span>
                <span className="tabular muted settings-value">
                  {MODELS.agentPrimary} → {MODELS.agentFallback}
                </span>
              </div>
              <div className="row">
                <span className="min-w-0">
                  Concurrency<small>Equal to the browser slots in the deployment</small>
                </span>
                <span className="muted settings-value">{data.concurrency} browsers at once</span>
              </div>
            </div>

            <h2 className="t-title3 group-title">Activity</h2>
            <nav className="group" aria-label="Activity">
              <Link className="row row-link" href="/settings/usage">
                <span>
                  <Icon name="usage" /> Usage
                </span>
                <Icon name="chevronRight" />
              </Link>
              <Link className="row row-link" href="/settings/audit">
                <span>
                  <Icon name="audit" /> Audit log
                </span>
                <Icon name="chevronRight" />
              </Link>
              <Link className="row row-link" href="/settings/alerts">
                <span>
                  <Icon name="needsReview" /> Alerts
                </span>
                <Icon name="chevronRight" />
              </Link>
            </nav>

            <h2 className="t-title3 group-title">Account</h2>
            <div className="group">
              <div className="row">
                <span>Signed in</span>
                <Button icon="signOut" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
