import {
  APPROVAL_KINDS,
  APPROVAL_MODES,
  BENCHMARK_OUTCOMES,
  BLOCK_TYPES,
  CONTROLLERS,
  OBSERVER_MODES,
  RUN_STATUSES,
  SLOT_STATES,
  STEP_STATES,
  TOOL_PROFILES,
} from "@mastertutor/contracts";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index.ts";

const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[];
const config = (table: PgTable) => getTableConfig(table);
const columns = (table: PgTable) => config(table).columns.map((column) => column.name);

describe("schema", () => {
  it("defines exactly the spec tables plus benchmarks, the object-deletion queue, alerts and the Observer's", () => {
    expect(
      tables.map((table) => `${config(table).schema ?? "public"}.${config(table).name}`).sort(),
    ).toEqual([
      "observer.copilot_items",
      "observer.copilot_results",
      "observer.copilot_spend",
      "observer.copilot_threads",
      "public.account",
      "public.alerts",
      "public.approvals",
      "public.assets",
      "public.benchmark_runs",
      "public.benchmarks",
      "public.browser_sessions",
      "public.browser_slots",
      "public.capture_preferences",
      "public.downloads",
      "public.folders",
      "public.guard_reviews",
      "public.note_blocks",
      "public.notes",
      "public.object_deletions",
      "public.otp_codes",
      "public.push_subscriptions",
      "public.run_events",
      "public.run_steps",
      "public.run_transcript",
      "public.runs",
      "public.session",
      "public.settings",
      "public.sources",
      "public.user",
      "public.vault_audit",
      "public.vault_grants",
      "public.vault_items",
      "public.vault_secrets",
      "public.verification",
      "public.workspace_members",
      "public.workspaces",
    ]);
  });

  it("keeps pg enums in sync with contracts", () => {
    expect(schema.runStatusEnum.enumValues).toEqual([...RUN_STATUSES]);
    expect(schema.toolProfileEnum.enumValues).toEqual([...TOOL_PROFILES]);
    expect(schema.controllerEnum.enumValues).toEqual([...CONTROLLERS]);
    expect(schema.approvalModeEnum.enumValues).toEqual([...APPROVAL_MODES]);
    expect(schema.observerModeEnum.enumValues).toEqual([...OBSERVER_MODES]);
    expect(schema.approvalKindEnum.enumValues).toEqual([...APPROVAL_KINDS]);
    expect(schema.stepStateEnum.enumValues).toEqual([...STEP_STATES]);
    expect(schema.blockTypeEnum.enumValues).toEqual([...BLOCK_TYPES]);
    expect(schema.slotStateEnum.enumValues).toEqual([...SLOT_STATES]);
    expect(schema.benchmarkOutcomeEnum.enumValues).toEqual([...BENCHMARK_OUTCOMES]);
  });

  it("has the run columns the runtime and live view rely on", () => {
    expect(columns(schema.runs)).toEqual(
      expect.arrayContaining([
        "controller",
        "approval_mode",
        "slot_name",
        "lease_owner",
        "lease_expires_at",
        "wake_requested_at",
        "previous_response_id",
        "video_time",
      ]),
    );
    expect(columns(schema.browserSlots)).toEqual(
      expect.arrayContaining([
        "name",
        "state",
        "run_id",
        "lease_owner",
        "lease_expires_at",
        "restarted_at",
      ]),
    );
    expect(columns(schema.benchmarkRuns)).toEqual(
      expect.arrayContaining([
        "outcome",
        "steps",
        "usd",
        "input_tokens",
        "output_tokens",
        "duration_ms",
        "failure_notes",
      ]),
    );
  });

  it("keeps the audit log free of foreign keys", () => {
    expect(config(schema.vaultAudit).foreignKeys).toHaveLength(0);
    expect(
      config(schema.notes).foreignKeys.map((fk) => fk.reference().columns[0]?.name),
    ).not.toContain("run_id");
  });
});
