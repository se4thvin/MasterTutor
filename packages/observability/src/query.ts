/**
 * The runtime-safe half of this package (Observer spec §5.2, §7.4): OpenObserve's read-only query
 * API for the observer service. Pinned by o2-api.int.test.ts against OPENOBSERVE_IMAGE. Provisioning
 * code is never reachable from here.
 *
 * Pinned facts (spike §10): _search answers 400 for an unknown stream, invalid SQL or a non-SELECT;
 * a SQL LIMIT below `size` wins; `timeout` (seconds) is accepted. query_range answers a matrix, an
 * empty one for an unknown metric, and 400 for invalid PromQL. Cancellation is by HTTP abort.
 */
import { z } from "zod";
import { o2Paths } from "./o2-api.ts";

export { createO2Client, O2Error, type O2Client } from "./client.ts";
export { o2Label, o2StreamName } from "./names.ts";
export { O2_FIELDS } from "./o2-api.ts";

const e = encodeURIComponent;

export const o2QueryPaths = {
  /** POST, body O2SearchBody; times are epoch microseconds. */
  search: o2Paths.search,
  /** GET; times are epoch seconds, step in seconds. */
  queryRange: (
    org: string,
    params: { query: string; start: number; end: number; step: number },
  ): string =>
    `/api/${org}/prometheus/api/v1/query_range?query=${e(params.query)}&start=${params.start}&end=${params.end}&step=${params.step}`,
} as const;

export const O2SearchBody = z.strictObject({
  query: z.strictObject({
    sql: z.string().min(1).max(4_000),
    start_time: z.number().int(),
    end_time: z.number().int(),
    from: z.number().int().min(0),
    size: z.number().int().min(1).max(200),
  }),
  timeout: z.number().int().min(1).max(10).optional(),
});
export type O2SearchBody = z.infer<typeof O2SearchBody>;

export const O2SearchResponse = z.object({
  took: z.number(),
  total: z.number().optional(),
  scan_size: z.number().optional(),
  hits: z.array(z.record(z.string(), z.unknown())),
});
export type O2SearchResponse = z.infer<typeof O2SearchResponse>;

const Sample = z.tuple([z.number(), z.string()]);
export const O2RangeResponse = z.object({
  status: z.string(),
  data: z.object({
    resultType: z.string(),
    result: z.array(
      z.object({ metric: z.record(z.string(), z.string()), values: z.array(Sample) }),
    ),
  }),
});
export type O2RangeResponse = z.infer<typeof O2RangeResponse>;
