import { randomUUID } from "node:crypto";
import {
  decideByPolicy,
  decideSafetyChecks,
  AGENT_DECIDER,
  POLICY_DECIDER,
  isPersonDecider,
  policyDecider,
  type ApprovalRequest,
  type ComputerAction,
  type RunError,
  type RunEvent,
  type Usage,
  type WaitReason,
  WAITS_KEPT_THROUGH_TAKEOVER,
  wrapUntrusted,
  type CallResult,
} from "@mastertutor/contracts";
import { ATTR, SPAN } from "@mastertutor/contracts/telemetry";
import { emitRunEvent, returnControlToAgent, type Database } from "@mastertutor/db";
import { instrument } from "@mastertutor/telemetry/instrument";
import type { Storage } from "@mastertutor/storage";
import type { ResponseInputItem } from "../llm/openai.ts";
import { inRunScope } from "../browser/navigation-scope.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import { budgetExceeded, extendBudget } from "../guardrails/budget.ts";
import { LoopDetector } from "../guardrails/loop-detector.ts";
import {
  approvalExcerpt,
  approvalRequestFor,
  downloadRequest,
  downloadUrlForCard,
  needsApproval,
  type ApprovalNeed,
} from "../guardrails/policy.ts";
import { UNGUARDED_CLICK_REFUSAL, UNRESPONSIVE_REFUSAL } from "../tools/computer.ts";
import type { CallApproval } from "../tools/types.ts";
import type { CallResult as ModelCall, ModelCaller } from "../llm/caller.ts";
import { NUDGE, agentInstructions, goalText } from "../llm/instructions.ts";
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
import type { RunTitle, RunTitler } from "../llm/run-title.ts";
import type { Clock } from "../runtime/clock.ts";
import type { RuntimeConfig } from "../runtime/config.ts";
import { ContextOverflow, ControlHeld, Interrupted, interruptionOf } from "../runtime/errors.ts";
import type { Log } from "../runtime/types.ts";
import {
  actionItem,
  functionItem,
  insertApprovals,
  loadActResult,
  hasUnusedOtpCode,
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
  HANDED_OVER,
  INTERRUPTED,
  NOT_STARTED,
  OTP_PENDING,
  PAGE_CHANGED,
  RESTARTED,
  notRun,
} from "./call-result.ts";
import {
  seedFromSummary,
  summarizeContext,
  summarizeTranscript,
  type Compacted,
} from "./compaction.ts";
import type { RunHooks } from "./hooks.ts";
import type { LoopBrowser, Observation } from "./loop-browser.ts";
import { buildModelInput, rehydrateImages } from "./model-input.ts";
import {
  lastInputTokens,
  readRunControl,
  readWakeRequest,
  signInNeeded,
  signInPausedOrigins,
  storeRunTitle,
  type RunSnapshot,
} from "./run-state.ts";
import type { StepCommit, StepRecord, StepStore, Transition } from "./step-store.ts";
import { StepCollector } from "./step-collector.ts";
import {
  GARAGE_REF,
  lastUserEventId,
  loadTranscript,
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
  /** True once the worker's local lease deadline has passed: no model call after it (I2). */
  leaseExpired?: () => boolean;
  /** Generates the run's title off the step path; without it the fallback title stays. */
  titler?: RunTitler;
}

/** What running one call did: its result, and whether the run must wait for the user. */
interface Executed {
  result: CallResult;
  ran: boolean;
  /** A function tool answered with an error: its staged step writes are discarded. */
  failed: boolean;
  wait: "otp" | null;
  /** The executor handed the page to the user (the reason to show): the run waits for a takeover. */
  handOver: string | null;
}

/** One thing in a model turn that needs its own approval (security ruling: one approval per risky item). */
interface RiskyItem {
  item: string;
  callId: string;
  /** Action index for computer actions; null for safety checks and function calls. */
  index: number | null;
  request: ApprovalRequest;
  /** The model's pending_safety_checks: decided by decideSafetyChecks, never by AUTO_MODE_DECISIONS. */
  safetyChecks: ReadonlyArray<{ code: string | null }> | null;
  /** The element the action hits (TargetDescription.path), bound into the approval. */
  target: string | null;
  /** That element's record context digest (TargetDescription.context), bound too (R29-3). */
  context: string | null;
}

const CONTINUE: StepOutcome = { kind: "continue" };
const TO_RUNNING: Transition = {
  from: ["waiting", "running"],
  to: "running",
  waitReason: null,
  reason: null,
};
const DENIED = "Not run: the user denied this action.";
const TAKEOVER_FAILED =
  "Taking control needs the live view to be open and connected. Open it, then try again.";
/** Refusals that only a person's approval can lift (the page could not be guarded). */
const UNGUARDED_REFUSALS: readonly string[] = [UNGUARDED_CLICK_REFUSAL, UNRESPONSIVE_REFUSAL];
const downloadBlockedNote = (url: string) =>
  `Executor: a download of ${downloadUrlForCard(url)} was blocked: nothing was saved. Downloads need the user's approval.`;
/** Waits a takeover leaves on the row (M7): hand-back re-observes whether they still hold. */
const KEPT_THROUGH_TAKEOVER: ReadonlyArray<WaitReason | null> = [
  "takeover",
  ...WAITS_KEPT_THROUGH_TAKEOVER,
];
const POLICY_BLOCKED = "Blocked by this run's approval policy.";

/** What an approval was for; an approved action only runs while its target still classifies the same. */
function riskOf(request: ApprovalRequest): { kind: string | null; label: string | null } {
  if (request.kind === "risky_click") return { kind: request.kind, label: request.label };
  if (request.kind === "form_submit") return { kind: request.kind, label: request.formSummary };
  // The destination the card showed: the fill runs only while the form still posts there.
  if (request.kind === "credential_first_use")
    return { kind: request.kind, label: request.postsTo ?? null };
  if (request.kind === "download") return { kind: request.kind, label: request.url };
  return { kind: request.kind, label: null };
}

