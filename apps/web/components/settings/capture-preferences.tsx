"use client";

import { useQuery } from "@tanstack/react-query";
import { BriefEditor } from "@/components/capture/brief-editor.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { api, orpc } from "@/lib/api/client.ts";

export function CapturePreferences() {
  const preferences = useQuery(orpc.settings.capturePreferences.queryOptions({ input: {} }));
  const toast = useToast();
  if (preferences.isError && !preferences.data)
    return (
      <LoadError
        title="Couldn't load capture preferences."
        onRetry={() => void preferences.refetch()}
        retrying={preferences.isFetching}
      />
    );
  if (!preferences.data?.items.length) return null;
  return (
    <>
      <h2 className="t-title3 group-title">Capture preferences</h2>
      <p className="muted">Saved scope for each site. An explicit task goal takes precedence.</p>
      {preferences.data.items.map(({ domain, brief }) => (
        <details className="group group-pad capture-scope" key={domain}>
          <summary className="tf-label">{domain}</summary>
          <section aria-label={`Capture preferences for ${domain}`}>
            <BriefEditor
              key={JSON.stringify(brief)}
              brief={brief}
              submitLabel="Save preferences"
              onSave={async (next) => {
                await api.settings.setCapturePreference({ url: `https://${domain}`, brief: next });
                await preferences.refetch();
                toast({ title: "Capture preferences saved", icon: "check" });
              }}
            />
          </section>
        </details>
      ))}
    </>
  );
}
