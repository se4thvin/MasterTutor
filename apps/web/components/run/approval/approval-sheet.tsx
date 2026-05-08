"use client";

import {
  VIEWPORT,
  approvalScreenshotPath,
  type ApprovalDecisionInput,
} from "@mastertutor/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { approvalCopy } from "../model/approval-copy.ts";
import type { PendingApproval } from "../model/run-model.ts";

/** Keys and buttons stay inert this long after a sheet appears: a keystroke or click meant for something else never decides it (S1). */
const APPROVAL_ARM_MS = 600;

type Choice = "approve" | "deny" | "edit" | "extend" | "finish";
const STANDARD_KEYS: Readonly<Record<string, Choice>> = { a: "approve", d: "deny", e: "edit" };
/** No key cancels a run (S2): Cancel is a button that asks first. */
const BUDGET_KEYS: Readonly<Record<string, Choice>> = { a: "extend", f: "finish" };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

interface ApprovalSheetProps {
  runId: string;
  approval: PendingApproval;
  count: number;
  onDecide(input: ApprovalDecisionInput): void;
  /** D19: the user may take over instead of deciding; the server supersedes the approval. */
  onTakeOver(): void;
}

export function ApprovalSheet({
  runId,
  approval,
  count,
  onDecide,
  onTakeOver,
}: ApprovalSheetProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [instruction, setInstruction] = useState("");
  const copy = approvalCopy(approval.request);
  const request = approval.request;
  const screenshot =
    (request.kind === "risky_click" || request.kind === "form_submit") &&
    request.screenshotKey !== null;
  const base = { approvalId: approval.id, instruction: null, budgetChoice: null } as const;

  const decide = (choice: Choice) => {
    if (!armed) return;
    switch (choice) {
      case "edit":
        setEditing(true);
        return;
      case "approve":
        onDecide({ ...base, decision: "approved" });
        return;
      case "deny":
        onDecide({ ...base, decision: "denied" });
        return;
      case "extend":
        onDecide({ ...base, decision: "approved", budgetChoice: "extend" });
        return;
      case "finish":
        onDecide({ ...base, decision: "approved", budgetChoice: "finish_now" });
        return;
    }
  };
  const sendInstead = () => {
    const text = instruction.trim();
    if (text)
      onDecide({
        approvalId: approval.id,
        decision: "edited",
        instruction: text,
        budgetChoice: null,
      });
  };

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setArmed(true), APPROVAL_ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (editing || confirmCancel) return undefined;
    const keys = copy.budget ? BUDGET_KEYS : STANDARD_KEYS;
    const onKey = (event: KeyboardEvent) => {
      if (!armed || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.fullscreenElement) return;
      // A key pressed inside another dialog (Stop, hand back, the cancel confirm) is not for us.
      const within =
        event.target instanceof Element
          ? event.target.closest('[role="dialog"], [role="alertdialog"]')
          : null;
      if (within && within !== ref.current) return;
      const choice = keys[event.key.toLowerCase()];
      if (!choice) return;
      event.preventDefault();
      decide(choice);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const gated = { "aria-disabled": armed ? undefined : true } as const;
  return (
    <div
      ref={ref}
      className="run-approval"
      data-tone={copy.tone}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      tabIndex={-1}
    >
      <span className="run-approval-handle" aria-hidden="true" />
      <div className="run-approval-top">
        <span className="run-approval-icon" aria-hidden="true">
          <Icon name={copy.tone === "warn" ? "needsReview" : "hand"} />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="run-approval-title">
            <bdi>{copy.title}</bdi>
          </h3>
          <p id={`${id}-body`} className="run-approval-body">
            <bdi>{copy.body}</bdi>
          </p>
        </div>
      </div>
      {copy.checks.length ? (
        <ul className="run-approval-checks" aria-label="Safety warnings">
          {copy.checks.map((check, i) => (
            <li key={i}>
              <bdi>{check}</bdi>
            </li>
          ))}
        </ul>
      ) : null}
      {copy.context ? (
        <p className="run-approval-context">
          On this record:{" "}
          <q>
            <bdi>{copy.context}</bdi>
          </q>
        </p>
      ) : null}
      {copy.risk ? (
        <p className="run-approval-risk">
          <Icon name="needsReview" size="sm" />
          <span>{copy.risk}</span>
        </p>
      ) : null}
      {screenshot ? (
        <figure className="run-approval-shot">
          <img
            src={approvalScreenshotPath(runId, approval.id)}
            alt="The page when the agent asked"
          />
          {copy.spotlight ? (
            <span
              className="run-approval-spot"
              aria-hidden="true"
              style={{
                left: `${(copy.spotlight.x / VIEWPORT.width) * 100}%`,
                top: `${(copy.spotlight.y / VIEWPORT.height) * 100}%`,
              }}
            />
          ) : null}
        </figure>
      ) : null}
      {copy.details.length ? (
        // A sign-in that posts elsewhere opens on its destinations: they are what you decide on.
        <details
          className="run-approval-details"
          open={copy.details.some(([k]) => k === "Sends to") || undefined}
        >
          <summary>
            <Icon name="chevronRight" size="sm" />
            Details
          </summary>
          <dl>
            {copy.details.map(([k, v], i) => (
              // Rows repeat a label ("Sends to" per site), so the index keeps keys unique.
              <div key={`${k}-${i}`}>
                <dt>{k}</dt>
                <dd>
                  <bdi>{v}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {editing ? (
        <div className="run-approval-edit">
          <label htmlFor={`${id}-edit`} className="sr-only">
            Tell the agent what to do instead
          </label>
          <textarea
            id={`${id}-edit`}
            autoFocus
            className="run-note"
            maxLength={2_000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                ref.current?.focus();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendInstead();
              }
            }}
          />
          <div className="run-approval-edit-acts">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={sendInstead} disabled={!instruction.trim()}>
              Send instead
            </Button>
          </div>
        </div>
      ) : copy.budget ? (
        <div className="run-approval-acts" data-armed={armed || undefined}>
          <Button {...gated} onClick={() => armed && setConfirmCancel(true)}>
            Cancel run
          </Button>
          <Button {...gated} aria-keyshortcuts="F" onClick={() => decide("finish")}>
            Finish now <kbd className="kbd">F</kbd>
          </Button>
          <Button
            {...gated}
            variant="primary"
            aria-keyshortcuts="A"
            onClick={() => decide("extend")}
          >
            Extend +50% <kbd className="kbd">A</kbd>
          </Button>
        </div>
      ) : (
        <div className="run-approval-acts" data-armed={armed || undefined}>
          <Button {...gated} aria-keyshortcuts="D" onClick={() => decide("deny")}>
            Deny <kbd className="kbd">D</kbd>
          </Button>
          <Button {...gated} aria-keyshortcuts="E" onClick={() => decide("edit")}>
            Edit <kbd className="kbd">E</kbd>
          </Button>
          <Button
            {...gated}
            variant="primary"
            aria-keyshortcuts="A"
            onClick={() => decide("approve")}
          >
            Approve <kbd className="kbd">A</kbd>
          </Button>
        </div>
      )}
      <div className="run-approval-foot">
        {count > 1 ? (
          <p className="run-approval-more">{count - 1} more waiting after this</p>
        ) : (
          <span />
        )}
        <Button variant="plain" icon="hand" onClick={onTakeOver}>
          Take over instead
        </Button>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this run?"
        description="The agent stops now. Everything it captured stays in the draft note."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        onConfirm={() => onDecide({ ...base, decision: "denied" })}
      />
    </div>
  );
}
