"use client";

import {
  toOrigin,
  type ApprovalMode,
  type Budget,
  type FolderView,
  untrustedText,
} from "@mastertutor/contracts";
import { useId, useState, type Ref } from "react";
import { BypassConsent } from "@/components/approval-mode/bypass-consent.tsx";
import { APPROVAL_MODE_ITEMS, APPROVAL_MODE_TEXT } from "@/components/approval-mode/modes.ts";
import { formatCount } from "@/components/bits/format.ts";
import { RollingNumber } from "@/components/bits/rolling-number.tsx";
import { RubberSegment } from "@/components/bits/rubber-segment.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { buildFolderTree, flattenAll } from "@/lib/folders/tree.ts";
import { BUDGET_PRESETS, type BudgetPreset, type SourceChip } from "./draft.ts";

const PRESETS = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
] as const satisfies readonly { value: BudgetPreset; label: string }[];

interface OptionsGridProps {
  sources: SourceChip[];
  domains: string[];
  onDomains(next: string[]): void;
  /** Why Start was refused because of the allowed domains (auto mode with none). */
  domainsError: string | null;
  addDomainRef: Ref<HTMLButtonElement>;
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
        <p className="nt-opt-text">
          {sourceHosts.length + p.domains.length > 0
            ? "The agent stays on these. Leaving them asks you first."
            : "None yet. Every site the agent opens is a new domain."}
        </p>
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
          <Button
            ref={p.addDomainRef}
            variant="plain"
            icon="add"
            aria-invalid={p.domainsError ? true : undefined}
            aria-describedby={p.domainsError ? `${id}-domains-error` : undefined}
            onClick={() => setAdding(true)}
          >
            Add domain
          </Button>
        )}
        {p.domainsError ? (
          <p id={`${id}-domains-error`} role="alert" className="nt-error">
            {p.domainsError}
          </p>
        ) : null}
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
          items={APPROVAL_MODE_ITEMS}
          value={p.approvalMode}
          onChange={p.onApprovalMode}
          aria-label="Approvals"
          fit="content"
        />
        <p className="nt-opt-text">{APPROVAL_MODE_TEXT[p.approvalMode]}</p>
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
          <BypassConsent
            id={`${id}-bypass`}
            checked={p.bypassAcknowledged}
            onChange={p.onBypassAcknowledged}
            label="I understand. Start this run in bypass mode."
          />
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
