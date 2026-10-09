import type {
  ApprovalRequest,
  ComputerAction,
  FunctionToolName,
  PolicyDecision,
  RiskLevel,
} from "@mastertutor/contracts";
import type { TargetDescription } from "../../browser/page-helpers.ts";
import type { ProvenanceLabel } from "../provenance.ts";

/**
 * One thing in a model turn the Guard may review: a computer action, a function call, or a
 * run-level request (new origin, download). `target` and `args` stay in the agent: turn.ts copies
 * only flags and codes out of them.
 */
export interface SeenItem {
  /** The loop's item key (actionItem/functionItem/safetyItem), or "run" for a run-level request. */
  item: string;
  callId: string | null;
  index: number | null;
  action: ComputerAction | null;
  tool: FunctionToolName | null;
  args: unknown;
  target: TargetDescription | null;
  /** The request the policy classified, when the item needs approval. */
  request: ApprovalRequest | null;
  /** What the policy decided for that request. */
  policy: PolicyDecision | null;
}

export interface TurnFacts {
  pageOrigin: string | null;
  allowedOrigins: readonly string[];
  actuatedOrigins: ReadonlySet<string>;
  injectionWindow: boolean;
  riskLevel: RiskLevel;
  label(text: string, pageOrigin: string | null): ProvenanceLabel;
}
