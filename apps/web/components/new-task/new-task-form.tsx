"use client";

import { DEFAULT_BUDGET, type ApprovalMode, type SourceKind } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { emitHero, heroCaptureFloor } from "@/components/hero/hero-events.ts";
import { Hero3D } from "@/components/hero/hero-3d.tsx";
import { useFolders } from "@/components/library/use-folders.ts";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { SOURCE_KIND_ICON } from "@/lib/ui/vocabulary.ts";
import {
  buildCreateRunInput,
  startErrorCopy,
  type BudgetPreset,
  type SourceChip,
} from "./draft.ts";
import { OptionsGrid } from "./options-grid.tsx";
import { SourceField } from "./source-field.tsx";

const SUGGESTIONS = [
  "Capture this PDF verbatim, figures included",
  "Chapter notes for a YouTube lecture",
  "Every code listing from a docs page",
] as const;

export function NewTaskForm() {
  const router = useRouter();
  const toast = useToast();
  const goalId = useId();
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const settings = useQuery(orpc.settings.get.queryOptions({ input: {} }));
  const folders = useFolders();
  const [goal, setGoal] = useState("");
  const [sources, setSources] = useState<SourceChip[]>([]);
  const [adding, setAdding] = useState<SourceKind | null>(null);
  // null until the user edits the list: until then the Settings default shows through.
  const [domainEdits, setDomainEdits] = useState<string[] | null>(null);
  const [budget, setBudget] = useState<BudgetPreset>("standard");
  // "Ask me" is the default and never remembered (S10).
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  // D44: bypass needs a fresh, explicit acknowledgement each time it is chosen; never remembered.
  const [bypassAcknowledged, setBypassAcknowledged] = useState(false);
  const chooseMode = (next: ApprovalMode) => {
    setApprovalMode(next);
    setBypassAcknowledged(false);
  };
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const domains = domainEdits ?? settings.data?.defaultAllowedOrigins ?? [];
  const standardBudget = settings.data?.defaultBudget ?? DEFAULT_BUDGET;
  const killed = settings.data?.killSwitch === true;
  const bypassUnconfirmed = approvalMode === "bypass" && !bypassAcknowledged;

  async function start() {
    if (busy || killed) return;
    const input = buildCreateRunInput({
      goal,
      sources,
      domains,
      budget,
      standardBudget,
      approvalMode,
      targetFolderId: folderId,
      bypassAcknowledged,
    });
    if ("error" in input) {
      setError(input.error);
      goalRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    emitHero("start");
    try {
      const [run] = await Promise.all([api.runs.create(input), heroCaptureFloor()]);
      router.push(`/runs/${run.id}`);
    } catch (failure) {
      setBusy(false);
      toast({ title: startErrorCopy(failure), tone: "danger" });
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <form
      className="wrap nt"
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <section className="nt-intro" aria-labelledby={`${goalId}-title`}>
        <div className="nt-copy">
          <p className="eyebrow">New task</p>
          <h1 id={`${goalId}-title`} className="nt-title">
            Take notes on<span className="period">…</span>
          </h1>
          <p className="nt-lede">
            Add a source, or just the goal and I&apos;ll find one. I work in my own browser, capture
            faithfully, and ask before anything consequential.
          </p>
          <div className="nt-composer">
            <label className="sr-only" htmlFor={goalId}>
              Describe the task
            </label>
            <textarea
              id={goalId}
              ref={goalRef}
              className="nt-goal"
              value={goal}
              maxLength={4_000}
              placeholder="Week 3 of the ML course: every lecture, figure and table. Skip the quizzes."
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${goalId}-error` : undefined}
              onChange={(e) => setGoal(e.target.value)}
              onInput={() => emitHero("type")}
              onFocus={() => emitHero("focus", true)}
              onBlur={() => emitHero("focus", false)}
            />
            {sources.length ? (
              <ul className="nt-chips" aria-label="Sources">
                {sources.map((source) => (
                  <li key={source.url}>
                    <Chip
                      icon={SOURCE_KIND_ICON[source.kind]}
                      removeLabel={`Remove ${source.host}`}
                      onRemove={() => setSources(sources.filter((s) => s.url !== source.url))}
                    >
                      <bdi>{source.label}</bdi>
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : null}
            {adding ? (
              <SourceField
                key={adding}
                kind={adding}
                onCancel={() => setAdding(null)}
                onAdd={(source) => {
                  setSources((current) =>
                    current.some((s) => s.url === source.url) ? current : [...current, source],
                  );
                  setAdding(null);
                }}
              />
            ) : null}
            <div className="nt-foot">
              <Button variant="plain" icon="link" onClick={() => setAdding("web")}>
                URL
              </Button>
              <Button variant="plain" icon="video" onClick={() => setAdding("youtube")}>
                YouTube
              </Button>
              <Button variant="plain" icon="pdf" onClick={() => setAdding("pdf")}>
                PDF
              </Button>
              <span className="nt-spacer" />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={busy || killed || bypassUnconfirmed}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                {busy ? "Starting…" : "Start"}
                <kbd className="kbd" aria-hidden="true">
                  ⌘↵
                </kbd>
              </Button>
            </div>
          </div>
          {killed ? (
            <p className="nt-note" role="status">
              The kill switch is on. Turn it off in Settings to start tasks.
            </p>
          ) : bypassUnconfirmed ? (
            <p className="nt-note" role="status">
              Confirm bypass mode under Approvals to start.
            </p>
          ) : null}
          {error ? (
            <p id={`${goalId}-error`} role="alert" className="nt-error">
              {error}
            </p>
          ) : null}
          <div className="nt-suggest">
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                onClick={() => {
                  setGoal(suggestion);
                  emitHero("type");
                  goalRef.current?.focus();
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
        <div className="nt-hero">
          <Hero3D />
        </div>
      </section>
      <OptionsGrid
        sources={sources}
        domains={domains}
        onDomains={setDomainEdits}
        budget={budget}
        onBudget={setBudget}
        standardBudget={standardBudget}
        approvalMode={approvalMode}
        onApprovalMode={chooseMode}
        bypassAcknowledged={bypassAcknowledged}
        onBypassAcknowledged={setBypassAcknowledged}
        folders={folders}
        folderId={folderId}
        onFolder={setFolderId}
      />
    </form>
  );
}
