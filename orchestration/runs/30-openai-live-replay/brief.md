---
run_id: 30-openai-live-replay
date: 30-openai-
agent_type: general-purpose
phase: B1
status: completed
depends_on: []
---

Run a minimal live check against the real OpenAI API. It has to confirm that MasterTutor's D37/D38 request shape is accepted.

**Context:** the agent builds every Responses request with `store:false` and never sends `previous_response_id`. It replays earlier output items from its own transcript: reasoning items carrying `encrypted_content`, `computer_call`s, and `computer_call_output`s. Screenshots older than the last 3 are replaced by a 1×1 blank PNG. Unit tests mock all of this, so it has never been tested against the real API.

**Repo:** `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`. Read these first:
- `apps/agent/src/llm/openai.ts`, the single wrapper;
- the Responses client and request builder under `apps/agent/src/llm/` and `loop/`;
- `orchestration/briefs/openai-data-policy.md`.

**Do this:**
1. Write a scratch script in `/private/tmp/claude-501/-Users-sethvin-nanayakkara-orca-workspaces-MasterTutor-houndshark/da9cab1f-0477-48e7-b492-c59001c21006/scratchpad/`, run with `pnpm exec tsx` from the repo so its modules resolve.
   - It must import and use the repo's own wrapper and request-building code. Don't hand-roll a request.
   - Load `OPENAI_API_KEY` from the repo `.env` into `process.env` inside the script with `dotenv` or Node's `--env-file`. Never print it, log it, echo it or write it anywhere. Don't `cat` the `.env` file.
2. Use the models from STATE.md D1: `gpt-6-astra`, with `gpt-6.1-sol` as fallback. Use the repo's own model and tool config, including the computer tool.
3. **Turn 1:** send a benign synthetic task ("click the blue button") with one synthetic screenshot. Generate it as a plain PNG containing a blue rectangle; it must contain no real page or personal data. Get a `computer_call` back, plus reasoning items if any.
4. **Turn 2:** rebuild the input exactly as the repo does: replay turn 1's output items, add a `computer_call_output` with a new synthetic screenshot, use `store:false`, and send no `previous_response_id`. It must be accepted.
5. **Turn 3:** force the window so an older screenshot becomes the 1×1 blank PNG, then confirm the request is accepted.
6. Also exercise any `pending_safety_checks` acknowledgement shape if one appears; don't fake one.
7. Record:
   - the HTTP status for each turn;
   - any API error messages, verbatim and with any key redacted;
   - the token usage;
   - whether the response objects show `store:false`, i.e. whether a GET on the response id fails as expected. One GET is fine.
8. Stay within about 6 API calls in total.
9. If the API rejects anything, find the minimal shape change needed in the repo code and describe it precisely. Don't edit repo code.

**Output:** write `orchestration/runs/30-openai-live-replay/report.md` with the results and redacted request shapes. No secrets and no base64 images; use `[png]` in their place. Reply in at most 150 words. Don't dispatch subagents.
