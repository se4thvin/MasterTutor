import { randomUUID } from "node:crypto";
import {
  decideByPolicy,
  POLICY_DECIDER,
  type ApprovalRequest,
  type ComputerAction,
  type RunError,
  type RunEvent,
  type Usage,
  type WaitReason,
} from "@mastertutor/contracts";
import type { Database } from "@mastertutor/db";
import { objectKeys, type Storage } from "@mastertutor/storage";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { TargetDescription } from "../browser/page-helpers.ts";
import { budgetExceeded, extendBudget } from "../guardrails/budget.ts";
import { LoopDetector } from "../guardrails/loop-detector.ts";
import { approvalRequestFor, needsApproval } from "../guardrails/policy.ts";
import { wrapUntrusted } from "../guardrails/untrusted.ts";
import type { CallResult as ModelCall, ModelCaller } from "../llm/caller.ts";
import { AGENT_INSTRUCTIONS, NUDGE, goalText } from "../llm/instructions.ts";
import {
  callSignature,
  computerCallOutput,
  describeCall,
  functionCallOutput,
  isFunctionTool,
  parseModelOutput,
  pngDataUrl,
  userMessage,
  type PendingCall,
} from "../llm/items.ts";
import { addUsage, usageDelta } from "../llm/pricing.ts";
import type { Clock } from "../runtime/clock.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import { ChainLost, ContextOverflow, interruptionOf } from "../runtime/errors.ts";
import type { Log } from "../runtime/types.ts";
import {
  actionItem,
  functionItem,
  insertApprovals,
  loadActResult,
  loadApprovalDecision,
  loadPendingApproval,
  loadUserMessages,
  markApprovalSuperseded,
  safetyItem,
  type ApproveStepResult,
  type ItemDecision,
  type PendingApproval,
} from "./approvals.ts";
import {
  INTERRUPTED,
  NOT_STARTED,
  PAGE_CHANGED,
  RESTARTED,
  notRun,
  type CallResult,
} from "./call-result.ts";
import {
  seedFromSummary,
  summarizeChain,
  summarizeTranscript,
  type Compacted,
} from "./compaction.ts";
import type { RunHooks } from "./hooks.ts";
import type { LoopBrowser, Observation } from "./loop-browser.ts";
import { lastInputTokens, readRunControl, type RunSnapshot } from "./run-state.ts";
import type { StepCommit, StepRecord, StepStore, Transition } from "./step-store.ts";
import {
  lastUserEventId,
  loadTranscript,
  recentScreenshotKeys,
  unansweredCalls,
  type TranscriptEntry,
} from "./transcript.ts";

type Phase = "observe" | "decide" | "approve" | "act";

export type StepOutcome =
  | { kind: "continue" }
  | { kind: "waiting"; reason: WaitReason }
  | { kind: "completed" }
  | { kind: "failed"; error: RunError }
  | { kind: "cancelled" };

export interface RunLoopDeps {
  db: Database;
  storage: Storage;
  caller: ModelCaller;
  browser: LoopBrowser;
  store: StepStore;
  hooks: RunHooks;
  clock: Clock;
  config: RuntimeConfig;
  log: Log;
}

/** One thing in a model turn that needs its own approval (security ruling: one approval per risky item). */
interface RiskyItem {
  item: string;
  callId: string;
  /** Action index for computer actions; null for safety checks and function calls. */
  index: number | null;
  request: ApprovalRequest;
}

const CONTINUE: StepOutcome = { kind: "continue" };
const TO_RUNNING: Transition = {
  from: ["waiting", "running"],
  to: "running",
  waitReason: null,
  reason: null,
};
const DENIED = "Not run: the user denied this action.";
const POLICY_BLOCKED = "Blocked by this run's approval policy.";

function splitItem(item: string): { callId: string; part: string } {
  const at = item.lastIndexOf("#");
  return { callId: item.slice(0, at), part: item.slice(at + 1) };
}

/**
 * One run's state machine (spec §5.1, §5.3). Each phase is one run_steps row committed in one
 * transaction. A started act is never retried: a restore re-observes and decides again. Every
 * model call is answered by exactly one output, including refused, blocked and aborted ones.
 */
