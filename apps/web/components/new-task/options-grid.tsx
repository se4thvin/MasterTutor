"use client";

import { toOrigin, type ApprovalMode, type Budget, type FolderView } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { formatCount } from "@/components/bits/format.ts";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";
import { RubberSegment } from "@/components/bits/rubber-segment.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { untrustedText } from "@/components/run/model/untrusted-text.ts";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { BUDGET_PRESETS, type BudgetPreset, type SourceChip } from "./draft.ts";

const PRESETS = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
] as const satisfies readonly { value: BudgetPreset; label: string }[];

const MODES = [
  { value: "ask", label: "Ask me" },
  { value: "auto_within_allowlist", label: "Auto in allowed domains" },
  { value: "bypass", label: "Bypass approvals" },
] as const satisfies readonly { value: ApprovalMode; label: string }[];

const MODE_TEXT: Record<ApprovalMode, string> = {
  ask: "Risky clicks, form submits, downloads, first sign-ins and new domains always ask you first.",
  auto_within_allowlist:
    "Risky clicks, forms and first sign-ins in your allowed domains go ahead and are logged.",
  bypass:
    "Steps go ahead without asking, except budget limits and prompt-injection warnings; each one is logged.",
};

interface OptionsGridProps {
  sources: SourceChip[];
  domains: string[];
  onDomains(next: string[]): void;
  budget: BudgetPreset;
  onBudget(next: BudgetPreset): void;
  standardBudget: Budget;
  approvalMode: ApprovalMode;
  onApprovalMode(next: ApprovalMode): void;
  /** D44: the explicit opt-in that bypass mode needs before Start. */
  bypassAcknowledged: boolean;
  onBypassAcknowledged(next: boolean): void;
  folders: FolderView[];
  folderId: string | null;
  onFolder(next: string | null): void;
}

export function OptionsGrid(p: OptionsGridProps) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [invalid, setInvalid] = useState(false);
  const budget = p.budget === "standard" ? p.standardBudget : BUDGET_PRESETS[p.budget];
  const sourceHosts = [...new Set(p.sources.map((s) => new URL(s.origin).host))];
  const addDomain = () => {
    const origin = toOrigin(domain.trim());
    if (!origin) {
      setInvalid(true);
      return;
    }
    if (!p.domains.includes(origin)) p.onDomains([...p.domains, origin]);
    setDomain("");
    setAdding(false);
  };

  return (
    <div className="nt-opts">
      <section className="nt-opt" aria-labelledby={`${id}-domains`}>
        <span className="eyebrow">01</span>
        <h2 id={`${id}-domains`} className="nt-opt-title">
          Allowed domains
        </h2>
        <p className="nt-opt-text">The agent stays on these. Leaving them asks you first.</p>
        <ul className="nt-chips" aria-label="Allowed domains">
          {sourceHosts.map((host) => (
            <li key={`src-${host}`}>
              <Chip icon="link">{host}</Chip>
            </li>
          ))}
          {p.domains.map((origin) => {
            const host = new URL(origin).host;
            return (
              <li key={origin}>
                <Chip
                  icon="web"
                  removeLabel={`Remove ${host}`}
                  onRemove={() => p.onDomains(p.domains.filter((d) => d !== origin))}
                >
                  {host}
                </Chip>
              </li>
            );
          })}
        </ul>
        {adding ? (
          <div className="nt-field">
            <label htmlFor={`${id}-domain`} className="sr-only">
              Allowed domain
            </label>
            <input
              id={`${id}-domain`}
              autoFocus
              inputMode="url"
              placeholder="example.com"
              value={domain}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                setDomain(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  addDomain();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAdding(false);
                }
              }}
            />
            <Button onClick={addDomain}>Add</Button>
            {invalid ? <p className="nt-error">Enter a domain like example.com.</p> : null}
          </div>
        ) : (
          <Button variant="plain" icon="add" onClick={() => setAdding(true)}>
            Add domain
          </Button>
        )}
      </section>

      <section className="nt-opt" aria-labelledby={`${id}-budget`}>
        <span className="eyebrow">02</span>
        <h2 id={`${id}-budget`} className="nt-opt-title">
          Budget
        </h2>
        <p className="nt-opt-text">Pauses and asks when it hits a limit.</p>
        <RubberSegment items={PRESETS} value={p.budget} onChange={p.onBudget} aria-label="Budget" />
        <dl className="nt-numerals">
          <div>
            <dd data-testid="budget-steps">
              <RollingNumber value={formatCount(budget.maxSteps, 0)} />
            </dd>
            <dt>steps</dt>
          </div>
          <div>
            <dd>
              <RollingNumber
                value={formatCount(budget.maxUsd, Number.isInteger(budget.maxUsd) ? 0 : 2, "$")}
              />
            </dd>
            <dt>max spend</dt>
          </div>
          <div>
            <dd>
              <RollingNumber value={formatCount(budget.maxActiveMinutes, 0)} />
            </dd>
            <dt>minutes</dt>
          </div>
        </dl>
      </section>

      <section className="nt-opt" aria-labelledby={`${id}-mode`}>
        <span className="eyebrow">03</span>
        <h2 id={`${id}-mode`} className="nt-opt-title">
          Approvals
        </h2>
        <RubberSegment
          items={MODES}
          value={p.approvalMode}
          onChange={p.onApprovalMode}
          aria-label="Approvals"
          fit="content"
        />
        <p className="nt-opt-text">{MODE_TEXT[p.approvalMode]}</p>
        {p.approvalMode === "auto_within_allowlist" ? (
          <p className="nt-risk">
            <Icon name="needsReview" size="sm" />
            <span>
              Purchases, deletions and posts on these domains go ahead without asking. Downloads and
              new domains stay blocked, and budget limits still ask.
            </span>
          </p>
        ) : null}
        {p.approvalMode === "bypass" ? (
          <>
            {/* D44: informed consent. Everything bypass lifts, and everything it never lifts. */}
            <div className="nt-risk" id={`${id}-bypass`} data-testid="bypass-warning">
              <Icon name="needsReview" size="sm" />
              <div>
                <p>
                  Bypass approves every step on its own: purchases, deletions, posts, form submits,
                  downloads, new domains, first use of a saved sign-in, frames it can&apos;t
                  inspect, and irrelevant- or sensitive-site warnings.
                </p>
                <p>
                  It never lifts these: prompt-injection warnings still stop for you. Budget limits
                  still pause. Secrets never reach the agent, logs or screenshots. Sign-ins only go
                  to their own site. No access to private networks. The kill switch and Take over
                  always work.
                </p>
              </div>
            </div>
            <label className="nt-check">
              <input
                type="checkbox"
                checked={p.bypassAcknowledged}
                aria-describedby={`${id}-bypass`}
                onChange={(e) => p.onBypassAcknowledged(e.target.checked)}
              />
              <span>I understand. Start this run in bypass mode.</span>
            </label>
          </>
        ) : null}
        <label className="nt-select" htmlFor={`${id}-folder`}>
          <span>Save to</span>
          <select
            id={`${id}-folder`}
            value={p.folderId ?? ""}
            onChange={(e) => p.onFolder(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">Let the agent file it</option>
            {flattenAll(buildFolderTree(p.folders)).map((node) => (
              <option key={node.folder.id} value={node.folder.id}>
                {`${"\u2003".repeat(node.depth - 1)}${untrustedText(node.folder.name, 120)}`}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}
