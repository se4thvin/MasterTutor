import type { ApprovalMode } from "@mastertutor/contracts";
import { Suspense } from "react";
import { APPROVAL_MODE_LABEL, APPROVAL_MODE_SHORT } from "@/components/approval-mode/modes.ts";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";

/** The toolbar button that shows the run's approval mode: the same before and after its menu loads. */
export function modeTriggerProps(mode: ApprovalMode, disabled: boolean) {
  return {
    className: "btn btn-plain run-mode-btn",
    "data-mode": mode,
    disabled,
    "aria-label": `Approvals: ${APPROVAL_MODE_LABEL[mode]}`,
    children: (
      <>
        <Icon name={mode === "bypass" ? "needsReview" : "approvals"} size="sm" />
        <span className="run-mode-label">{APPROVAL_MODE_SHORT[mode]}</span>
        <Icon name="chevronDown" size="sm" />
      </>
    ),
  };
}

/**
 * The menu, its Bypass sheet and the consent text are off the run page's first load (budget):
 * until they arrive (prefetched when the browser is idle) the button shows the mode, inert.
 */
const { Component: LazyModeControl, usePrefetch } = lazyComponent(() =>
  import("./mode-control.tsx").then((mod) => mod.ModeControl),
);
const ignoreFailure = () => undefined;

export function ModeControl(props: {
  mode: ApprovalMode;
  disabled: boolean;
  onChange(mode: ApprovalMode): void;
}) {
  usePrefetch();
  return (
    <ChunkBoundary what="the approval mode menu" onFailed={ignoreFailure}>
      <Suspense
        fallback={<button type="button" aria-busy="true" {...modeTriggerProps(props.mode, true)} />}
      >
        <LazyModeControl {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}
