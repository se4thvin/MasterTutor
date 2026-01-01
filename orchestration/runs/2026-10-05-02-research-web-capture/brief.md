---
run_id: 2026-10-05-02-research-web-capture
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
---

# Brief: Faithful web capture

Research task (web research, no code changes). Today is 2026-10-05. We are building an agentic note-taking web app: an AI agent drives a Playwright/Chromium browser and must extract content from webpages (and PDFs/other docs it opens) into notes that are 1:1 or extremely faithful to the original — text, headings, lists, tables, code blocks, math/LaTeX, links — plus capture images, diagrams, charts, and SVGs as actual image assets (not lossy descriptions).

Find the best 2026 approaches, with sources:
1. HTML→Markdown fidelity: Mozilla Readability, Defuddle, Trafilatura, Turndown, html-to-markdown libs, Jina Reader, Firecrawl, Crawl4AI, MarkItDown, Docling. Which preserves structure best (tables, code, math, nested lists)? Which are self-hostable in Docker?
2. Capturing visuals: element screenshots via Playwright (full-res, devicePixelRatio 2), downloading original image src/srcset, serializing inline SVG/canvas, handling lazy-loaded images, full-page screenshots for provenance.
3. Verification of fidelity: ways to verify extracted text matches source (diff against DOM innerText, checksums, source spans/anchors, quote-level citations with text fragments `#:~:text=`). Any 2026 best practices for "provenance" in AI note-taking.
4. When the DOM isn't usable (canvas apps, image-only PDFs, video frames): best OCR / vision options in 2026 (e.g. GPT vision models, Mistral OCR, olmOCR, Docling, PaddleOCR, Tesseract) and their accuracy for tables/math.
5. PDFs: best extraction (Docling, Marker, MinerU, pymupdf4llm).
6. Handling paywalls/auth pages, infinite scroll, shadow DOM, iframes.

Return a concise report (<700 words) with a recommended pipeline (ranked), libs with language (TS/Python), and source URLs. Flag anything unverified.