function needLabel(need: ApprovalNeed): string {
  if (need.kind === "download") return downloadUrlForCard(need.url);
  return need.kind === "risky_click" ? need.label.slice(0, 500) : need.formSummary.slice(0, 1_000);
}

const TARGET_CHANGED =
  "Not run: the page changed after approval; this action now targets something else. Look at the screen and ask again.";

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
  /** Origins this run already paused on for a sign-in (at most once each). */
  #signInPaused = new Set<string>();
  #firstTurn: boolean;
  #userCursor: string | null;
  #pending: PendingApproval | null = null;
  #notesChanged = false;
  /** Approved download cards, let through at the start of the next act (the model repeats it). */
  #downloadAllowances: Array<{ url: string; filename: string | null; approvedBy: string }> = [];
  /** A click was refused for an unguarded page: the next approvals go to a person (m10). */
  #personNext = false;
  #lastTick: number | null = null;
  /** run_transcript as stored, loaded once and appended after each commit (M5). */
  #history: TranscriptEntry[] = [];
  /** Recent screenshots as data URLs, by storage key, so a request never re-reads them (M5). */
  readonly #images = new Map<string, string>();
  /** A generated title that arrived and waits for the next step boundary to be committed. */
  #title: RunTitle | null = null;

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
    loop.#history = transcript;
    loop.#calls = unansweredCalls(transcript);
    loop.#pending = await loadPendingApproval(deps.db, run.id);
    loop.#lastInputTokens = await lastInputTokens(deps.db, run.id);
    loop.#signInPaused = await signInPausedOrigins(deps.db, run.id);
    // While a risky item waits for approval its calls have not run yet; anything else unanswered
    // either finished (its act row holds the result) or is answered without being re-run.
    const awaitingItem = loop.#pending !== null && loop.#pending.item !== null;
    for (const call of loop.#calls) {
      const done = await loadActResult(deps.db, run.id, call.callId);
      if (done) loop.#results.set(call.callId, done);
      else if (!awaitingItem) loop.#results.set(call.callId, notRun(call, RESTARTED));
    }
    for (const decision of loop.#pending?.decided ?? []) loop.#applyDecision(decision);
    if (run.title === null) loop.#requestTitle();
    return loop;
  }

  get run(): RunSnapshot {
    return this.#run;
  }

  get hasPendingApproval(): boolean {
    return this.#pending !== null;
  }

  /**
   * Whether a wake brought something only a person can supply: a decided approval, a new user
   * message, or (while waiting for a code) a submitted one-time code. A stale wake does not end a
   * wait (I1).
   */
  async hasNews(waitReason: WaitReason | null = null): Promise<boolean> {
    const pending = this.#pending;
    if (pending) {
      const decision = await loadApprovalDecision(this.#deps.db, pending.approvalId);
      if (decision && decision.status !== "pending") return true;
    }
    if (waitReason === "otp" && (await hasUnusedOtpCode(this.#deps.db, this.#run.id))) return true;
    return (await loadUserMessages(this.#deps.db, this.#run.id, this.#userCursor)).length > 0;
  }

  reobserve(): void {
    this.#next = "observe";
    this.#loops.reset();
  }

  /** Waiting time is not active time (budget maxActiveMinutes). */
  markIdle(): void {
    this.#lastTick = null;
  }

  /** Seam 1 (spec §7.3): each phase is one mt.step span, the root of its trace (spec §7.2). */
  async step(signal: AbortSignal): Promise<StepOutcome> {
    if (this.#title) await this.#commitTitle(this.#title);
    const phase = this.#next;
    return instrument(
      SPAN.step,
      { [ATTR.runId]: this.#run.id, [ATTR.stepPhase]: phase },
      async (span) => {
        const outcome = await this.#phase(phase, signal);
        span.set({ [ATTR.stepOutcome]: outcome.kind });
        if (outcome.kind === "failed") span.fail(outcome.error.code);
        return outcome;
      },
      { expected: interruptionOf },
    );
  }

  #phase(phase: Phase, signal: AbortSignal): Promise<StepOutcome> {
    switch (phase) {
      case "observe":
        return this.#observe(signal);
      case "decide":
        return this.#decide(signal);
      case "approve":
        return this.#approve(signal);
      case "act":
        return this.#act(signal);
    }
  }

  /* ---------------------------------- helpers ---------------------------------- */

  /**
   * Asks for the title in parallel with the run, never on its path: the run starts under the
   * fallback title, and a failure or timeout leaves that in place (logged, never retried here).
   */
  #requestTitle(): void {
    const titler = this.#deps.titler;
    if (!titler) return;
    void titler.generate(this.#run).then(
      (title) => {
        this.#title = title;
      },
      (error: unknown) =>
        this.#deps.log.warn(
          { runId: this.#run.id, errName: error instanceof Error ? error.name : "unknown" },
          "run title failed; the fallback title stays",
        ),
    );
  }

  /** At a step boundary: the title is written once and its cost joins the run's usage and budget. */
  async #commitTitle(title: RunTitle): Promise<void> {
    this.#title = null;
    this.#run = {
      ...this.#run,
      title: title.title,
      usage: addUsage(this.#run.usage, title.usage),
    };
    await this.#deps.store.commit({
      run: { usage: this.#run.usage },
      extra: (tx) => storeRunTitle(tx, this.#run.id, title.title),
    });
  }

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
    const header = `Current page: ${wrapUntrusted(obs.origin, `${obs.title}\n${obs.url}`)}`;
    // A black frame alone would look like a blank page: the model is told it was withheld (I-1).
    return obs.screenshot.withheld
      ? `${header}\nScreenshot withheld: ${obs.screenshot.withheld}.`
      : header;
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
    // Uploaded once, by the commit that records the step; the model input refers to the same object.
    const key = this.#deps.store.screenshotKey(seq);
    this.#images.set(key, pngDataUrl(obs.screenshot.png));
    this.#screenshotKey = key;
    const step: StepRecord = {
      seq,
      phase: "observe",
      state: "done",
      url: obs.url,
      screenshotKey: key,
      screenshot: obs.screenshot.png,
      caption: obs.screenshot.withheld ? `Screenshot withheld: ${obs.screenshot.withheld}` : null,
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

  /**
   * A page on the same site as an allowed origin (D51 rule 2) is reached without asking; its
   * origin joins the run's allowed origins with this observation, so the vault, saved sessions
   * and the prompt know it. Origins a sign-in flow passed through are never kept.
   */
  #keepSameSiteOrigin(origin: string | null, commit: StepCommit): StepCommit {
    const allowed = this.#run.allowedOrigins;
    if (origin === null || allowed.includes(origin) || !inRunScope(origin, allowed)) return commit;
    this.#run = { ...this.#run, allowedOrigins: [...allowed, origin] };
    return { ...commit, run: { ...commit.run, allowedOrigins: this.#run.allowedOrigins } };
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
    // Missing data, not an approval: every approval mode pauses. Once per origin per run: a person
    // who resumes without adding a sign-in lets the agent go on signed out there (the executor
    // still refuses typing into secret fields).
    if (
      obs.signIn &&
      obs.origin !== null &&
      !this.#signInPaused.has(obs.origin) &&
      !(await this.#deps.hooks.hasSignIn(this.#run, obs.origin))
    ) {
      this.#signInPaused.add(obs.origin);
      return this.#wait("takeover", signInNeeded(obs.origin), commit);
    }
    if (stuck) return this.#wait("takeover", "stuck", commit);
    const exceeded = budgetExceeded(this.#run.usage, this.#run.budget);
    await this.#deps.store.commit(this.#keepSameSiteOrigin(obs.origin, commit));
    const blocked = await this.#blockedNavigations(signal, { wait: null, handOver: null });
    if (blocked) return blocked;
    if (exceeded)
      return this.#ask(
        { kind: "budget", exceeded, usage: this.#run.usage, budget: this.#run.budget },
        { callIds: [], item: null },
      );
    this.#next = "decide";
    return CONTINUE;
  }

  /* --------------------------------- decide ---------------------------------- */

  /** This turn's input items, and the texts a compaction must carry verbatim (M7, carry-over c). */
  #buildInput(
    obs: Observation,
    userTexts: readonly string[],
    extra: readonly string[],
  ): { items: ResponseInputItem[]; carried: string[] } {
    const shot = `${GARAGE_REF}${this.#screenshotKey}`;
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
      ...userTexts,
      this.#pageHeader(obs),
    ];
    const needsImage = this.#firstTurn || !this.#calls.some((call) => call.kind === "computer");
    items.push(userMessage(texts, needsImage ? shot : null));
    return { items, carried: [...notes, ...this.#notes, ...userTexts] };
  }

  async #decide(signal: AbortSignal): Promise<StepOutcome> {
    const { db, caller, hooks, config } = this.#deps;
    const runId = this.#run.id;
    const obs = this.#obs();
    // Read the wake request before the messages, so the messages it announced are among them (I1).
    const wake = await readWakeRequest(db, runId);
    const messages = await loadUserMessages(db, runId, this.#userCursor);
    const cursor = messages.at(-1)?.id ?? this.#userCursor;
    const extra = this.#firstTurn ? await hooks.promptContext(this.#run) : [];
    const userTexts = messages.map((message) => `Message from the user: ${message.text}`);
    const { items: pending, carried } = this.#buildInput(obs, userTexts, extra);
    const history = this.#history;
    const transcript: TranscriptEntry[] = [];
    const deltas: Usage[] = [];
    const record = (
      dir: "in" | "out",
      items: readonly unknown[],
      responseId: string | null,
      mark?: "compaction" | "seed",
    ) => {
      for (const item of items)
        transcript.push({
          dir,
          item: item as Record<string, unknown>,
          responseId,
          userEventId: dir === "in" ? cursor : null,
          ...(mark ? { mark } : {}),
        });
    };
    // Every model call, compaction included, first re-checks who holds control (spec §10.3).
    const guarded = {
      call: async (request: Parameters<ModelCaller["call"]>[0], callSignal: AbortSignal) => {
        await this.#assertAgentControl(callSignal);
        return caller.call(request, callSignal);
      },
    };
    const compactionDeps = {
      caller: guarded,
      model: this.#run.model,
      instructions: agentInstructions(this.#run.toolProfile),
      toolProfile: this.#run.toolProfile,
      signal,
    };
    /** Starts a fresh context from a summary; this turn's outputs were answered inside the compaction. */
    const seed = async (compacted: Compacted): Promise<ResponseInputItem[]> => {
      record("in", pending, null, "compaction");
      record("out", compacted.call.reply.output, compacted.call.reply.id, "compaction");
      deltas.push(usageDelta(compacted.call.model, compacted.call.reply.usage, 0));
      const items = seedFromSummary(compacted.summary, {
        pageText: this.#pageHeader(obs),
        screenshotKey: this.#screenshotKey!,
        // The first turn's context (the vault's alias list) is not in the summary: send it again,
        // so a re-login after compaction still knows which aliases exist.
        carried: [...(await hooks.promptContext(this.#run)), ...carried],
      });
      record("in", items, null, "seed");
      return items;
    };
    /** Rebuild from the run_transcript text log when the context itself is too large to send. */
    const rebuild = async () =>
      this.#rehydrate(
        await seed(await summarizeTranscript(compactionDeps, history, this.#run.goal, pending)),
      );
    let compacted = false;
    let input: ResponseInputItem[] = [];
    const request = () => ({
      model: this.#run.model,
      instructions: agentInstructions(this.#run.toolProfile),
      toolProfile: this.#run.toolProfile,
      input,
      format: "agent_turn" as const,
    });
    const obtain = async (): Promise<ModelCall> => {
      // Stateless (D37): the whole context is rebuilt from run_transcript for every request.
      const context = await this.#rehydrate(buildModelInput(history, pending));
      if (history.length > 0 && this.#lastInputTokens > config.compactionInputTokens) {
        compacted = true;
        try {
          input = await this.#rehydrate(
            await seed(await summarizeContext(compactionDeps, context)),
          );
        } catch (error) {
          if (!(error instanceof ContextOverflow)) throw error;
          input = await rebuild();
        }
      } else {
        input = context;
      }
      try {
        return await guarded.call(request(), signal);
      } catch (error) {
        // context_length_exceeded → compact now (once).
        if (!(error instanceof ContextOverflow) || compacted) throw error;
        compacted = true;
        input = await rebuild();
        return guarded.call(request(), signal);
      }
    };
    let call: ModelCall;
    try {
      call = await obtain();
    } catch (error) {
      // A compaction that succeeded was paid for even if the turn failed afterwards.
      if (deltas.length > 0) await this.#charge(deltas).catch(() => undefined);
      throw error;
    }
    if (!compacted) record("in", pending, null);
    record("out", call.reply.output, call.reply.id);
    const parsed = parseModelOutput(call.reply.output);
    const delta = usageDelta(call.model, call.reply.usage);
    deltas.push(delta);
    this.#lastInputTokens = call.reply.usage.input;
    this.#run = {
      ...this.#run,
      model: call.model,
      plan: parsed.turn?.planUpdate ?? this.#run.plan,
      usage: deltas.reduce(addUsage, this.#run.usage),
    };
    const usage = this.#tick();
    const display = parsed.calls[0] ? describeCall(parsed.calls[0], obs.screenshot.scale) : null;
    const events: RunEvent[] = [{ type: "budget", usage, budget: this.#run.budget }];
    if (call.fallback)
      events.unshift({ type: "model_fallback", from: call.fallback.from, to: call.fallback.to });
    const stored = await this.#deps.store.commit({
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
        plan: this.#run.plan,
        usage,
        model: call.model,
        consumeWake: wake,
      },
      events,
    });
    this.#history.push(...stored);
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
    if (turn?.status === "done") return this.#complete(signal);
    if (turn?.status === "need_human")
      return this.#wait(
        turn.needHuman === "captcha" ? "captcha" : "takeover",
        turn.reason.slice(0, 500) || "The agent needs a person",
      );
    this.#notes.push(NUDGE);
    this.#next = "observe";
    return CONTINUE;
  }

  #rehydrate(items: readonly ResponseInputItem[]): Promise<ResponseInputItem[]> {
    return rehydrateImages(items, this.#run.id, this.#deps.storage, this.#images);
  }

  /** The model is never called while the user holds control: the DB is the source of truth. */
  async #assertAgentControl(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // A worker that may have lost its lease does not pay for a model call it cannot commit.
    if (this.#deps.leaseExpired?.()) throw new Interrupted("lease_lost");
    const control = await readRunControl(this.#deps.db, this.#run.id);
    if (control?.controller === "user") throw new ControlHeld();
  }

  async #charge(deltas: readonly Usage[]): Promise<void> {
    this.#run = { ...this.#run, usage: deltas.reduce(addUsage, this.#run.usage) };
    await this.#deps.store.commit({ run: { usage: this.#run.usage } });
  }

  /* --------------------------------- approve --------------------------------- */

  /** Every risky item of the unanswered calls, classified in code (spec §5.5). */
  async #riskyItems(url: string, signal: AbortSignal): Promise<RiskyItem[]> {
    const items: RiskyItem[] = [];
    for (const call of this.#calls) {
      if (this.#results.has(call.callId)) continue;
      if (call.kind === "function") {
        // The tool asks against the page as it is now (e.g. where a sign-in form posts).
        const request = isFunctionTool(call.name)
          ? await this.#deps.browser.functionApproval(call.name, call.args, signal)
          : null;
        if (request)
          items.push({
            item: functionItem(call.callId),
            callId: call.callId,
            index: null,
            request,
            safetyChecks: null,
            target: null,
            context: null,
          });
        continue;
      }
      // The model's own warning comes before any click approval of the same call (review M6).
      if (call.safetyChecks.length > 0) {
        const label = `Safety check: ${call.safetyChecks.map((check) => check.message ?? check.code ?? check.id).join("; ")}`;
        const checks = call.safetyChecks.map((check) => ({
          code: check.code?.slice(0, 100) ?? null,
          message: check.message,
        }));
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
            safetyChecks: checks.slice(0, 20),
            context: null,
          },
          safetyChecks: checks,
          target: null,
          context: null,
        });
      }
      let previous: TargetDescription | null = null;
      for (const [index, action] of call.actions.entries()) {
        const target = await this.#deps.browser.targetFor(action, previous, signal);
        if (action.type === "click" || action.type === "double_click") previous = target;
        const need = needsApproval(action, target);
        if (need)
          items.push({
            item: actionItem(call.callId, index),
            callId: call.callId,
            index,
            request: approvalRequestFor(
              need,
              url,
              this.#screenshotKey,
              approvalExcerpt(target?.excerpt),
            ),
            safetyChecks: null,
            target: target?.path ?? null,
            context: target?.context ?? null,
          });
      }
    }
    return items;
  }

  /**
   * Asks for (or decides by policy) one approval per risky item. In ask mode the run waits for the
   * first undecided item; after its decision the loop comes back here for the next one.
   */
  async #approve(signal: AbortSignal): Promise<StepOutcome> {
    for (const call of this.#calls) {
      if (call.invalid !== null && !this.#results.has(call.callId))
        this.#results.set(call.callId, notRun(call, `Invalid call: ${call.invalid}.`));
    }
    const items = (await this.#riskyItems(this.#obs().url, signal)).filter(
      (item) => !this.#decided.has(item.item) && !this.#unreachable(item),
    );
    const toPerson = this.#personNext;
    this.#personNext = false;
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
    const origin = this.#obs().origin;
    const originAllowed = origin !== null && this.#run.allowedOrigins.includes(origin);
    for (const item of items) {
      if (this.#results.has(item.callId) || this.#unreachable(item)) continue;
      const decision = toPerson
        ? "ask"
        : item.safetyChecks
          ? decideSafetyChecks(this.#run.approvalMode, item.safetyChecks, originAllowed)
          : decideByPolicy(this.#run.approvalMode, item.request.kind);
      if (decision === "ask") {
        // Items are in order (safety checks first); nothing after this is decided until a person answers.
        ask = item;
        break;
      }
      rows.push({ id: randomUUID(), request: item.request, status: decision });
      this.#applyDecision({
        item: item.item,
        approved: decision === "approved",
        note: decision === "denied" ? POLICY_BLOCKED : null,
        ...riskOf(item.request),
        target: item.target,
        context: item.context,
        decidedBy: policyDecider(this.#run.approvalMode),
        decidedAt: Date.now(),
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
            decidedBy: policyDecider(this.#run.approvalMode),
          },
        ]),
        extra: (tx) =>
          insertApprovals(tx, this.#run.id, seq, rows, policyDecider(this.#run.approvalMode)),
      });
    }
    if (ask)
      return this.#ask(ask.request, {
        callIds: [ask.callId],
        item: ask.item,
        target: ask.target,
        context: ask.context,
      });
    this.#next = "act";
    return CONTINUE;
  }

  async #ask(
    request: ApprovalRequest,
    scope: {
      callIds: string[];
      item: string | null;
      target?: string | null;
      context?: string | null;
    },
  ): Promise<StepOutcome> {
    const obs = this.#obs();
    const seq = this.#deps.store.nextSeq();
    const approvalId = randomUUID();
    const result: ApproveStepResult = {
      approvalId,
      callIds: scope.callIds,
      item: scope.item,
      target: scope.target ?? null,
      context: scope.context ?? null,
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
    const decider = policyDecider(this.#run.approvalMode);
    const seq = this.#deps.store.nextSeq();
    const id = randomUUID();
    await this.#deps.store.commit({
      steps: [{ seq, phase: "approve", state: "done", result: { policy: [status] } }],
      events: [
        { type: "approval_requested", approvalId: id, request },
        { type: "approval_resolved", approvalId: id, status, decidedBy: decider },
      ],
      extra: (tx) => insertApprovals(tx, this.#run.id, seq, [{ id, request, status }], decider),
    });
  }

  /* ----------------------------------- act ----------------------------------- */

  /**
   * Runs one call. Every action of a batch is re-gated at execution time except the ones the user
   * (or policy) explicitly approved; a refused one stops the batch (Review Focus 3).
   */
  /** Seam 2: computer calls get the same mt.tool span function tools get in the registry. */
  #execute(call: PendingCall, signal: AbortSignal, step: StepCollector): Promise<Executed> {
    if (call.kind !== "computer") return this.#perform(call, signal, step);
    return instrument(
      SPAN.tool,
      {
        [ATTR.runId]: this.#run.id,
        [ATTR.toolName]: "computer",
        [ATTR.actionTypes]: call.actions.map((action) => action.type),
      },
      async (span) => {
        const executed = await this.#perform(call, signal, step);
        span.set({ [ATTR.toolOutcome]: executed.ran ? "ok" : "refused" });
        return executed;
      },
      { expected: interruptionOf },
    );
  }

  async #perform(call: PendingCall, signal: AbortSignal, step: StepCollector): Promise<Executed> {
    if (call.kind === "computer") {
      const refusals: string[] = [];
      const clicked: Array<{ index: number; label: string }> = [];
      let index = -1;
      const gate = async (action: ComputerAction) => {
        index += 1;
        const decision = this.#decided.get(actionItem(call.callId, index));
        if (decision && !decision.approved) {
          refusals.push(`Action ${index + 1} (${action.type}): ${decision.note ?? DENIED}`);
          return false;
        }
        const target = await this.#deps.browser.targetFor(action, null, signal);
        const need = needsApproval(action, target);
        // An approval covers what was approved, not the batch index: the same kind and label on
        // the same element (M10), and on the same record: an approval for Alice's row never
        // deletes Bobby (R29-3).
        const matchesApproval =
          decision !== undefined &&
          need !== null &&
          need.kind === decision.kind &&
          needLabel(need) === decision.label &&
          (decision.target === null || decision.target === (target?.path ?? null)) &&
          (decision.context === null || decision.context === (target?.context ?? null));
        if (need !== null && !matchesApproval) {
          if (decision) refusals.push(`Action ${index + 1} (${action.type}): ${TARGET_CHANGED}`);
          return false;
        }
        if (target && (action.type === "click" || action.type === "double_click"))
          clicked.push({ index, label: target.label });
        // Only a person's approval of this very element (path and record) lets typing run with an
        // incomplete guard; a policy approval (auto or bypass mode) never does. After a restore the
        // page may no longer show why approval was needed (a hung frame), so need may be null here.
        const personApproved =
          decision?.approved === true &&
          isPersonDecider(decision.decidedBy) &&
          decision.target !== null &&
          decision.target === (target?.path ?? null) &&
          (decision.context === null || decision.context === (target?.context ?? null));
        // The executor holds a click to this classification at the moment it presses (TOCTOU);
        // this very download, if approved, is let through only then (once).
        return {
          target,
          personApproved,
          ...(need?.kind === "download" && decision?.approved === true && decision.decidedBy
            ? { allowDownload: { url: need.url, approvedBy: decision.decidedBy } }
            : {}),
        };
      };
      const run = await this.#deps.browser.runComputer(call.actions, signal, gate);
      // Refused because the page could not be guarded: only a person's approval lets it run, so
      // the policy (auto or bypass) must not approve the retry again (m10).
      if (run.notes.some((note) => UNGUARDED_REFUSALS.includes(note))) this.#personNext = true;
      // Only clicks that actually ran (B3 logout detection, F10). The click already happened, so a
      // failing hook is logged and the act still commits (M4).
      for (const click of clicked) {
        if (click.index >= run.executed) continue;
        await this.#deps.hooks
          .onClick(this.#run, { label: click.label, url: this.#obs().url })
          .catch(() =>
            this.#deps.log.warn(
              { runId: this.#run.id, errorCode: "on_click_failed" },
              "onClick hook failed",
            ),
          );
      }
      const acknowledged = this.#decided.get(safetyItem(call.callId))?.approved
        ? call.safetyChecks
        : [];
      return {
        result: {
          kind: "computer",
          notes: [...run.notes, ...refusals],
          acknowledged,
          effects: run.effects,
          targets: run.targets,
        },
        ran: run.executed > 0,
        failed: false,
        wait: null,
        handOver: run.handOver,
      };
    }
    if (!isFunctionTool(call.name))
      return {
        result: notRun(call, "Unknown tool."),
        ran: false,
        failed: false,
        wait: null,
        handOver: null,
      };
    // The decision for exactly this call (same call id and arguments), so a tool can tell a human
    // approval (a lasting vault grant) from a policy one (this call only).
    const decision = this.#decided.get(functionItem(call.callId));
    // A machine decision (policy, bypass, observer) reaches tools as a policy one: never a
    // person's (no lasting vault grant, an off-origin sign-in form still needs a person), D44, D52.
    const approval: CallApproval | null =
      decision?.approved && decision.kind !== null && decision.decidedBy !== null
        ? {
            kind: decision.kind,
            decidedBy: isPersonDecider(decision.decidedBy) ? decision.decidedBy : POLICY_DECIDER,
            label: decision.label,
            decidedAt: decision.decidedAt,
          }
        : null;
    const run = await this.#deps.browser.runFunction(call.name, call.args, signal, approval, step);
    if (run.notesChanged) this.#notesChanged = true;
    return {
      result: { kind: "function", output: run.output },
      ran: true,
      failed: run.failed,
      wait: run.wait,
      // fill_credential's needs_human: a form only a person may approve (T10-12 review).
      handOver: run.handOver,
    };
  }

  /**
   * A credential fill a person approved (this card, or the lasting grant only a person's approval
   * leaves) opens the sign-in flow (D51). A policy approval (auto or bypass) never does.
   */
  #opensSignInFlow(call: PendingCall, executed: Executed): boolean {
    if (call.kind !== "function" || call.name !== "fill_credential") return false;
    if (executed.failed || executed.wait || executed.handOver) return false;
    const decision = this.#decided.get(functionItem(call.callId));
    return decision === undefined || isPersonDecider(decision.decidedBy);
  }

  async #act(signal: AbortSignal): Promise<StepOutcome> {
    const { store, browser } = this.#deps;
    const obs = this.#obs();
    let ran = false;
    let wait: "otp" | null = null;
    let handOver: string | null = null;
    // Downloads approved since the last act: the model repeats what started them now.
    for (const card of this.#downloadAllowances.splice(0)) await browser.allowDownload(card);
    for (const call of this.#calls) {
      if (this.#results.has(call.callId)) continue;
      // The page is beyond what the agent can act on safely: nothing after runs; the user takes over.
      if (handOver) {
        this.#results.set(call.callId, notRun(call, HANDED_OVER));
        continue;
      }
      // A call asked for a one-time code: nothing after it runs before the user supplies one.
      if (wait) {
        this.#results.set(call.callId, notRun(call, OTP_PENDING));
        continue;
      }
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
      // One collector per call: a function tool's note writes join this act's commit (B2 seam F2).
      const step = new StepCollector({
        usdLeft: this.#run.budget.maxUsd - this.#run.usage.usd,
      });
      if (call.kind === "computer") browser.signInFlow.acted();
      let executed: Executed;
      try {
        executed = await this.#execute(call, signal, step);
      } catch (error) {
        await this.#discard(step);
        // What the tool already spent (OCR, embeddings…) is charged even though it was cut short (M7).
        this.#run = { ...this.#run, usage: addUsage(this.#run.usage, step.usage) };
        if (interruptionOf(error) === null && !signal.aborted) throw error;
        this.#results.set(call.callId, notRun(call, INTERRUPTED));
        this.#answerRest(NOT_STARTED);
        await store
          .commit({
            steps: [{ seq, phase: "act", state: "aborted", action }],
            run: { usage: this.#run.usage },
          })
          .catch(() => undefined);
        throw error;
      }
      if (executed.failed) await this.#discard(step);
      if (this.#opensSignInFlow(call, executed)) browser.signInFlow.open();
      ran ||= executed.ran;
      wait ??= executed.wait;
      handOver ??= executed.handOver;
      this.#results.set(call.callId, executed.result);
      const storage = await browser.collectStorage().catch(() => null);
      // Spend already happened (OCR, embeddings…), so it is charged even for a failed tool.
      this.#run = { ...this.#run, usage: addUsage(this.#run.usage, step.usage) };
      await store.commit({
        steps: [{ seq, phase: "act", state: "done", action, result: executed.result }],
        storage,
        ...step.commitParts(),
        run: { usage: this.#run.usage },
      });
      await step.afterCommitted(this.#deps.log);
    }
    this.#next = "observe";
    const navigationOutcome = await this.#blockedNavigations(signal, { wait, handOver });
    if (navigationOutcome) return navigationOutcome;
    // Downloads the page started (a script, an attachment, a frame) were cancelled: each needs
    // its own approval; auto mode's policy denies them (spec §9).
    const downloads = browser.drainBlockedDownloads();
    for (const [position, entry] of downloads.entries()) {
      const request = downloadRequest(entry.url, entry.filename);
      const decision = decideByPolicy(this.#run.approvalMode, "download");
      if (decision === "approved") {
        await this.#recordPolicy(request, decision);
        if (request.kind === "download")
          this.#downloadAllowances.push({
            ...request,
            approvedBy: policyDecider(this.#run.approvalMode),
          });
        this.#notes.push(
          `Executor: downloading ${downloadUrlForCard(entry.url)} was allowed by this run's bypass mode. Do the action that started it again to save it.`,
        );
        continue;
      }
      if (decision !== "denied" && !wait && !handOver) {
        // One card at a time; the page can start the others again to ask.
        for (const later of downloads.slice(position + 1))
          this.#notes.push(downloadBlockedNote(later.url));
        return this.#ask(request, { callIds: [], item: null });
      }
      if (decision === "denied") await this.#recordPolicy(request, decision);
      this.#notes.push(downloadBlockedNote(entry.url));
    }
    if (handOver) return this.#wait("takeover", handOver);
    if (wait) return this.#wait("otp", "A one-time code is needed to sign in");
    // The page (URL, DOM, position) is part of the signature: scrolling or paging is not a loop.
    const signature = `${this.#calls.map(callSignature).join("|")}@${obs.url}#${obs.domHash}#${obs.scroll.x},${obs.scroll.y}`;
    if (ran && this.#loops.recordAction(signature, obs.phash))
      return this.#wait("takeover", "stuck");
    return CONTINUE;
  }

  /**
   * Top-level navigations the run's scope did not allow (D51), drained after each act and again
   * after each observation: a page can navigate after its act ended (a sign-in posting once its
   * script answered), and such a navigation must never be left without a card (MH hang). Ask mode
   * raises a new_origin card (one at a time); bypass approves, keeps the origin and opens it; auto
   * mode denies with a recorded step. A form post is not reopened as a GET: approving allows the
   * origin and the model runs the action again. Returns an outcome when the run must stop here.
   */
  async #blockedNavigations(
    signal: AbortSignal,
    pausing: { wait: "otp" | null; handOver: string | null },
  ): Promise<StepOutcome | null> {
    const { wait, handOver } = pausing;
    const blocked = this.#deps.browser.drainBlockedNavigations();
    const origins = [...new Map(blocked.map((entry) => [entry.origin, entry])).values()];
    for (const [position, entry] of origins.entries()) {
      const request: ApprovalRequest & { kind: "new_origin" } = {
        kind: "new_origin",
        origin: entry.origin,
        url: entry.url.slice(0, 4_096),
        ...(entry.formPost ? { formPost: true as const } : {}),
      };
      const decision = decideByPolicy(this.#run.approvalMode, "new_origin");
      // Only a denial is decided here; anything else waits for a person (resume adds the origin).
      // While a one-time code is awaited, that wait wins: the model is told and can navigate there
      // again once signed in, which asks then (M6).
      if (decision !== "denied" && wait) {
        this.#notes.push(
          `Executor: navigation to ${entry.origin} was blocked: it is not one of this run's allowed origins. Navigate there again after the one-time code to ask the user.`,
        );
        continue;
      }
      if (decision === "approved" && !wait && !handOver) {
        // Bypass mode (D44): the origin is allowed for the rest of the run and opened. The network
        // policy still applies to it (no private ranges). Never while the page is being handed
        // over or a code is awaited (m4).
        await this.#recordPolicy(request, decision);
        await this.#allowOrigin(entry.origin);
        this.#notes.push(
          await this.#openApproved(
            request,
            `${entry.origin} was allowed by this run's bypass mode`,
            signal,
          ),
        );
        continue;
      }
      if (decision !== "denied") {
        for (const other of origins.slice(position + 1))
          this.#notes.push(
            `Executor: navigation to ${other.origin} was blocked: it is not one of this run's allowed origins.`,
          );
        return this.#ask(request, { callIds: [], item: null });
      }
      await this.#recordPolicy(request, decision);
      this.#notes.push(
        `Executor: navigation to ${entry.origin} was blocked: it is not one of this run's allowed origins.`,
      );
    }
    return null;
  }

  async #allowOrigin(origin: string): Promise<void> {
    this.#run = {
      ...this.#run,
      allowedOrigins: [...new Set([...this.#run.allowedOrigins, origin])],
    };
    await this.#deps.store.commit({ run: { allowedOrigins: this.#run.allowedOrigins } });
  }

  /**
   * Opens an approved new origin (a GET); a form post is not replayed as a GET, so the model is
   * asked to send it again. Returns the note for the model.
   */
  async #openApproved(
    request: ApprovalRequest & { kind: "new_origin" },
    allowed: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (request.formPost)
      return `Executor: ${allowed}. The page was posting a form there, so nothing was opened: do the action that sent it (for example the submit button) again.`;
    await this.#deps.browser.navigate(request.url, signal);
    return `Executor: ${allowed}; it is now open.`;
  }

  /* --------------------------------- endings --------------------------------- */

  async #complete(signal: AbortSignal): Promise<StepOutcome> {
    const step = new StepCollector();
    const result = await this.#deps.hooks.onComplete({
      run: this.#run,
      log: this.#deps.log,
      step,
      signal,
    });
    if (!result.ok) {
      await this.#discard(step);
      this.#notes.push(`Executor: the run cannot finish yet: ${result.reason}`);
      this.#next = "observe";
      return CONTINUE;
    }
    this.#run = { ...this.#run, usage: addUsage(this.#run.usage, step.usage) };
    await this.#deps.store.commit({
      transition: { from: ["running"], to: "completed", waitReason: null, reason: null },
      ...step.commitParts(),
      run: { usage: this.#run.usage },
    });
    await step.afterCommitted(this.#deps.log);
    return { kind: "completed" };
  }

  /** Drops a step's staged writes (failed or interrupted tool) and deletes the objects it uploaded. */
  async #discard(step: StepCollector): Promise<void> {
    const keys = step.reset();
    await Promise.allSettled(keys.map((key) => this.#deps.storage.delete(key)));
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
    const wake = await readWakeRequest(this.#deps.db, this.#run.id);
    const decision = await loadApprovalDecision(this.#deps.db, pending.approvalId);
    if (!decision || decision.status === "pending") {
      const control = await readRunControl(this.#deps.db, this.#run.id);
      // Still waiting: this wake is used up, so a later sleep is not undone by it (I1).
      await this.#deps.store.commit({
        run: { consumeWake: wake },
        ...(control?.status === "running"
          ? {
              transition: {
                from: ["running"],
                to: "waiting",
                waitReason: "approval",
                reason: pending.request.kind,
              } as Transition,
            }
          : {}),
      });
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
        return this.#complete(signal);
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

    if (request.kind === "download" && pending.item === null) {
      await this.#deps.store.commit({
        steps: [step, approveStep(approved ? "done" : "skipped")],
        transition: TO_RUNNING,
        run: base.run,
      });
      // Bound to whoever decided this very card (N3); an approval with no decider lets nothing through.
      if (approved && decision.decidedBy) {
        // Exactly the download the card showed (it may start again under a new blob URL).
        this.#downloadAllowances.push({ ...request, approvedBy: decision.decidedBy });
        this.#notes.push(
          `Executor: the user approved downloading ${request.filename ?? request.url}. Do the action that started it again to save it.`,
        );
      } else this.#notes.push(`Executor: the user did not allow downloading ${request.url}.`);
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
        this.#notes.push(
          await this.#openApproved(request, `the user allowed ${request.origin}`, signal),
        );
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
            decidedBy: AGENT_DECIDER,
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
        ...riskOf(pending.request),
        target: pending.target,
        context: pending.context,
        decidedBy: decision.decidedBy,
        decidedAt: decision.decidedAt?.getTime() ?? Date.now(),
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
        decidedBy: AGENT_DECIDER,
      });
    }
    events.push({ type: "control", holder: "user" });
    const control = await readRunControl(this.#deps.db, this.#run.id);
    await this.#deps.store.commit({
      steps,
      events,
      ...(pending ? { extra: (tx) => markApprovalSuperseded(tx, pending.approvalId) } : {}),
      // A run waiting on an approval becomes waiting(takeover) too: the approval is gone (A5).
      // A code or CAPTCHA wait stays on the row (M7); hand-back re-observes.
      ...(control?.status === "running" ||
      (control?.status === "waiting" && !KEPT_THROUGH_TAKEOVER.includes(control.waitReason))
        ? {
            transition: {
              from: ["running", "waiting"],
              to: "waiting",
              waitReason: "takeover",
              reason: "user",
            } as Transition,
          }
        : {}),
    });
    this.markIdle();
  }

  /**
   * Hand-back always re-observes and runs on (M7, F1). A code or CAPTCHA wait kept through the
   * takeover is re-entered only if the page still needs it: the person may have typed the code
   * or solved the CAPTCHA themselves, and a code submitted meanwhile is used by the next fill.
   */
  async markHandBack(): Promise<void> {
    await this.#deps.store.commit({
      events: [{ type: "control", holder: "agent" }],
      transition: TO_RUNNING,
    });
    this.reobserve();
  }

  /**
   * The takeover could not be delivered to the user's live view (B6, F3): one commit returns
   * control to the agent, tells the UI why, and the agent re-observes before acting again. A run
   * that was waiting on an approval goes straight back to waiting(approval), never via running.
   */
  async revertTakeover(): Promise<void> {
    const pending = this.#pending;
    await this.#deps.store.commit({
      events: [{ type: "error", code: "takeover_failed", message: TAKEOVER_FAILED }],
      // A takeover that interrupted waiting(approval) returns there: the approval was never
      // superseded (markTakeover did not run), so the sheet stays and the decision still counts.
      transition: pending
        ? ({
            from: ["waiting", "running"],
            to: "waiting",
            waitReason: "approval",
            reason: pending.request.kind,
          } as Transition)
        : TO_RUNNING,
      // control{agent} only if this write took control back: a concurrent hand-back already did.
      extra: async (tx) => {
        if (await returnControlToAgent(tx, this.#run.id))
          await emitRunEvent(tx, this.#run.id, { type: "control", holder: "agent" });
      },
    });
    if (!pending) this.reobserve();
  }
}
