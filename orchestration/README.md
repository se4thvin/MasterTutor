# Orchestration

This folder is the orchestrator's external memory. The orchestrator (main Claude session) delegates work to subagents and records every run here so context can be rebuilt by reading files instead of keeping everything in the conversation.

## Layout

```
orchestration/
  README.md      # this file: conventions
  STATE.md       # current phase, decisions, open questions, next steps (read this first)
  INDEX.md       # table of every subagent run with a one-line takeaway
  runs/
    YYYY-MM-DD-NN-<phase>-<slug>/
      brief.md   # exact prompt sent to the subagent
      report.md  # subagent's full final report, verbatim
      artifacts/ # optional: any extra files the run produced
  benchmarks/    # benchmark records (record.md per invocation) and tickets/
```

## Conventions

- **Run IDs** are `YYYY-MM-DD-NN-<phase>-<slug>`; `NN` is a two-digit sequence per day, so folders sort chronologically.
- **Phases:** `research`, `design`, `spec`, `plan`, `implement`, `review`, `test`, `fix`.
- **Frontmatter** on `brief.md` and `report.md`:
  ```yaml
  run_id: 2026-10-05-01-research-computer-use
  date: 2026-10-05
  agent_type: general-purpose
  phase: research
  status: completed   # pending | running | completed | failed | superseded
  depends_on: []      # run IDs whose reports this run builds on
  ```
- Subagents are blocked from writing report files, so they **return the full report as their final reply**. The orchestrator runs `python3 orchestration/tools/persist_run.py <transcript.jsonl> <run_dir> [--phase P] [--depends-on ids] [--brief-only]`, which copies the prompt into `brief.md` and the final reply from the transcript into `report.md` without passing it through the main context.
- Reports are stored **verbatim**: no summarizing, keep source URLs and `[unverified]` flags.
- After each run: add a row to `INDEX.md` and update `STATE.md` if a decision or open question changed.
- Subagent briefs should point to prior reports by path (e.g. "read `orchestration/runs/.../report.md`") rather than pasting their content.

## Traversal

1. `STATE.md`: where we are and what's decided.
2. `INDEX.md`: find the relevant run by topic/takeaway.
3. `runs/<id>/report.md`: full detail.
- **Long outputs (plans, big reports):** tell the subagent to write them to `.superpowers/plan-drafts/<name>.md` (subagents can write there) and reply with a ≤150-word summary. Long replies land in the orchestrator's context via task notifications, so only short replies are allowed.