export class RunLoop {
  readonly #deps: RunLoopDeps;
  readonly #loops = new LoopDetector();
  #run: RunSnapshot;
  #next: Phase = "observe";
  #calls: PendingCall[] = [];
  readonly #results = new Map<string, CallResult>();
  /** Approval decisions for the current turn's risky items, keyed by item. */
  readonly #decided = new Map<string, ItemDecision>();
  #notes: string[] = [];
  #observation: Observation | null = null;
  #screenshotKey: string | null = null;
  #lastInputTokens = 0;
  #firstTurn: boolean;
  #userCursor: string | null;
  #pending: PendingApproval | null = null;
  #notesChanged = false;
  #lastTick: number | null = null;

  private constructor(
    deps: RunLoopDeps,
    run: RunSnapshot,
    firstTurn: boolean,
    userCursor: string | null,
  ) {
    this.#deps = deps;
    this.#run = run;
    this.#firstTurn = firstTurn;
    this.#userCursor = userCursor;
  }

  static async restore(deps: RunLoopDeps, run: RunSnapshot): Promise<RunLoop> {
    const transcript = await loadTranscript(deps.db, run.id);
    const loop = new RunLoop(deps, run, transcript.length === 0, lastUserEventId(transcript));
    loop.#calls = unansweredCalls(transcript);
    loop.#pending = await loadPendingApproval(deps.db, run.id);
    loop.#lastInputTokens = await lastInputTokens(deps.db, run.id);
    // While a risky item waits for approval its calls have not run yet; anything else unanswered
    // either finished (its act row holds the result) or is answered without being re-run.
    const awaitingItem = loop.#pending !== null && loop.#pending.item !== null;
    for (const call of loop.#calls) {
      const done = await loadActResult(deps.db, run.id, call.callId);
      if (done) loop.#results.set(call.callId, done);
      else if (!awaitingItem) loop.#results.set(call.callId, notRun(call, RESTARTED));
    }
    for (const decision of loop.#pending?.decided ?? []) loop.#applyDecision(decision);
    return loop;
  }

  get run(): RunSnapshot {
    return this.#run;
  }

  get hasPendingApproval(): boolean {
    return this.#pending !== null;
  }

  reobserve(): void {
    this.#next = "observe";
    this.#loops.reset();
  }

  /** Waiting time is not active time (budget maxActiveMinutes). */
  markIdle(): void {
    this.#lastTick = null;
  }

  async step(signal: AbortSignal): Promise<StepOutcome> {
    switch (this.#next) {
      case "observe":
        return this.#observe(signal);
      case "decide":
        return this.#decide(signal);
      case "approve":
        return this.#approve();
      case "act":
        return this.#act(signal);
    }
  }

  /* ---------------------------------- helpers ---------------------------------- */

  #tick(): Usage {
    const now = this.#deps.clock.now();
    const elapsed = this.#lastTick === null ? 0 : Math.max(0, Math.round(now - this.#lastTick));
    this.#lastTick = now;
    this.#run = {
      ...this.#run,
      usage: { ...this.#run.usage, activeMs: this.#run.usage.activeMs + elapsed },
    };
    return this.#run.usage;
  }

  #obs(): Observation {
    if (!this.#observation) throw new Error("no observation yet");
    return this.#observation;
  }

