# OpenAI data-minimisation policy (D37, D38). Binding on every phase.

Goal: OpenAI should store as little of our data as possible.

## Rules for every call to OpenAI
1. **Disable server-side storage.** Responses API calls use `store: false` and never send `previous_response_id`. Model input is rebuilt from our own `run_transcript` (D37).
   - This applies to the agent loop, compaction summaries, OCR/vision transcription, `gpt-6-luna` auto-filing and any other `responses.*` call.
   - If reasoning must carry across turns, use `include: ["reasoning.encrypted_content"]` and replay the returned reasoning items.
2. **Use only stateless endpoints.** The allowed set is `responses.create`/`responses.parse` with `store:false`, `embeddings.create` and `audio.transcriptions.create`.
   - Never use the Files API, vector stores, Assistants/Threads, the Conversations API, the Batch API (it uploads files), Evals, fine-tuning, stored chat completions, or hosted tools that keep state (file_search, hosted web_search, code_interpreter containers).
   - This is enforced by an ESLint `no-restricted-syntax` / `no-restricted-properties` ban, plus a test.
3. **Send no identifiers or metadata.** Do not send the `metadata`, `user` or `safety_identifier` fields. Do not put workspace, run or user IDs or emails in prompts unless the task strictly needs them. Use aliases rather than names.
4. **Send minimal content.**
   - Screenshots sent to the model are masked (B1) and capped at 1280×800.
   - Only the last 3 screenshots go to the model as images; older ones become the text placeholder `[screenshot omitted]`.
   - Use `read_page` text rather than images where possible.
   - Audio goes to transcription only when a video has no captions. Send it in chunks and delete each chunk locally after it is used.
   - Embeddings get block text only, never secrets. The vault never touches OpenAI.
5. **One client factory.** All OpenAI access goes through a single factory, `createOpenAI()` in `packages/contracts/server` or the agent's `llm/` module. The factory sets `maxRetries: 0`. It does not log request bodies, and its wrapper (a) forces `store:false` and strips `previous_response_id`, `metadata`, `user` and `safety_identifier` on `responses.*`, and (b) is the only file allowed to import `openai`.
6. **Test guard.** An integration or behaviour test runs a full run against llm-mock and asserts:
   - every recorded request has `store === false`;
   - no request has `previous_response_id`, `metadata`, `user` or `safety_identifier`;
   - no request hits a non-allowlisted path.
7. **Account level (operator action, not code).** In the OpenAI org's Data Controls, confirm that sharing data for training is off. It is off by default for the API. The abuse-monitoring retention default (up to 30 days) can only be removed through OpenAI's Zero Data Retention approval for eligible orgs; record this as an optional request for the user, not a code task.
