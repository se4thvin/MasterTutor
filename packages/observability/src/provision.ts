import { OBSERVE_USERS } from "@mastertutor/contracts";
import { LOG_STREAMS, RETENTION_DAYS, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import { O2Error, type O2Client } from "./client.ts";
import {
  O2_ROLES,
  O2_TEMPLATE_RULE_VARIABLE,
  UserList,
  o2Paths,
  o2StreamCreateBody,
  o2UserCreateBody,
  o2UserUpdateBody,
  type StreamType,
} from "./o2-api.ts";

export const ALERT_TEMPLATE_NAME = "mastertutor-webhook";
export const ALERT_DESTINATION_NAME = "mastertutor-web";

/** The webhook body (spec §13.2): the rule's name only, never counts, rows or query text. */
export function alertTemplateBody(): string {
  return `{"rule":"${O2_TEMPLATE_RULE_VARIABLE}"}`;
}

/** Creates the ingest and viewer users, or resets an existing one's role and password. */
export async function provisionUsers(
  client: O2Client,
  passwords: { ingest: string; viewer: string },
): Promise<void> {
  const list = await client.call(
    "listUsers",
    "GET",
    o2Paths.users(client.org),
    undefined,
    UserList,
  );
  const existing = new Set(list.data.map((user) => user.email));
  for (const [who, email] of [
    ["ingest", OBSERVE_USERS.ingest],
    ["viewer", OBSERVE_USERS.viewer],
  ] as const) {
    if (existing.has(email))
      await client.call(
        "updateUser",
        "PUT",
        o2Paths.user(client.org, email),
        o2UserUpdateBody(passwords[who], O2_ROLES[who], who),
      );
    else
      await client.call(
        "createUser",
        "POST",
        o2Paths.users(client.org),
        o2UserCreateBody(email, passwords[who], O2_ROLES[who], who),
      );
  }
}

/**
 * Creates a stream unless it exists (OpenObserve answers 400 then), and sets its retention when
 * given. Alerts need their stream to exist, and metric streams only appear with data (B1).
 */
export async function ensureStream(
  client: O2Client,
  name: string,
  type: StreamType,
  retentionDays?: number,
): Promise<void> {
  await client
    .call(
      "createStream",
      "POST",
      o2Paths.stream(client.org, name, type),
      o2StreamCreateBody(retentionDays),
    )
    .catch((error: unknown) => {
      if (!(error instanceof O2Error) || error.status !== 400) throw error;
    });
  if (retentionDays !== undefined)
    await client.call("streamSettings", "PUT", o2Paths.streamSettings(client.org, name, type), {
      data_retention: retentionDays,
    });
}

/** Logs 30 d, traces 15 d (spec §11); metrics use the global 90 d (ZO_COMPACT_DATA_RETENTION_DAYS). */
export async function provisionStreams(client: O2Client): Promise<void> {
  await ensureStream(client, LOG_STREAMS.app, "logs", RETENTION_DAYS.logs);
  await ensureStream(client, LOG_STREAMS.containers, "logs", RETENTION_DAYS.logs);
  await ensureStream(client, TRACE_STREAM, "traces", RETENTION_DAYS.traces);
}

async function upsert(
  client: O2Client,
  kind: string,
  collection: string,
  item: string,
  body: object,
): Promise<void> {
  try {
    await client.call(`update${kind}`, "PUT", item, body);
  } catch (error) {
    if (!(error instanceof O2Error) || error.status !== 404) throw error;
    await client.call(`create${kind}`, "POST", collection, body);
  }
}

export async function provisionAlertDelivery(
  client: O2Client,
  webhook: { url: string; secret: string },
): Promise<void> {
  await upsert(
    client,
    "Template",
    o2Paths.templates(client.org),
    o2Paths.template(client.org, ALERT_TEMPLATE_NAME),
    { name: ALERT_TEMPLATE_NAME, body: alertTemplateBody(), type: "http", isDefault: false },
  );
  await upsert(
    client,
    "Destination",
    o2Paths.destinations(client.org),
    o2Paths.destination(client.org, ALERT_DESTINATION_NAME),
    {
      name: ALERT_DESTINATION_NAME,
      type: "http",
      url: webhook.url,
      method: "post",
      skip_tls_verify: false,
      template: ALERT_TEMPLATE_NAME,
      headers: { Authorization: `Bearer ${webhook.secret}` },
    },
  );
}
