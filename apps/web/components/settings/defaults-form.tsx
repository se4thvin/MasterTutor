"use client";

import { Budget, OriginInput, type SettingsView } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { api } from "@/lib/api/client.ts";
import { saveSettingsFields } from "@/lib/settings/cache.ts";

/** The contract's cap on default allowed websites (UpdateSettingsInput). */
const MAX_ORIGINS = 50;

type Errors = { steps?: string; usd?: string; minutes?: string; origin?: string };

/**
 * Defaults for new tasks. Save and Revert appear only when the draft differs from the saved values.
 * The parent keys this form on the saved settings, so a successful save resets the draft.
 */
export function DefaultsForm({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = {
    steps: String(settings.defaultBudget.maxSteps),
    usd: String(settings.defaultBudget.maxUsd),
    minutes: String(settings.defaultBudget.maxActiveMinutes),
    origins: settings.defaultAllowedOrigins,
  };
  const [draft, setDraft] = useState(initial);
  const [newOrigin, setNewOrigin] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  // A website typed but not yet added counts as an edit, so Save is offered and will add it.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || newOrigin.trim() !== "";

  /** The origins with the typed website added, or the error to show. Empty input adds nothing. */
  const withTypedOrigin = (): { origins: string[] } | { error: string } => {
    if (!newOrigin.trim()) return { origins: draft.origins };
    const parsed = OriginInput.safeParse(newOrigin);
    if (!parsed.success) return { error: "Enter a website such as example.com." };
    if (draft.origins.includes(parsed.data)) return { origins: draft.origins };
    if (draft.origins.length >= MAX_ORIGINS) return { error: `Use up to ${MAX_ORIGINS} websites.` };
    return { origins: [...draft.origins, parsed.data] };
  };

  const addOrigin = () => {
    const next = withTypedOrigin();
    if ("error" in next) {
      setErrors((e) => ({ ...e, origin: next.error }));
      return;
    }
    setErrors((e) => ({ ...e, origin: undefined }));
    setDraft((d) => ({ ...d, origins: next.origins }));
    setNewOrigin("");
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const origins = withTypedOrigin();
    const budget = Budget.safeParse({
      maxSteps: Number(draft.steps),
      maxUsd: Number(draft.usd),
      maxActiveMinutes: Number(draft.minutes),
    });
    if (!budget.success || "error" in origins) {
      const fields = new Set(budget.error?.issues.map((i) => String(i.path[0])));
      setErrors({
        steps: fields.has("maxSteps") ? "Use 1–10,000 steps." : undefined,
        usd: fields.has("maxUsd") ? "Use more than $0 and at most $1,000." : undefined,
        minutes: fields.has("maxActiveMinutes") ? "Use 1–1,440 minutes." : undefined,
        origin: "error" in origins ? origins.error : undefined,
      });
      return;
    }
    setErrors({});
    setPending(true);
    // Owns only the defaults: a late response cannot touch the kill switch.
    const ok = await saveSettingsFields(qc, ["defaultBudget", "defaultAllowedOrigins"], () =>
      api.settings.update({ defaultBudget: budget.data, defaultAllowedOrigins: origins.origins }),
    );
    setPending(false);
    if (ok) setNewOrigin("");
    toast(
      ok
        ? { title: "Defaults saved", icon: "check" }
        : { title: "Couldn't save the defaults.", icon: "needsReview", tone: "danger" },
    );
  }

  return (
    <form className="defaults" onSubmit={save} noValidate>
      <div className="defaults-budget">
        <TextField
          label="Max steps"
          inputMode="numeric"
          value={draft.steps}
          error={errors.steps}
          onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))}
        />
        <TextField
          label="Max spend (USD)"
          inputMode="decimal"
          value={draft.usd}
          error={errors.usd}
          onChange={(e) => setDraft((d) => ({ ...d, usd: e.target.value }))}
        />
        <TextField
          label="Max active minutes"
          inputMode="numeric"
          value={draft.minutes}
          error={errors.minutes}
          onChange={(e) => setDraft((d) => ({ ...d, minutes: e.target.value }))}
        />
      </div>
      <div className="grid gap-2">
        <span className="tf-label">Allowed websites</span>
        <div className="flex min-w-0 flex-wrap gap-2">
          {draft.origins.length ? (
            draft.origins.map((o) => (
              <Chip
                key={o}
                icon="web"
                onRemove={() =>
                  setDraft((d) => ({ ...d, origins: d.origins.filter((x) => x !== o) }))
                }
                removeLabel={`Remove ${o}`}
              >
                {o}
              </Chip>
            ))
          ) : (
            <span className="t-foot">None. Each task names its own websites.</span>
          )}
        </div>
        <TextField
          label="Add a website"
          placeholder="example.com"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={newOrigin}
          error={errors.origin}
          onChange={(e) => setNewOrigin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOrigin();
            }
          }}
        />
      </div>
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              setDraft(initial);
              setNewOrigin("");
              setErrors({});
            }}
          >
            Revert
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            Save defaults
          </Button>
        </div>
      ) : null}
    </form>
  );
}
