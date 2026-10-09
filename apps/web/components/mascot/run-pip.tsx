"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useEffect } from "react";
import { PipLazy } from "./pip-lazy.tsx";
import { usePipMachine } from "./use-pip-machine.ts";

/**
 * The run view's compact Pip: mirrors the run status (pip-machine.ts runPipState). A slot with
 * no layout of its own; the run header (or thread panel) places it. The status text beside it
 * stays the real signal.
 */
export function RunPip({
  runStatus,
  capturing = false,
}: {
  runStatus: RunStatus;
  capturing?: boolean;
}) {
  const [state, send] = usePipMachine();
  useEffect(
    () => send({ type: "run", status: runStatus, capturing }),
    [send, runStatus, capturing],
  );
  return <PipLazy state={state} size="compact" onPoke={() => send({ type: "poke" })} />;
}
