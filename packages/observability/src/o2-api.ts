/**
 * Every OpenObserve endpoint, payload shape, role, field name and template variable the provisioner
 * uses (spec §11). Pinned by o2-api.int.test.ts against OPENOBSERVE_IMAGE: when a digest bump changes
 * the API, that test fails and this file is the only one to change. No other file hard-codes an
 * OpenObserve path.
 */
import { OBSERVE_BASE_PATH } from "@mastertutor/contracts";
import { z } from "zod";

const e = encodeURIComponent;
export type StreamType = "logs" | "metrics" | "traces";

/** Paths relative to the base URL. The image serves its whole API only under ZO_BASE_URI. */
export const o2Paths = {
  health: () => "/healthz",
  users: (org: string) => `/api/${org}/users`,
  user: (org: string, email: string) => `/api/${org}/users/${e(email)}`,
  /** Lists the org's streams; any authenticated user can read it. */
  streams: (org: string) => `/api/${org}/streams`,
  /** POST creates (body: o2StreamCreateBody); an existing stream answers 400. There is no GET. */
  stream: (org: string, name: string, type: StreamType) =>
    `/api/${org}/streams/${e(name)}?type=${type}`,
  streamSettings: (org: string, name: string, type: StreamType) =>
    `/api/${org}/streams/${e(name)}/settings?type=${type}`,
  /** PUT on a missing template or destination answers 404, so update-else-create works. */
  templates: (org: string) => `/api/${org}/alerts/templates`,
  template: (org: string, name: string) => `/api/${org}/alerts/templates/${e(name)}`,
  destinations: (org: string) => `/api/${org}/alerts/destinations`,
  destination: (org: string, name: string) => `/api/${org}/alerts/destinations/${e(name)}`,
  alerts: (org: string) => `/api/v2/${org}/alerts`,
  alert: (org: string, id: string) => `/api/v2/${org}/alerts/${e(id)}`,
  dashboards: (org: string) => `/api/${org}/dashboards`,
  /** A stale hash answers 409. */
  dashboard: (org: string, id: string, hash: string) =>
    `/api/${org}/dashboards/${e(id)}?hash=${e(hash)}`,
  jsonIngest: (org: string, stream: string) => `/api/${org}/${e(stream)}/_json`,
  /** OTLP/HTTP ingest (JSON or protobuf); logs pick their stream with the `stream-name` header. */
  otlp: (org: string, signal: "logs" | "metrics" | "traces") => `/api/${org}/v1/${signal}`,
  /** body: { query: { sql, start_time, end_time, from, size } }, times in epoch microseconds. */
  search: (org: string, type: "logs" | "traces") => `/api/${org}/_search?type=${type}`,
  /** Prometheus-compatible instant query over the metric streams. */
  promQuery: (org: string, query: string) =>
    `/api/${org}/prometheus/api/v1/query?query=${e(query)}`,
} as const;

/** The collector's OTLP/HTTP exporter endpoint: the API lives under ZO_BASE_URI, like everything else. */
export function o2OtlpEndpoint(origin: string, org: string): string {
  return `${origin}${OBSERVE_BASE_PATH}/api/${org}`;
}

/**
 * The role each user gets (spec §11). The open-source build refuses every role but admin and root
 * ("Custom roles not allowed"); service_account is accepted but stored as admin. Least privilege
 * therefore comes from the networks: the ingest credential lives only in the collector, and the
 * viewer's only in web's ForwardAuth answer.
 *
 * Image facts (B7): distroless, no sh, curl or wget, and `openobserve node status` answers 404 under a
 * base URI, so there is no compose healthcheck (observability-init polls /healthz). Runs as uid 0 by
 * default and works as 10001:10001 with a read-only root filesystem (the image's /data is 0777).
 */
export const O2_ROLES = { ingest: "admin", viewer: "admin" } as const;

/**
 * Environment every OpenObserve we run sets (compose and tests). ZO_SKIP_SSRF_CHECKS: the alert
 * destination http://web:3000 resolves to a private address, which the SSRF guard refuses; OpenObserve
 * sits on internal networks with no egress, so the guard protects nothing here.
 */
export const O2_REQUIRED_ENV = {
  ZO_BASE_URI: OBSERVE_BASE_PATH,
  ZO_TELEMETRY: "false",
  ZO_USAGE_REPORTING_ENABLED: "false",
  ZO_MMDB_DISABLE_DOWNLOAD: "true",
  ZO_SKIP_SSRF_CHECKS: "true",
} as const;

/** The alert template variable holding the alert's name (= our AlertRule). */
export const O2_TEMPLATE_RULE_VARIABLE = "{alert_name}";

/**
 * Column names as OpenObserve stores OTLP data. Metric names and labels map dots to underscores
 * (names.ts); label values keep their dots (span_name="mt.step"). Histograms become <name>_bucket
 * (with le), _sum and _count. Trace durations are microseconds.
 */
export const O2_FIELDS = {
  timestamp: "_timestamp",
  logSeverity: "severity",
  logBody: "body",
  traceId: "trace_id",
  traceOperation: "operation_name",
  traceStatus: "span_status",
  traceDurationMicros: "duration",
} as const;
export const O2_TRACE_ERROR_STATUS = "ERROR";

/**
 * User bodies. An update takes the password only as change_password + new_password: a `password`
 * field on PUT is silently ignored (the old password keeps working).
 */
export function o2UserCreateBody(email: string, password: string, role: string, name: string) {
  return { email, password, role, first_name: name, last_name: "mastertutor" };
}
export function o2UserUpdateBody(password: string, role: string, name: string) {
  return {
    change_password: true,
    new_password: password,
    role,
    first_name: name,
    last_name: "mastertutor",
  };
}

/** Stream create body: OpenObserve requires both keys. */
export function o2StreamCreateBody(retentionDays?: number): { fields: []; settings: object } {
  return {
    fields: [],
    settings: retentionDays === undefined ? {} : { data_retention: retentionDays },
  };
}

/** A dashboard query's empty filter: OpenObserve requires a group object, not an array. */
export const O2_EMPTY_PANEL_FILTER = {
  filterType: "group",
  logicalOperator: "AND",
  conditions: [],
} as const;

/**
 * Alert semantics: an alert's stream must exist when it is created (metric streams only appear with
 * data, so the provisioner creates them first). A SQL alert's trigger threshold compares the number
 * of rows returned, so a count belongs in HAVING with a trigger threshold of 1. A PromQL alert compares
 * its value through promql_condition (column "value").
 */
export const O2_SQL_ALERT_ROW_THRESHOLD = 1;

export const UserList = z.object({ data: z.array(z.object({ email: z.string() }).loose()) });
export const AlertList = z.object({
  list: z.array(z.object({ alert_id: z.string(), name: z.string() }).loose()),
});
export const DashboardList = z.object({ dashboards: z.array(z.unknown()) });

/** One dashboard from the list endpoint: its id, title and the hash an update must quote. */
export function dashboardRef(entry: unknown): { id: string; title: string; hash: string } | null {
  const parsed = z
    .object({ dashboard_id: z.string(), title: z.string(), hash: z.string() })
    .loose()
    .safeParse(entry);
  return parsed.success
    ? { id: parsed.data.dashboard_id, title: parsed.data.title, hash: parsed.data.hash }
    : null;
}
