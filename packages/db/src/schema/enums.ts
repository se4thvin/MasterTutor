import {
  APPROVAL_KINDS,
  APPROVAL_MODES,
  APPROVAL_STATUSES,
  BENCHMARK_OUTCOMES,
  BLOCK_ORIGINS,
  BLOCK_TYPES,
  CONTROLLERS,
  FIDELITIES,
  FILED_BY,
  MEMBER_ROLES,
  RUN_STATUSES,
  SLOT_STATES,
  SOURCE_KINDS,
  STEP_PHASES,
  STEP_STATES,
  TOOL_PROFILES,
  VAULT_AUDIT_ACTIONS,
  VAULT_SECRET_FIELDS,
  WAIT_REASONS,
} from "@mastertutor/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const waitReasonEnum = pgEnum("wait_reason", WAIT_REASONS);
export const controllerEnum = pgEnum("controller", CONTROLLERS);
export const approvalModeEnum = pgEnum("approval_mode", APPROVAL_MODES);
export const stepPhaseEnum = pgEnum("step_phase", STEP_PHASES);
export const stepStateEnum = pgEnum("step_state", STEP_STATES);
export const approvalKindEnum = pgEnum("approval_kind", APPROVAL_KINDS);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUSES);
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS);
export const filedByEnum = pgEnum("filed_by", FILED_BY);
export const fidelityEnum = pgEnum("fidelity", FIDELITIES);
export const blockTypeEnum = pgEnum("block_type", BLOCK_TYPES);
export const blockOriginEnum = pgEnum("block_origin", BLOCK_ORIGINS);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);
export const vaultSecretFieldEnum = pgEnum("vault_secret_field", VAULT_SECRET_FIELDS);
export const vaultAuditActionEnum = pgEnum("vault_audit_action", VAULT_AUDIT_ACTIONS);
export const slotStateEnum = pgEnum("slot_state", SLOT_STATES);
export const benchmarkOutcomeEnum = pgEnum("benchmark_outcome", BENCHMARK_OUTCOMES);
export const toolProfileEnum = pgEnum("tool_profile", TOOL_PROFILES);