  #pageHeader(obs: Observation): string {
    return `Current page: ${wrapUntrusted(obs.origin, `${obs.title}\n${obs.url}`)}`;
  }

  #callById(callId: string): PendingCall | undefined {
    return this.#calls.find((call) => call.callId === callId);
  }

  #allAnswered(): boolean {
    return this.#calls.every((call) => this.#results.has(call.callId));
  }

  /** Answers every call that has no result yet with `text` (never re-runs anything). */
  #answerRest(text: string): void {
    for (const call of this.#calls) {
      if (!this.#results.has(call.callId)) this.#results.set(call.callId, notRun(call, text));
    }
  }

  /**
   * Records a decision for one risky item. A refused function call, safety check or first action
   * means nothing of that call can run, so it is answered now; a refused later action stops its
   * batch at execution time (the actions before it may still run).
   */
  #applyDecision(decision: ItemDecision): void {
    this.#decided.set(decision.item, decision);
    if (decision.approved) return;
    const { callId, part } = splitItem(decision.item);
    const call = this.#callById(callId);
    if (!call || this.#results.has(callId)) return;
    if (part === "fn" || part === "safety" || part === "0")
      this.#results.set(callId, notRun(call, decision.note ?? DENIED));
  }

  /** True when an earlier action of the same batch was refused, so this one can never run. */
  #unreachable(item: RiskyItem): boolean {
    if (item.index === null) return false;
    for (let index = 0; index < item.index; index++) {
      if (this.#decided.get(actionItem(item.callId, index))?.approved === false) return true;
    }
    return false;
  }

  async #wait(
    reason: WaitReason,
    text: string | null,
    commit: StepCommit = {},
  ): Promise<StepOutcome> {
    await this.#deps.store.commit({
      ...commit,
      transition: { from: ["running"], to: "waiting", waitReason: reason, reason: text },
    });
    this.#loops.reset();
    this.markIdle();
    return { kind: "waiting", reason };
  }

  async #capture(
    signal: AbortSignal,
  ): Promise<{ obs: Observation; step: StepRecord; commit: StepCommit }> {
    const seq = this.#deps.store.nextSeq();
    const obs = await this.#deps.browser.observe(signal);
    const previous = this.#observation;
    this.#observation = obs;
    const unchanged =
      previous !== null && previous.url === obs.url && previous.domHash === obs.domHash;
    const key = objectKeys.stepScreenshot(this.#run.id, seq);
    await this.#deps.storage.put(key, obs.screenshot.png, { contentType: "image/png" });
    this.#screenshotKey = key;
    const step: StepRecord = {
      seq,
      phase: "observe",
      state: "done",
      url: obs.url,
      screenshotKey: key,
      caption: obs.screenshot.dropped ? "Screenshot withheld: a secret field moved" : null,
      result: unchanged
        ? { unchanged: true }
        : { url: obs.url, title: obs.title.slice(0, 300), domHash: obs.domHash },
    };
    return {
      obs,
      step,
      commit: {
        steps: [step],
        run: {
          currentUrl: obs.url,
          scroll: obs.scroll,
          videoTime: obs.videoTime,
          usage: this.#tick(),
        },
      },
    };
  }

  /* --------------------------------- observe --------------------------------- */

  async #observe(signal: AbortSignal): Promise<StepOutcome> {
    const { obs, commit } = await this.#capture(signal);
    // Scrolling reveals new content: a new scroll position counts as progress.
    const stuck = this.#loops.recordObservation({
      url: obs.url,
      domHash: `${obs.domHash}@${obs.scroll.x},${obs.scroll.y}`,
      notesChanged: this.#notesChanged,
    });
    this.#notesChanged = false;
    if (obs.captcha) return this.#wait("captcha", "A CAPTCHA needs a person", commit);
    if (stuck) return this.#wait("takeover", "stuck", commit);
    const exceeded = budgetExceeded(this.#run.usage, this.#run.budget);
    await this.#deps.store.commit(commit);
    if (exceeded)
      return this.#ask(
        { kind: "budget", exceeded, usage: this.#run.usage, budget: this.#run.budget },
        { callIds: [], item: null },
      );
    this.#next = "decide";
    return CONTINUE;
  }

  /* --------------------------------- decide ---------------------------------- */

  #buildInput(
    obs: Observation,
    userTexts: readonly string[],
    extra: readonly string[],
  ): ResponseInputItem[] {
    const shot = pngDataUrl(obs.screenshot.png);
    const items: ResponseInputItem[] = [];
    const notes: string[] = [];
    for (const call of this.#calls) {
      const result = this.#results.get(call.callId) ?? notRun(call, NOT_STARTED);
      if (call.kind === "computer") {
        items.push(
          computerCallOutput(
            call.callId,
            shot,
            result.kind === "computer" ? result.acknowledged : [],
          ),
        );
        if (result.kind === "computer")
          notes.push(...result.notes.map((note) => `Executor: ${note}`));
      } else {
        items.push(
          functionCallOutput(call.callId, result.kind === "function" ? result.output : "{}"),
        );
      }
    }
    const texts = [
      ...(this.#firstTurn ? [goalText(this.#run, extra)] : []),
      ...notes,
      ...this.#notes,
      ...userTexts.map((text) => `Message from the user: ${text}`),
      this.#pageHeader(obs),
    ];
    const needsImage = this.#firstTurn || !this.#calls.some((call) => call.kind === "computer");
    items.push(userMessage(texts, needsImage ? shot : null));
    return items;
  }

  async #decide(signal: AbortSignal): Promise<StepOutcome> {
    const { db, caller, storage, hooks, config } = this.#deps;
    const runId = this.#run.id;
    const obs = this.#obs();
    const messages = await loadUserMessages(db, runId, this.#userCursor);
    const cursor = messages.at(-1)?.id ?? this.#userCursor;
    const extra = this.#firstTurn ? await hooks.promptContext(this.#run) : [];
    let input = this.#buildInput(
      obs,
      messages.map((message) => message.text),
      extra,
    );
    let previous = this.#run.previousResponseId;
    const transcript: TranscriptEntry[] = [];
    const deltas: Usage[] = [];
    const record = (dir: "in" | "out", items: readonly unknown[], responseId: string | null) => {
      for (const item of items)
        transcript.push({
          dir,
          item: item as Record<string, unknown>,
          responseId,
          userEventId: dir === "in" ? cursor : null,
        });
    };
    const compactionDeps = {
      caller,
      model: this.#run.model,
      instructions: AGENT_INSTRUCTIONS,
      signal,
    };
    const reseed = async (compacted: Compacted) => {
      record("in", compacted.input, null);
      record("out", compacted.call.reply.output, compacted.call.reply.id);
      deltas.push(usageDelta(compacted.call.model, compacted.call.reply.usage, 0));
      // Only this run's own transcript screenshots are rehydrated (Group D: resolveGarageRef).
      const keys = recentScreenshotKeys(await loadTranscript(db, runId), runId, 2);
      return seedFromSummary(storage, compacted.summary, keys, {
        pageText: this.#pageHeader(obs),
        screenshot: pngDataUrl(obs.screenshot.png),
      });
    };
    /** Rebuild from run_transcript: the chain is gone or too long to summarize through. */
    const rebuild = async () =>
      reseed(
        await summarizeTranscript(
          compactionDeps,
          await loadTranscript(db, runId),
          this.#run.goal,
          input,
        ),
      );
    const recoverable = (error: unknown) =>
      error instanceof ChainLost || error instanceof ContextOverflow;
    if (previous !== null && this.#lastInputTokens > config.compactionInputTokens) {
      try {
        input = await reseed(await summarizeChain(compactionDeps, previous, input));
      } catch (error) {
        if (!recoverable(error)) throw error;
        input = await rebuild();
      }
      previous = null;
    }
    const request = () => ({
      model: this.#run.model,
      instructions: AGENT_INSTRUCTIONS,
      input,
      previousResponseId: previous,
      format: "agent_turn" as const,
      withTools: true,
    });
    let call: ModelCall;
    try {
      call = await caller.call(request(), signal);
    } catch (error) {
      // ChainLost → rebuild from run_transcript; ContextOverflow → compact now (once).
      if (!recoverable(error)) throw error;
      input = await rebuild();
      previous = null;
      call = await caller.call(request(), signal);
    }
    record("in", input, null);
    record("out", call.reply.output, call.reply.id);
    const parsed = parseModelOutput(call.reply.output);
    const delta = usageDelta(call.model, call.reply.usage);
    deltas.push(delta);
    this.#lastInputTokens = call.reply.usage.input;
    this.#run = {
      ...this.#run,
      model: call.model,
      previousResponseId: call.reply.id,
      plan: parsed.turn?.planUpdate ?? this.#run.plan,
      usage: deltas.reduce(addUsage, this.#run.usage),
    };
    const usage = this.#tick();
    const display = parsed.calls[0] ? describeCall(parsed.calls[0], obs.screenshot.scale) : null;
    const events: RunEvent[] = [{ type: "budget", usage, budget: this.#run.budget }];
    if (call.fallback)
      events.unshift({ type: "model_fallback", from: call.fallback.from, to: call.fallback.to });
    await this.#deps.store.commit({
      steps: [
        {
          seq: this.#deps.store.nextSeq(),
          phase: "decide",
          state: "done",
          caption: parsed.turn?.reason.slice(0, 300) ?? display?.summary ?? null,
          action: display,
          result: { status: parsed.turn?.status ?? null, calls: parsed.calls.length },
          usage: delta,
        },
      ],
      transcript,
      run: {
        previousResponseId: call.reply.id,
        plan: this.#run.plan,
        usage,
        model: call.model,
      },
      events,
    });
    this.#userCursor = cursor;
    this.#firstTurn = false;
    this.#notes = [];
    this.#results.clear();
    this.#decided.clear();
    this.#calls = parsed.calls;
    if (this.#calls.length > 0) {
      this.#next = "approve";
      return CONTINUE;
    }
    const turn = parsed.turn;
    if (turn?.status === "done") return this.#complete();
    if (turn?.status === "need_human")
      return this.#wait(
        turn.needHuman === "captcha" ? "captcha" : "takeover",
        turn.reason.slice(0, 500) || "The agent needs a person",
      );
    this.#notes.push(NUDGE);
    this.#next = "observe";
    return CONTINUE;
  }

  /* --------------------------------- approve --------------------------------- */

  /** Every risky item of the unanswered calls, classified in code (spec §5.5). */
  async #riskyItems(url: string): Promise<RiskyItem[]> {
    const items: RiskyItem[] = [];
    for (const call of this.#calls) {
      if (this.#results.has(call.callId)) continue;
      if (call.kind === "function") {
        const request = await this.#deps.hooks.functionApproval(
          { name: call.name, args: call.args },
          this.#run,
          url,
        );
        if (request)
          items.push({
            item: functionItem(call.callId),
            callId: call.callId,
            index: null,
            request,
          });
        continue;
      }
      let previous: TargetDescription | null = null;
      for (const [index, action] of call.actions.entries()) {
        const target = await this.#deps.browser.targetFor(action, previous);
        if (action.type === "click" || action.type === "double_click") previous = target;
        const need = needsApproval(action, target);
        if (need)
          items.push({
            item: actionItem(call.callId, index),
            callId: call.callId,
            index,
            request: approvalRequestFor(need, url, this.#screenshotKey),
          });
      }
      if (call.safetyChecks.length > 0) {
        const label = `Safety check: ${call.safetyChecks.map((check) => check.message ?? check.code ?? check.id).join("; ")}`;
        items.push({
          item: safetyItem(call.callId),
          callId: call.callId,
          index: null,
          request: {
            kind: "risky_click",
            action: call.actions[0] ?? { type: "screenshot" },
            label: label.slice(0, 500),
            url: url.slice(0, 4_096),
            screenshotKey: this.#screenshotKey,
          },
        });
      }
    }
    return items;
  }

  /**
   * Asks for (or decides by policy) one approval per risky item. In ask mode the run waits for the
   * first undecided item; after its decision the loop comes back here for the next one.
   */
  async #approve(): Promise<StepOutcome> {
    for (const call of this.#calls) {
      if (call.invalid !== null && !this.#results.has(call.callId))
        this.#results.set(call.callId, notRun(call, `Invalid call: ${call.invalid}.`));
    }
    const items = (await this.#riskyItems(this.#obs().url)).filter(
      (item) => !this.#decided.has(item.item) && !this.#unreachable(item),
    );
    if (items.length === 0) {
      if (this.#decided.size === 0)
        await this.#deps.store.commit({
          steps: [{ seq: this.#deps.store.nextSeq(), phase: "approve", state: "skipped" }],
        });
      this.#next = "act";
      return CONTINUE;
    }
    const rows: Array<{ id: string; request: ApprovalRequest; status: "approved" | "denied" }> = [];
    let ask: RiskyItem | null = null;
    for (const item of items) {
      if (this.#results.has(item.callId) || this.#unreachable(item)) continue;
      const decision = decideByPolicy(this.#run.approvalMode, item.request.kind);
      if (decision === "ask") {
        ask ??= item;
        continue;
      }
      rows.push({ id: randomUUID(), request: item.request, status: decision });
      this.#applyDecision({
        item: item.item,
        approved: decision === "approved",
        note: decision === "denied" ? POLICY_BLOCKED : null,
      });
    }
    if (rows.length > 0) {
      const seq = this.#deps.store.nextSeq();
      await this.#deps.store.commit({
        steps: [
          {
            seq,
            phase: "approve",
            state: "done",
            result: { policy: rows.map((row) => row.status) },
          },
        ],
        events: rows.flatMap((row): RunEvent[] => [
          { type: "approval_requested", approvalId: row.id, request: row.request },
          {
            type: "approval_resolved",
            approvalId: row.id,
            status: row.status,
            decidedBy: POLICY_DECIDER,
          },
        ]),
        extra: (tx) => insertApprovals(tx, this.#run.id, seq, rows, POLICY_DECIDER),
      });
    }
    if (ask) return this.#ask(ask.request, { callIds: [ask.callId], item: ask.item });
    this.#next = "act";
    return CONTINUE;
  }

  async #ask(
    request: ApprovalRequest,
    scope: { callIds: string[]; item: string | null },
  ): Promise<StepOutcome> {
    const obs = this.#obs();
    const seq = this.#deps.store.nextSeq();
    const approvalId = randomUUID();
    const result: ApproveStepResult = {
      approvalId,
      callIds: scope.callIds,
      item: scope.item,
      url: obs.url,
      domHash: obs.domHash,
      decided: [...this.#decided.values()],
    };
    await this.#deps.store.commit({
      steps: [{ seq, phase: "approve", state: "started", result }],
      transition: {
        from: ["running"],
        to: "waiting",
        waitReason: "approval",
        reason: request.kind,
      },
      events: [{ type: "approval_requested", approvalId, request }],
      extra: (tx) =>
        insertApprovals(
          tx,
          this.#run.id,
          seq,
          [{ id: approvalId, request, status: "pending" }],
          null,
        ),
    });
    this.#pending = { ...result, stepSeq: seq, request };
    this.markIdle();
    return { kind: "waiting", reason: "approval" };
  }

  async #recordPolicy(request: ApprovalRequest, status: "approved" | "denied"): Promise<void> {
    const seq = this.#deps.store.nextSeq();
    const id = randomUUID();
    await this.#deps.store.commit({
      steps: [{ seq, phase: "approve", state: "done", result: { policy: [status] } }],
      events: [
        { type: "approval_requested", approvalId: id, request },
        { type: "approval_resolved", approvalId: id, status, decidedBy: POLICY_DECIDER },
      ],
      extra: (tx) =>
        insertApprovals(tx, this.#run.id, seq, [{ id, request, status }], POLICY_DECIDER),
    });
  }

  /* ----------------------------------- act ----------------------------------- */

  /**
   * Runs one call. Every action of a batch is re-gated at execution time except the ones the user
   * (or policy) explicitly approved; a refused one stops the batch (Review Focus 3).
   */
  async #execute(
    call: PendingCall,
    signal: AbortSignal,
  ): Promise<{ result: CallResult; ran: boolean }> {
    if (call.kind === "computer") {
      const refusals: string[] = [];
      let index = -1;
      const gate = async (action: ComputerAction) => {
        index += 1;
        const decision = this.#decided.get(actionItem(call.callId, index));
        if (decision) {
          if (!decision.approved)
            refusals.push(`Action ${index + 1} (${action.type}): ${decision.note ?? DENIED}`);
          return decision.approved;
        }
        return needsApproval(action, await this.#deps.browser.targetFor(action, null)) === null;
      };
      const run = await this.#deps.browser.runComputer(call.actions, signal, gate);
      const acknowledged = this.#decided.get(safetyItem(call.callId))?.approved
        ? call.safetyChecks
        : [];
      return {
        result: { kind: "computer", notes: [...run.notes, ...refusals], acknowledged },
        ran: run.executed > 0,
      };
    }
    if (!isFunctionTool(call.name)) return { result: notRun(call, "Unknown tool."), ran: false };
    const run = await this.#deps.browser.runFunction(call.name, call.args, signal);
    if (run.notesChanged) this.#notesChanged = true;
    return { result: { kind: "function", output: run.output }, ran: true };
  }

  async #act(signal: AbortSignal): Promise<StepOutcome> {
    const { store, browser } = this.#deps;
    const obs = this.#obs();
    let ran = false;
    for (const call of this.#calls) {
      if (this.#results.has(call.callId)) continue;
      const seq = store.nextSeq();
      const action = {
        ...(describeCall(call, obs.screenshot.scale) ?? {
          tool: "computer" as const,
          summary: "action",
          point: null,
        }),
        callId: call.callId,
      };
      await store.commit({ steps: [{ seq, phase: "act", state: "started", action }] });
      let executed: { result: CallResult; ran: boolean };
      try {
        executed = await this.#execute(call, signal);
      } catch (error) {
        if (interruptionOf(error) === null && !signal.aborted) throw error;
        this.#results.set(call.callId, notRun(call, INTERRUPTED));
        this.#answerRest(NOT_STARTED);
        await store
          .commit({ steps: [{ seq, phase: "act", state: "aborted", action }] })
          .catch(() => undefined);
        throw error;
      }
      ran ||= executed.ran;
      this.#results.set(call.callId, executed.result);
      const storage = await browser.collectStorage().catch(() => null);
      await store.commit({
        steps: [{ seq, phase: "act", state: "done", action, result: executed.result }],
        storage,
      });
    }
    this.#next = "observe";
    const blocked = browser.drainBlockedNavigations()[0];
    if (blocked) {
      const request: ApprovalRequest = {
        kind: "new_origin",
        origin: blocked.origin,
        url: blocked.url.slice(0, 4_096),
      };
      const decision = decideByPolicy(this.#run.approvalMode, "new_origin");
      if (decision === "ask") return this.#ask(request, { callIds: [], item: null });
      await this.#recordPolicy(request, decision);
      if (decision === "denied")
        this.#notes.push(
          `Executor: navigation to ${blocked.origin} was blocked: it is not one of this run's allowed origins.`,
        );
    }
    // The page position is part of the signature: scrolling down a long page is not a loop.
    const signature = `${this.#calls.map(callSignature).join("|")}@${obs.url}#${obs.scroll.x},${obs.scroll.y}`;
    if (ran && this.#loops.recordAction(signature, obs.phash))
      return this.#wait("takeover", "stuck");
    return CONTINUE;
  }

  /* --------------------------------- endings --------------------------------- */

  async #complete(): Promise<StepOutcome> {
    const result = await this.#deps.hooks.onComplete({ run: this.#run, log: this.#deps.log });
    if (!result.ok) {
      this.#notes.push(`Executor: the run cannot finish yet: ${result.reason}`);
      this.#next = "observe";
      return CONTINUE;
    }
    await this.#deps.store.commit({
      transition: { from: ["running"], to: "completed", waitReason: null, reason: null },
    });
    return { kind: "completed" };
  }

  /* ------------------------------ waits and control ------------------------------ */

  /** Called after a wake (or a restore with a pending approval). Never replays blindly (spec §5.4). */
  async resume(signal: AbortSignal): Promise<StepOutcome> {
    this.#loops.reset();
    const pending = this.#pending;
    if (!pending) {
      await this.#deps.store.commit({ transition: TO_RUNNING });
      this.reobserve();
      return CONTINUE;
    }
    const decision = await loadApprovalDecision(this.#deps.db, pending.approvalId);
    if (!decision || decision.status === "pending") {
      const control = await readRunControl(this.#deps.db, this.#run.id);
      if (control?.status === "running") {
        await this.#deps.store.commit({
          transition: {
            from: ["running"],
            to: "waiting",
            waitReason: "approval",
            reason: pending.request.kind,
          },
        });
      }
      return { kind: "waiting", reason: "approval" };
    }
    const { obs, step } = await this.#capture(signal);
    this.#pending = null;
    const instruction = decision.edit?.instruction ?? null;
    const approved = decision.status === "approved" || decision.status === "edited";
    const approveStep = (state: "done" | "skipped"): StepRecord => ({
      seq: pending.stepSeq,
      phase: "approve",
      state,
      result: pending,
    });
    const base = {
      run: {
        currentUrl: obs.url,
        scroll: obs.scroll,
        videoTime: obs.videoTime,
        usage: this.#tick(),
      },
    };
    const request = pending.request;

    if (request.kind === "budget") {
      if (!approved) {
        await this.#deps.store.commit({
          ...base,
          steps: [step, approveStep("skipped")],
          transition: {
            from: ["waiting", "running"],
            to: "cancelled",
            waitReason: null,
            reason: "budget",
            error: null,
          },
        });
        return { kind: "cancelled" };
      }
      if (decision.edit?.budgetChoice === "finish_now") {
        await this.#deps.store.commit({
          ...base,
          steps: [step, approveStep("done")],
          transition: TO_RUNNING,
        });
        return this.#complete();
      }
      this.#run = { ...this.#run, budget: extendBudget(this.#run.budget) };
      if (instruction) this.#notes.push(`Message from the user: ${instruction}`);
      await this.#deps.store.commit({
        steps: [step, approveStep("done")],
        transition: TO_RUNNING,
        run: { ...base.run, budget: this.#run.budget },
        events: [{ type: "budget", usage: this.#run.usage, budget: this.#run.budget }],
      });
      this.#next = "decide";
      return CONTINUE;
    }

    if (request.kind === "new_origin") {
      if (approved)
        this.#run = {
          ...this.#run,
          allowedOrigins: [...new Set([...this.#run.allowedOrigins, request.origin])],
        };
      await this.#deps.store.commit({
        steps: [step, approveStep(approved ? "done" : "skipped")],
        transition: TO_RUNNING,
        run: { ...base.run, allowedOrigins: this.#run.allowedOrigins },
      });
      if (approved) {
        await this.#deps.browser.navigate(request.url, signal);
        this.#notes.push(`Executor: the user allowed ${request.origin}; it is now open.`);
        this.reobserve();
      } else {
        this.#notes.push(`Executor: the user did not allow opening ${request.origin}.`);
        this.#next = "decide";
      }
      return CONTINUE;
    }

    if (obs.url !== pending.url || obs.domHash !== pending.domHash) {
      this.#answerRest(PAGE_CHANGED);
      await this.#deps.store.commit({
        ...base,
        steps: [step, approveStep("skipped")],
        transition: TO_RUNNING,
        events: [
          {
            type: "approval_resolved",
            approvalId: pending.approvalId,
            status: "superseded",
            decidedBy: "agent",
          },
        ],
        extra: (tx) => markApprovalSuperseded(tx, pending.approvalId),
      });
      this.#next = "decide";
      return CONTINUE;
    }
    if (pending.item !== null) {
      this.#applyDecision({
        item: pending.item,
        approved: decision.status === "approved",
        note:
          decision.status === "approved"
            ? null
            : decision.status === "edited" && instruction
              ? `Not run. The user said instead: ${instruction}`
              : DENIED,
      });
    }
    await this.#deps.store.commit({
      ...base,
      steps: [step, approveStep(decision.status === "approved" ? "done" : "skipped")],
      transition: TO_RUNNING,
    });
    // Back to approve: any other risky item of this turn still needs its own decision.
    this.#next = this.#allAnswered() ? "decide" : "approve";
    return CONTINUE;
  }

  /** The user took control (spec §10.3). A pending approval is superseded; the agent emits control{user}. */
  async markTakeover(): Promise<void> {
    const events: RunEvent[] = [];
    const steps: StepRecord[] = [];
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      for (const callId of pending.callIds) {
        const call = this.#callById(callId);
        if (call && !this.#results.has(callId))
          this.#results.set(
            callId,
            notRun(call, "Not run: the user took control before approving."),
          );
      }
      steps.push({ seq: pending.stepSeq, phase: "approve", state: "skipped", result: pending });
      events.push({
        type: "approval_resolved",
        approvalId: pending.approvalId,
        status: "superseded",
        decidedBy: "agent",
      });
    }
    events.push({ type: "control", holder: "user" });
    const control = await readRunControl(this.#deps.db, this.#run.id);
    await this.#deps.store.commit({
      steps,
      events,
      ...(pending ? { extra: (tx) => markApprovalSuperseded(tx, pending.approvalId) } : {}),
      ...(control?.status === "running"
        ? {
            transition: {
              from: ["running"],
              to: "waiting",
              waitReason: "takeover",
              reason: "user",
            } as Transition,
          }
        : {}),
    });
    this.markIdle();
  }

  async markHandBack(): Promise<void> {
    await this.#deps.store.commit({
      events: [{ type: "control", holder: "agent" }],
      transition: TO_RUNNING,
    });
    this.reobserve();
  }
}
