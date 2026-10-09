---
run_id: 2026-10-09-05-research-notes-ux
date: 2026-10-09
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

You are a research agent for MasterTutor, a self-hosted AI study agent. It captures faithful 1:1 notes from web pages, YouTube and PDFs into typed blocks (paragraphs, headings, figures, tables, math as TeX, code, activity callouts), each with provenance and verified/partial fidelity.

The user wants a far more delightful notes system:
- a reader redesign;
- a study layer: AI summary, key terms, flashcards and quizzes, always labelled as AI and kept separate from the faithful text;
- highlights and comments;
- a library refresh;
- an Observer "document designer" that picks or tunes a layout preset per note from structure only.

The design language is Apple HIG with Liquid Glass and SF Pro.

Repo: `/Users/sethvin-nanayakkara/orca/workspaces/MasterTutor/houndshark`. Read `CLAUDE.md` (core values: bloat-free, low latency, security-first, modular, decoupled, no redundancy) and D53 in `orchestration/STATE.md`.

Research the following with web search and primary sources.

**1. Best-in-class reading and notes UX.** Cover:
- Readwise Reader, Matter, Instapaper, Apple Notes/Books, Craft, Notion, Obsidian (reading view and callouts), Bear, iA Writer, Arc's reader mode, Medium, Stripe Press web, Distill.pub, and the Tufte CSS/sidenotes approach.
- Specifics:
  - reading measure and line-height research;
  - type scales;
  - outline/TOC patterns and scroll-spy;
  - figure handling and lightbox;
  - sidenotes versus footnotes;
  - provenance and citation display that stays quiet;
  - reading progress;
  - focus mode;
  - dark-mode typography.

**2. Study tools.**
- Anki and FSRS (spaced repetition: algorithm, open-source implementations and licences, e.g. ts-fsrs).
- RemNote, Quizlet, Khanmigo, NotebookLM study guides.
- Research-backed learning: retrieval practice, the testing effect, elaboration, dual coding.
- What to generate from a note (summary, key terms, cloze cards, Q&A cards, quizzes), and how to keep the generated content grounded and cited back to source blocks to avoid hallucination.
- How to label AI content honestly.

**3. Highlights and comments.**
- Robust anchoring of highlights across re-capture (W3C Web Annotation selectors, text-quote plus position, Hypothesis's approach, block-id anchoring).
- UX patterns and export to Obsidian.

**4. Rendering tech, bloat-aware.**
- KaTeX versus MathJax (size, SSR).
- Code highlighting: Shiki versus Prism versus highlight.js (size, lazy-loading).
- Figure zoom.
- Virtualised long documents.
- Print and PDF export.
- Recommend the leanest choices that meet the need.

**5. Delight.** Micro-interactions in reading apps, and React Bits components that fit (text reveal, scroll progress), within the motion budget (compositor-only transforms; Apple-style springs).

**Deliverable:** a research report with concrete recommendations, options and trade-offs, sources with URLs, and `[unverified]` marks where needed. Return the full report as your final reply. Don't write files, don't dispatch subagents, and never read `.env*`.
