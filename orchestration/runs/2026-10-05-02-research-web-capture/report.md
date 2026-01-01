---
run_id: 2026-10-05-02-research-web-capture
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

I recommend a DOM-first pipeline. Use the live Playwright DOM as the source of truth, keep a raw snapshot of every page as evidence, and only fall back to OCR or vision models when there is no usable DOM. I could not find a head-to-head benchmark of Defuddle against Readability on tables, code or math, so that choice rests on documented features rather than measured results.

## Recommended pipeline, ranked

1. **Snapshot first (provenance).** Before extracting anything, save:
   - an MHTML copy of the page via the Chrome DevTools command `Page.captureSnapshot`;
   - a full-page screenshot;
   - the URL, timestamp and a SHA-256 hash of each artifact.

   WARC (the Internet Archive's format, which also keeps HTTP headers) is the stronger archival option; SingleFile does not produce it.
2. **Main-content extraction in TypeScript, inside the page:** Defuddle (MIT). It was built for Obsidian Web Clipper and is meant to replace Readability. Its README says it:
   - converts MathJax/KaTeX to MathML with the LaTeX kept, and can output LaTeX in its full bundle;
   - strips line numbers and syntax highlighting from code blocks but keeps the language;
   - normalizes footnotes;
   - can return Markdown directly.

   Use Mozilla Readability as the fallback.
3. **HTML→Markdown.** Choose by how complex the content is:
   - Kreuzberg `html-to-markdown`: Rust core with bindings for 16 languages, handles nested tables and GFM tables.
   - Turndown plus `turndown-plugin-gfm`: TypeScript. Without the plugin it has no tables.
   - Pandoc: handles the most edge cases (nested lists, definition lists).

   Keep complex tables (merged cells, nested tables) as raw HTML inside the Markdown, because GFM tables cannot represent them.
4. **Visuals (Playwright).**
   - Run the browser context with `deviceScaleFactor: 2`.
   - Lazy images: scroll the page in steps, wait for network idle, and force `loading="eager"`.
   - Images: download the original file by picking the largest `srcset` candidate (or `currentSrc`) through `page.request`, which keeps cookies. Hash each file.
   - Inline SVG: serialize with `XMLSerializer` and inline the computed styles.
   - Canvas: export with `toDataURL()`. A cross-origin ("tainted") canvas will throw, so fall back to an element screenshot.
   - Charts and diagrams: always also take an element screenshot as a fallback.
5. **PDFs.**
   - Born-digital PDFs: Docling (MIT, Python). In one 2026 benchmark it was rated "drops formulas rather than fabricating them". pymupdf4llm is fastest but AGPL.
   - Math- or table-heavy PDFs: MinerU or Marker, which scored 86 each on that benchmark against Docling's 77.
6. **OCR/vision fallback** for canvas apps, scanned PDFs and video frames:
   - Self-hosted: olmOCR 2 (Apache-2.0, reported 82.4 on olmOCR-Bench) or PaddleOCR-VL (about 80).
   - Hosted: Mistral OCR 3, at $1–2 per 1,000 pages, with strong table claims and about 78% formula accuracy reported by codesota.com.
   - On the same leaderboard, general frontier vision models scored 74–81, not clearly ahead of the specialist models.
   - Tesseract only as a last resort; it is weak on tables and math.
7. **Verification.**
   - Normalize the text (Unicode NFKC, collapse whitespace) and diff it against the `innerText` of the selected DOM subtree. Flag coverage below about 98%.
   - Store, for each block of the note: a CSS/XPath selector, character offsets, a hash of the block's text, and a text-fragment link (`#:~:text=prefix-,start,end,-suffix`). Text fragments now work in Chrome, Safari 16.1+ and Firefox 131+.
   - For OCR output, rerun with a second engine and send disagreements to review. Never accept a vision model's paraphrase as a quote.
8. **Hard pages.**
   - Shadow DOM: Playwright locators reach into open shadow roots by default. Closed roots need a CDP DOM snapshot or a screenshot.
   - Iframes: use `page.frames()` / `frameLocator` and extract each frame on its own.
   - Infinite scroll: scroll until the page height stops changing, with a cap on the number of items.
   - Logins and paywalls: run inside the user's own logged-in browser context (`storageState`). Do not try to bypass paywalls.

## Other tools you asked about

| Tool | Language | Self-host via Docker | Note |
|---|---|---|---|
| Trafilatura | Python | yes | Strong on articles (F1 about 0.92). One structured-content benchmark puts its table similarity at about 0.34 and code at about 0.13, so it's weak there. |
| Crawl4AI | Python | yes (needs about 4GB RAM) | Good if you want a full service. |
| Firecrawl | TS | partial | Anti-bot, screenshots and actions are only in the hosted version. |
| Jina Reader | TS | Apache-2.0 image | Simple, but you have less control. |
| MarkItDown | Python | yes | Poor fidelity: 57 on the PDF benchmark, and it misses headings. |
| Docling | Python | yes | Also takes HTML and DOCX. |

The 2026 WCXB benchmark found extractors agree on articles (F1 0.93) but range from 0.41 to 0.84 on documentation, forum and listing pages. Since those are common note sources, the in-DOM step plus the coverage check matters more there than in news-style articles.

## Unverified or caveated

- **PDF benchmark scores (86 / 77 / 76):** published by pdfmarkdown.app, which ranks its own tool first, on only 5 documents.
- **olmOCR-Bench numbers:** some come from an aggregator leaderboard (Nanonets) and vendor reports (Chandra 85.8); I did not check them against primary sources.
- **Mistral OCR 3 table figure (96.6%):** Mistral's own claim. A "Mistral OCR 4" launch article exists, but I did not verify it.
- **Licenses**, as reported but not checked against the actual LICENSE files:
  - Marker: GPL code, and the model weights are non-commercial unless the company is under $5M revenue and $5M funding.
  - MinerU: now a custom Apache-based license with revenue thresholds.
  - PyMuPDF: AGPL, which matters for a SaaS.
- **Defuddle's table handling** isn't documented in its README.
- **Snapshot provenance** (MHTML, hashes, text-fragment anchors) is a pattern I'm proposing. I found no formal 2026 standard for provenance in AI note-taking.

## Sources
- Defuddle: https://github.com/kepano/defuddle
- WCXB benchmark: https://arxiv.org/abs/2605.21097
- Trafilatura evaluation: https://trafilatura.readthedocs.io/en/latest/evaluation.html
- Readability vs Trafilatura: https://bulkmd.app/blog/readability-vs-trafilatura-extractors
- Kreuzberg html-to-markdown: https://github.com/kreuzberg-dev/html-to-markdown
- HTML→Markdown libraries compared: https://reader.dev/blog/html-to-markdown-libraries
- PDF benchmark: https://github.com/pdfmarkdownapp/pdf-to-markdown-benchmark
- PDF tools overview: https://jimmysong.io/blog/pdf-to-markdown-open-source-deep-dive/
- Licenses: https://particula.tech/blog/docling-vs-mineru-vs-marker-pdf-parser
- MinerU license discussion: https://github.com/opendatalab/MinerU/discussions/2863
- olmOCR 2: https://allenai.org/blog/olmocr-2
- olmOCR-Bench leaderboard: https://benchmarking.nanonets.com/benchmarks/olmocr
- olmOCR bench code: https://github.com/allenai/olmocr/tree/main/olmocr/bench
- Mistral OCR 3: https://pyimagesearch.com/2025/12/23/mistral-ocr-3-technical-review-sota-document-parsing-at-commodity-pricing/
- Mistral OCR 3 benchmarks: https://www.codesota.com/ocr/mistral-ocr-3
- OCR models overview: https://www.docsumo.com/blog/best-ocr-models
- Text fragments support: https://caniuse.com/url-scroll-to-text-fragment
- Firecrawl / Crawl4AI / Jina comparison: https://crawlora.net/blog/firecrawl-alternatives
- SingleFile and WARC: https://github.com/gildas-lormeau/SingleFile/discussions/1418
