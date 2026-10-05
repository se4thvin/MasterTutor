---
run_id: 2026-10-05-06-research-design-language
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

Research task (web research; the only files you write are the two below). Today is 2026-10-05.

Context: read `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/STATE.md` first. We're designing the UI and design language for an agentic note-taking web app. Stack: Next.js 16, shadcn/ui, Tailwind v4, Tiptap 3. Core surfaces:
(1) a task composer ("take notes on this URL/video/course");
(2) a live run view: a streamed view of the agent's browser, a step timeline with screenshots, actions and reasoning, approval prompts for risky actions, and a "take control" handoff;
(3) a notes/artifacts library with search;
(4) a note reader/editor with faithful content: images, diagrams, tables, math, code, per-block source citations and provenance ("view in source");
(5) a credentials vault UI (aliases, domains, TOTP, sessions) that never displays secrets;
(6) settings.
The user wants it "delightful and clean".

Research 2026 best-in-class references and patterns, with sources:
1. Design-language references for calm, premium productivity and AI-agent tools, e.g. Linear, Arc/Dia, Notion, Raycast, Vercel/v0, Perplexity, ChatGPT Agent/Operator, Claude, Readwise Reader, Granola, Craft, Things. Break down what makes each delightful: typography, color, density, motion, empty states.
2. UX patterns specific to agent run views: live browser plus timeline, streaming status, interrupt/approve/takeover, trust and provenance indicators. How do ChatGPT agent mode, Manus, Browserbase/Director and OpenAI Operator present this?
3. Reading-first note UI: typography scales, measure, citations/footnotes, side-by-side "source vs note" comparison.
4. Concrete token suggestions: fonts available on Google Fonts or open-licensed (e.g. Inter, Geist, IBM Plex, Source Serif, Newsreader), type scale, spacing, radius, neutral palette plus one accent, light/dark, and motion durations/easings. Accessibility: WCAG AA.
5. Propose 3 distinct design-language directions. Give each a name, a one-paragraph mood, fonts, palette hex values, radius/density, signature details and motion, which reference apps it draws from, and trade-offs. Make one your recommendation.

Write your output to two files:
- `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark/orchestration/runs/2026-10-05-06-research-design-language/brief.md`: frontmatter (`run_id: 2026-10-05-06-research-design-language`, `date: 2026-10-05`, `agent_type: general-purpose`, `phase: research`, `status: completed`, `depends_on: []`), then this full prompt verbatim.
- `.../report.md`: the same frontmatter, then your full report (aim for 900–1400 words), with source URLs and [unverified] flags.

Your final reply to me: ONLY a compact summary (under 250 words) of the 3 directions and your recommendation, plus the report path.
