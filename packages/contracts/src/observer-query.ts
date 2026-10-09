import { z } from "zod";
import { COPILOT_LIMITS } from "./observer.ts";
import { LOG_STREAMS, TRACE_STREAM } from "./telemetry.ts";

export const COPILOT_STREAMS = [LOG_STREAMS.app, LOG_STREAMS.containers, TRACE_STREAM] as const;
export type CopilotStream = (typeof COPILOT_STREAMS)[number];
const seconds = z.number().finite().nonnegative();
export const ObserverSearch = z.strictObject({
  stream: z.enum(COPILOT_STREAMS),
  sql: z.string().min(1).max(4_000),
  range: z
    .strictObject({ startUs: seconds.int(), endUs: seconds.int() })
    .refine(
      ({ startUs, endUs }) =>
        endUs > startUs && endUs - startUs <= COPILOT_LIMITS.searchMaxHours * 3_600_000_000,
    ),
  size: z.number().int().min(1).max(COPILOT_LIMITS.storedRows),
});
export const ObserverRange = z.strictObject({
  query: z.string().min(1).max(2_000),
  range: z
    .strictObject({ start: seconds, end: seconds, step: z.number().finite().positive() })
    .refine(
      ({ start, end, step }) =>
        end >= start &&
        end - start <= COPILOT_LIMITS.metricMaxHours * 3_600 &&
        Math.floor((end - start) / step) + 1 <= COPILOT_LIMITS.points,
    ),
});
export const ObserverInstant = z.strictObject({
  query: z.string().min(1).max(2_000),
  time: seconds,
});
export const ObserverTable = z.strictObject({
  columns: z.array(z.string().max(COPILOT_LIMITS.columnChars)).max(COPILOT_LIMITS.columns),
  rows: z
    .array(
      z
        .array(
          z.union([
            z.string().max(COPILOT_LIMITS.cellChars),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
        )
        .max(COPILOT_LIMITS.columns),
    )
    .max(COPILOT_LIMITS.storedRows),
  truncated: z.boolean(),
});
export const ObserverSearchResult = ObserverTable.extend({
  took: z.number().nonnegative(),
  scanSize: z.number().nullable(),
});
export type ObserverTable = z.infer<typeof ObserverTable>;
