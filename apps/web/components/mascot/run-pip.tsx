"use client";

import type { RunStatus } from "@mastertutor/contracts";
import { useEffect } from "react";
import type { PipEvent } from "./pip-machine.ts";
import { PipLazy } from "./pip-lazy.tsx";
import type { PipState } from "./pip-types.ts";
import { usePipMachine } from "./use-pip-machine.ts";

/**
 * The run view's Pip machine: mirrors the run status (pip-machine.ts runPipState), and thinks
 * while the person types a message (send `{ type: "type" }`). runStatus is null until the run
 * loads.
 */
export function useRunPip(
  runStatus: RunStatus | null,
  capturing: boolean,
): [PipState, (event: PipEvent) => void] {
  const [state, send] = usePipMachine();
  useEffect(() => {
    if (runStatus !== null) send({ type: "run", status: runStatus, capturing });
  }, [send, runStatus, capturing]);
  return [state, send];
}

/**
 * The run view's compact Pip. A slot with no layout of its own; the run header places it. The
 * status text beside it stays the real signal.
 */
export function RunPip({ state, onPoke }: { state: PipState; onPoke(): void }) {
  return <PipLazy state={state} size="compact" onPoke={onPoke} />;
}
