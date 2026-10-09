import {
  ChartSpec,
  COPILOT_LIMITS,
  COPILOT_STREAMS,
  RunStatus,
  type CopilotToolName,
} from "@mastertutor/contracts";
import { z } from "zod";
import { RunHandle } from "./handles.ts";

/** OpenAI strict tools need every field present: optional values are nullable (spec §7.5). */
const CodePath = z
  .string()
  .regex(/^(?:apps|packages|infra)\/[A-Za-z0-9._/()[\]-]{1,240}$/)
  .refine((p) => !p.split("/").includes(".."), "No parent-directory components");

export const MetricsQueryArgs = z.strictObject({
  promql: z.string().min(1).max(2_000),
  rangeHours: z.number().int().min(1).max(2_160).nullable(),
  stepSeconds: z.number().int().min(15).max(86_400).nullable(),
});
export const TelemetrySearchArgs = z.strictObject({
  stream: z.enum(COPILOT_STREAMS),
  sql: z.string().min(1).max(4_000),
  rangeHours: z.number().int().min(1).max(168).nullable(),
});
export const RunsFindArgs = z.strictObject({
  status: RunStatus.nullable(),
  errorCode: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullable(),
  sinceHours: z.number().int().min(1).max(2_160),
  limit: z.number().int().min(1).max(50),
});
export const RunDetailArgs = z.strictObject({ run: RunHandle, includeUntrusted: z.boolean() });
export const RunTracesArgs = z.strictObject({
  run: RunHandle,
  limit: z.number().int().min(1).max(50),
});
export const CodeSearchArgs = z.strictObject({
  query: z.string().min(2).max(100),
  pathPrefix: z
    .string()
    .regex(/^(?:apps|packages|infra)(?:\/[A-Za-z0-9._/()[\]-]*)?$/)
    .refine((p) => !p.split("/").includes(".."), "No parent-directory components")
    .nullable(),
});
export const CodeReadArgs = z.strictObject({
  path: CodePath,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});
export const RenderChartArgs = ChartSpec;

export const COPILOT_TOOLS = {
  metrics_query: {
    taint: "never",
    limits: {
      series: COPILOT_LIMITS.series,
      points: COPILOT_LIMITS.points,
      rangeHours: COPILOT_LIMITS.metricMaxHours,
    },
    schema: MetricsQueryArgs,
    description:
      "Run a PromQL range query over registry metrics (names in the catalog). The server sets the step and caps series.",
  },
  telemetry_search: {
    taint: "containers",
    limits: { rows: COPILOT_LIMITS.storedRows, rangeHours: COPILOT_LIMITS.searchMaxHours },
    schema: TelemetrySearchArgs,
    description:
      "Run one SQL SELECT on one OpenObserve stream (mastertutor logs, containers logs, default traces). The server sets the time range and row cap.",
  },
  runs_find: {
    taint: "never",
    limits: { rows: COPILOT_LIMITS.modelRows },
    schema: RunsFindArgs,
    description:
      "Find runs by status and error code in the live database. Returns run handles (R1…).",
  },
  run_detail: {
    taint: "opt_in",
    limits: { rows: COPILOT_LIMITS.storedRows },
    schema: RunDetailArgs,
    description:
      "One run's steps, approvals, events and Guard reviews from the live database. includeUntrusted adds goals, captions and page origins only when the user opted in.",
  },
  run_traces: {
    taint: "always",
    limits: { rows: COPILOT_LIMITS.modelRows },
    schema: RunTracesArgs,
    description: "The slowest and failed traces of one run (OpenObserve, 20–60 s behind).",
  },
  code_search: {
    taint: "never",
    limits: { matches: COPILOT_LIMITS.codeMatches },
    schema: CodeSearchArgs,
    description: "Literal text search over MasterTutor's source (apps, packages, infra).",
  },
  code_read: {
    taint: "never",
    limits: { lines: COPILOT_LIMITS.codeReadLines },
    schema: CodeReadArgs,
    description: "Read up to 200 lines of one source file.",
  },
  render_chart: {
    taint: "never",
    limits: { rows: COPILOT_LIMITS.storedRows },
    schema: RenderChartArgs,
    description:
      "Draw a stored result as a line, bar or table chart. Columns must exist in that result.",
  },
} as const satisfies Record<
  CopilotToolName,
  {
    schema: z.ZodObject;
    description: string;
    taint: string;
    limits: Readonly<Record<string, number>>;
  }
>;

export type MetricsQueryArgs = z.infer<typeof MetricsQueryArgs>;

export type TelemetrySearchArgs = z.infer<typeof TelemetrySearchArgs>;

export type RunsFindArgs = z.infer<typeof RunsFindArgs>;

export type RunDetailArgs = z.infer<typeof RunDetailArgs>;

export type RunTracesArgs = z.infer<typeof RunTracesArgs>;

export type CodeSearchArgs = z.infer<typeof CodeSearchArgs>;

export type CodeReadArgs = z.infer<typeof CodeReadArgs>;

export type RenderChartArgs = z.infer<typeof RenderChartArgs>;
