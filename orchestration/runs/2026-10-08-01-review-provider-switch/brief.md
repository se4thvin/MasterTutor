---
run_id: 2026-10-08-01-review-provider-switch
date: 2026-10-08
agent_type: spec-verifier
phase: review
status: completed
depends_on: []
---

Read-only review of planned assessment, no edits and do not access .env/secrets. User asks effort to switch OpenAI/Claude API keys in MasterTutor including branches/worktrees. Read orchestration/STATE.md then INDEX.md. Review model seam apps/agent/src/llm/client.ts, items.ts, caller.ts, loop/model-input.ts, transcript.ts and compaction.ts; contracts/env.ts, constants.ts, server/openai.ts; run create DTO. Candidate conclusion: manageable provider integration, not key swap; env-only prototype 2–3 engineer days; production per-run selection all reasoning/OCR/filing/titles + regression 5–8 engineer days; Claude-only with local embeddings and timestamp/diarization transcription 8–15 total. Recommend direct small adapters, retain OpenAI embeddings/transcription initially, pin provider per run, never transfer reasoning opaque state across providers. Branch risks fe-run-chat touches same llm/loop, browse-freedom dirty run-loop; obs-b/c are observability not implemented observer; observer plan D52 is future OpenAI coupling. Check for material omissions and whether estimates defensible as rough judgments. Return <=150 words, no report writes. Original objective review only, no implementation.
