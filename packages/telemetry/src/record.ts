import { metrics } from "@opentelemetry/api";
import {
  SLOT_STATES,
  deciderClass,
  TERMINAL_RUN_STATUSES,
  type AlertRule,
  type RunEvent,
  type SlotState,
} from "@mastertutor/contracts";
import {
  ATTR,
  METER_NAME,
  METRIC,
  type ApprovalDecider,
  type ObserverOutcome,
  type ObserverRole,
  type PushOutcome,
  type SpendPurpose,
} from "@mastertutor/contracts/telemetry";
import { normalizeCode } from "./instrument.ts";
import { instruments } from "./instruments.ts";

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

/** Who decided an approval, as a class (spec §5.2): a user id never becomes telemetry. */
export function deciderOf(decidedBy: string): ApprovalDecider {
  return deciderClass(decidedBy);
}

function safely(record: () => void): void {
  try {
    record();
  } catch {
    // Telemetry never breaks the write it describes (spec §7.1).
  }
}

/** Seam 6: every RunEvent written by emitRunEvent (agent and web). Text fields and user ids are never read. */
export function recordRunEvent(event: RunEvent): void {
  safely(() => {
    const m = instruments();
    switch (event.type) {
      case "status":
        if (TERMINAL.has(event.status)) m.runsEnded.add(1, { [ATTR.runStatus]: event.status });
        return;
      case "error":
        m.runErrors.add(1, { [ATTR.errorCode]: normalizeCode(event.code) });
        return;
      case "approval_requested":
        m.approvalsRequested.add(1, { [ATTR.approvalKind]: event.request.kind });
        return;
      case "approval_resolved":
        m.approvalsResolved.add(1, {
          [ATTR.approvalStatus]: event.status,
          [ATTR.approvalDecider]: deciderOf(event.decidedBy),
        });
        return;
      case "approval_mode_changed":
        m.approvalModeChanges.add(1, { [ATTR.approvalMode]: event.to });
        return;
      case "user_message":
        m.runSends.add(1, {
          [ATTR.sendMode]: event.interrupt === true ? "interrupt" : "queue",
        });
        return;
      case "control":
        m.controlChanges.add(1, { [ATTR.controlHolder]: event.holder });
        return;
      case "slot":
        m.slotLeases.add(1, {
          [ATTR.slotOutcome]: event.slotName === null ? "released" : "leased",
        });
        return;
      case "block_added":
        m.blocksAdded.add(1, {
          [ATTR.blockType]: event.blockType,
          [ATTR.blockOrigin]: event.origin,
        });
        return;
      case "download_pending":
      case "download_ready": {
        const state = event.type === "download_ready" ? "ready" : "pending";
        m.downloads.add(1, { [ATTR.downloadState]: state });
        m.downloadSize.record(event.bytes, { [ATTR.downloadState]: state });
        return;
      }
      case "budget":
        m.budgetHits.add(1);
        return;
      case "model_fallback":
        m.modelFallbacks.add(1, { [ATTR.modelName]: event.to.slice(0, 64) });
        return;
      case "filed":
        m.notesFiled.add(1, { [ATTR.filedBy]: event.filedBy });
        return;
      case "guard":
        m.observerVerdicts.add(1, {
          [ATTR.observerVerdict]: event.verdict,
          [ATTR.observerCategory]: event.category,
          [ATTR.observerRollout]: event.rollout,
        });
        return;
      default:
        return;
    }
  });
}

export function recordRunFailure(code: string): void {
  safely(() => instruments().runFailures.add(1, { [ATTR.errorCode]: normalizeCode(code) }));
}

export function recordSpend(usd: number, purpose: SpendPurpose): void {
  if (!(usd > 0)) return;
  safely(() => instruments().spendUsd.add(usd, { [ATTR.spendPurpose]: purpose }));
}

/** The Observer's own spend by role: a breakdown of mt.spend.usd, never added to it. */
export function recordObserverSpend(role: ObserverRole, usd: number): void {
  if (!(usd > 0)) return;
  safely(() => instruments().observerSpend.add(usd, { [ATTR.observerRole]: role }));
}

export function recordObserverFailure(role: ObserverRole, outcome: ObserverOutcome): void {
  safely(() =>
    instruments().observerFailures.add(1, {
      [ATTR.observerRole]: role,
      [ATTR.observerOutcome]: outcome,
    }),
  );
}

export function recordObserverOverride(): void {
  safely(() => instruments().observerOverrides.add(1));
}

export function recordModelTokens(
  model: string,
  tokens: { input: number; cached: number; output: number },
): void {
  safely(() => {
    const counter = instruments().modelTokens;
    const name = model.slice(0, 64);
    counter.add(tokens.input, { [ATTR.modelName]: name, [ATTR.tokenType]: "input" });
    counter.add(tokens.cached, { [ATTR.modelName]: name, [ATTR.tokenType]: "cached" });
    counter.add(tokens.output, { [ATTR.modelName]: name, [ATTR.tokenType]: "output" });
  });
}

export function recordSseConnection(delta: 1 | -1): void {
  safely(() => instruments().sseConnections.add(delta));
}

export function recordAlertReceived(rule: AlertRule): void {
  safely(() => instruments().alertsReceived.add(1, { [ATTR.alertRule]: rule }));
}

export function recordPush(outcome: PushOutcome): void {
  safely(() => instruments().pushSends.add(1, { [ATTR.pushOutcome]: outcome }));
}

/** Agent gauges (spec §5.3): read on each export (30 s), from the same sources as /healthz. */
export function observeAgentGauges(source: {
  slotStates(): Promise<readonly SlotState[]>;
  activeRuns(): number;
}): void {
  safely(() => {
    const meter = metrics.getMeter(METER_NAME);
    const slots = meter.createObservableGauge(METRIC.slots.name, {
      unit: METRIC.slots.unit,
      description: METRIC.slots.description,
    });
    const active = meter.createObservableGauge(METRIC.activeRuns.name, {
      unit: METRIC.activeRuns.unit,
      description: METRIC.activeRuns.description,
    });
    meter.addBatchObservableCallback(
      async (result) => {
        try {
          result.observe(active, source.activeRuns());
          const counts = new Map<SlotState, number>(SLOT_STATES.map((state) => [state, 0]));
          for (const state of await source.slotStates())
            counts.set(state, (counts.get(state) ?? 0) + 1);
          for (const [state, count] of counts)
            result.observe(slots, count, { [ATTR.slotState]: state });
        } catch {
          // A failed read skips this export's gauges.
        }
      },
      [slots, active],
    );
  });
}
