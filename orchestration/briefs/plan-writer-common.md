# Common brief for phase-plan writers

You are writing ONE implementation plan for the phase or phases named in your dispatch.

## Required process
1. Invoke the Skill tool with `skill: "superpowers:writing-plans"` and follow it exactly: header, Global Constraints, Review Focus, File Structure, bite-sized TDD tasks with complete code (no placeholders), an **Interfaces** block on every task, and a self-review.
2. Read these, in this order:
   - `docs/superpowers/specs/2026-10-05-agentic-notes-design.md`: the binding spec.
   - `orchestration/STATE.md`: decisions D1–D35, which override the spec where they differ.
   - `CLAUDE.md`: hard constraints and engineering principles (mandatory).
   - `docs/superpowers/plans/2026-10-05-phase-0-foundations.md`: Phase 0 is already planned and is being implemented now. **Use its exact package names, exports, table/column names, env names, contracts and file paths.** Read especially its File Structure, every task's Interfaces block, and "Notes for later phases".
   - Any `orchestration/runs/*/report.md` the spec cites for your phase.
3. Inspect the repo (`git log`, `ls`) to see what has already landed. Phase 0 code may be partially present; the Phase 0 plan is the source of truth for its interfaces.

## Environment facts
- macOS arm64 dev box: Node 24, pnpm via corepack, Docker 28.5 with a 25GB memory limit.
- Only about 20GB of disk is free. Keep images lean, reuse the Phase 0 images, and include `docker builder prune -f` steps after builds.
- `OPENAI_API_KEY` is in the git-ignored root `.env`. Never print it.
- Branch: the current worktree branch (`agentic-notes-browser-agent`). Commit per task. Never push.

## Benchmark context (the user's acceptance goal, D32–D34)
After the build, the agent must log into zyBooks at `https://learn.zybooks.com/signin` (email/password, no SSO). The credentials go into the vault through the Vault UI; they never appear in plans, code, fixtures or logs. The agent then completes participation activities in reading assignments 1–5 of `https://learn.zybooks.com/zybook/UTDALLASCE2310EE2310AkourFall2026`, in `approvalMode: "auto_within_allowlist"`. Design so that this works: generic computer-use and browser-use, with no zyBooks-specific hacks in product code. Benchmark-specific orchestration belongs in the benchmark harness.

## Output
Return the **complete plan markdown as your final reply**. Long is fine and may span several messages. Do not write files: the orchestrator saves the reply to the path given in your dispatch. Do not dispatch subagents.
