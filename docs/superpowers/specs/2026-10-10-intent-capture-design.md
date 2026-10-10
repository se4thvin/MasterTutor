# Intent-driven capture (D57)

## Intent and evidence
Save the material a person wants from a source, preserving every kept block verbatim. Benchmark reports for zyBooks runs 1–5 show due banners nested inside activity widgets, plus a scored assignment overview captured as notes. Run 5 also shows a stale SPA title. Synthetic tests must model that structure without committing licensed course content.

## Global Constraints
- Follow CLAUDE.md: bloat-free, low latency, security first, modular, decoupled, one source of truth.
- One self-hosted Docker Compose app; OpenAI is the only paid service.
- D54/D55: selection returns IDs only; source text, anchors and order never come from model output.
- D38: the shared stateless OpenAI factory, store:false, strict JSON, no identifiers, no hosted state, masked minimal previews.
- Tests use llm-mock or injected fakes, never real OpenAI; all suites run through scripts/remote-test.sh.
- Never read .env* files, print secrets, write credentials, push, merge, stash or touch another worktree.
- Apple HIG: keyboard-accessible choices, clear labels, solid content surfaces; glass only for chrome and floating layers.
- Commit after each task using explicit paths and the Codex co-author trailer.

## Contracts and persistence
Define CaptureCategory enums (reading_text, definitions, figures, tables, worked_examples, activities, due_dates, scores, navigation, platform_chrome). CaptureBrief has keep, skip and scopeNote (maximum 500 characters); keep/skip are disjoint. CaptureIntent is strict structured model output {brief, ambiguous}. CaptureQuestion has a server-written short question and site domains, rather than model-generated question prose. CaptureAnswer has keep/skip and scopeNote; choices use the same category schema, plus free text. Store captureBrief and captureQuestion on runs. A dedicated question is a scope decision, not an action approval; waiting uses the existing approval wait but never the policy resolver. It stays pending through mode changes, restores, sleeps and takeover. A person answers it through an authenticated workspace-scoped RPC; no automatic decider exists.

Store preferences keyed by workspace and canonical registrable domain, using the same private-PSL logic as D51 (IP/bare suffix fallback exact host). Preferences contain a brief, not credentials or source content. Answering saves each source site's preference. Saved preferences are defaults; an explicit goal takes precedence. A multi-site run asks at most one card; incompatible saved defaults still need that one clarification. Settings lists editable preferences. The run view has an editable brief that also saves site defaults.

Migration 0019 is next free: 0015 Observer, 0016 remove_model_blocks, 0017 guard_shadow_default, 0018 guard_checkpoint already exist. Update the Drizzle journal and snapshot; grant web/agent only the preference operations they need under existing workspace isolation conventions.

## Start and turn context
Library hooks own capture-intent initialization, called by RunLoop.step before observe or decide. If no brief exists, call gpt-6-luna through strict parsing with goal and saved defaults only; screen the goal before sending. Charge all model usage, including billed invalid output. Persist the brief and a server-written question atomically with the usage and capture_brief / capture_asked events. If ambiguous and no usable saved scope exists, wait before browser observation/navigation/actuation. No timeout chooses an answer. Invalid/unavailable intent output fails closed and does not act.

Every subsequent step reloads the persisted brief/question so edits and answers become visible to a live worker. D56 TurnContext announces the brief and applicable saved preferences as deltas, and restates them after compaction. Its plan fact tells the agent to build planUpdate from the brief: navigate to relevant material, capture matching content, exclude skipped categories. User scope edits affect future captures; existing notes are not silently rewritten.

## Capture selection
Keep structural chrome removal as a cheap prefilter. In persistCapture (shared by web and PDF) and the separate video timed-block append path, screen all source values before calling the selector. Load and validate the latest brief. Assign capture-local block IDs by extraction order; send IDs, types and bounded short previews in an untrusted-data envelope. Use gpt-6-luna strict JSON {ids:string[]} only. Never send screenshots/full pages/identifiers. Batch bounded windows to avoid dropping late content; charge usage before inspecting output and stop additional calls when the run's USD cap is reached. Ignore unknown IDs, deduplicate results and filter the original array in source order. A refusal/invalid output fails closed; no fallback saves the whole page.

Video discovery creates its source lazily after the first kept block, and keyframes are selected before asset upload. No kept blocks means no new note/source/snapshot upload and an explicit skipped capture result with null noteId. Clear lede when selection removes content so banners do not survive in note descriptions. Selection does not claim whole-page coverage is intent coverage: retain source verification and report kept/skipped separately. Telemetry is typed count-only capture_selected events, never text or previews; ask/answer events live in the durable run stream.

## F10 and UI
Capture page extraction takes its title from the first visible main heading when available, excluding site header/navigation. This deterministic choice fixes both generic and stale SPA document titles without asking a model to invent a title; fall back to extraction/document title when no main heading exists.

/new explains that unclear scope triggers one question before browsing. The run view displays the brief and a single question card with multi-select Keep/Skip chips and a labeled scope textarea. Submit is explicit, pending/error feedback preserves choices, and every category can be moved between keep and skip. Settings reuses this editor for per-site defaults. All displayed text is escaped by React. Streaming reducers restore brief/question from RunDetail and fold capture_brief/capture_asked/capture_answered/capture_selected events.

## Validation
Contract tests reject overlaps, invalid enums, overlong text and text-bearing selector output. Database tests cover migration, workspace isolation and unique domains. Agent tests cover every approval mode, one ask across restore/mode switches, persisted answers and explicit-goal precedence. llm-mock request guards verify D38 and billing on errors. A synthetic run-5 fixture has activity widgets with repeated due banners, original prose and a scored overview: selection excludes banners/overview, preserves prose byte-for-byte and in order, ignores unknown/duplicate IDs. Test empty captures, late-window content, exhausted budget, and injected page instructions. UI tests check edits/answer controls and responsive solid surfaces. Run typecheck, lint and affected unit/integration suites after each task, then scripts/remote-test.sh all.
