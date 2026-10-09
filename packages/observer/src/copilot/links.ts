import { Uuid, observabilityOrigin, observabilityUiPaths } from "@mastertutor/contracts";
import { TRACE_STREAM } from "@mastertutor/contracts/telemetry";
export function runLink(runId: string): string {
  return `/runs/${Uuid.parse(runId)}`;
}
/** Uses the spike-pinned WHERE-filter URL, never a model-generated link. */
export function o2TraceLink(
  appUrl: string,
  runId: string,
  range: { fromUs: number; toUs: number },
): string {
  return `${observabilityOrigin(appUrl)}${observabilityUiPaths.traceList(TRACE_STREAM, {
    filter: `mt_run_id = '${Uuid.parse(runId)}'`,
    from: range.fromUs,
    to: range.toUs,
  })}`;
}
