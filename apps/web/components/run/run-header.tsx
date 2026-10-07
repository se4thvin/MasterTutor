import type { ApprovalMode } from "@mastertutor/contracts";
import { StatusMark } from "@/components/bits/status-mark.tsx";
import { ButtonLink } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import type { BrowserState } from "./model/browser-state.ts";
import { STATE_PILL, hostAndPath, markFor, shortRunId, statusLabel } from "./model/copy.ts";
import type { RunModel } from "./model/run-model.ts";
import { untrustedText } from "./model/untrusted-text.ts";

const MODE: Record<ApprovalMode, string> = {
  ask: "asks first",
  auto_within_allowlist: "auto in allowed domains",
  bypass: "bypass",
};

export function RunHeader({ model, state }: { model: RunModel; state: BrowserState }) {
  const host = hostAndPath(model.currentUrl)?.host ?? "no page yet";
  const started = new Date(model.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  // The goal is user text, possibly another member's: cleaned like page text (final M11).
  const title = untrustedText(model.goal.split("\n")[0], 4000);
  return (
    <header className="run-head">
      <div className="run-head-text">
        <p className="run-eyebrow">
          <span className="run-status" data-tone={STATE_PILL[state].tone}>
            <StatusMark status={markFor(state, model)} decorative />
            {statusLabel(state, model)}
          </span>
          <span className="run-meta">
            {shortRunId(model.runId)} · <bdi>{host}</bdi> · {model.model} ·{" "}
            {MODE[model.approvalMode]} · started {started}
          </span>
        </p>
        <h1 className="run-title">
          <bdi>{title}</bdi>
        </h1>
        {model.approvalMode === "bypass" ? (
          // D44: persistent while the run lives, whatever the browser state.
          <p className="run-bypass" role="note" aria-label="Bypass mode">
            <Icon name="needsReview" size="sm" />
            <span>
              <b>Bypass mode.</b> Approvals are automatic, including first use of a saved sign-in;
              budget limits still pause, prompt-injection warnings still stop for you, and Take over
              and the kill switch always work.
            </span>
          </p>
        ) : null}
      </div>
      {model.noteId ? (
        <ButtonLink href={`/notes/${model.noteId}`} icon="note">
          Open draft note
        </ButtonLink>
      ) : null}
    </header>
  );
}
