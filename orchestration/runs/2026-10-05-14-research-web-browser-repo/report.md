---
run_id: 2026-10-05-14-research-web-browser-repo
date: 2026-10-05
agent_type: general-purpose
phase: research
status: completed
depends_on: []
---

## noahshinn/web-browser: analysis

**Short answer: don't depend on it and don't vendor it. Take two or three small ideas at most.** Despite its name, the repo has no browser in it. It is an LLM-driven web search and scrape server that fetches raw HTML over HTTP. It doesn't touch any of our modules except, loosely, `read_page`.

### 1. What it is
- **Purpose:** "automates web search, traversal, and extraction of information." You POST a query, it searches through a self-hosted SearXNG instance, fetches the result pages, and an LLM writes a "findings" document in Markdown.
- **Author:** Noah Shinn, the author of Reflexion.
- **License:** **AGPL-3.0**.
- **Maturity:** 30 stars, 6 forks, 52 commits between 2024-12-15 and the last push on 2025-02-07. It has been dormant for about 20 months. There are no tests and no releases.
- **Language and dependencies:** Rust, about 2.7k lines (`server/Cargo.toml`). It uses rocket, tokio, reqwest, ammonia, scraper and regex. Docker Compose adds SearXNG, Valkey, Caddy, a LiteLLM proxy, and optionally Langfuse plus Postgres. Its default model is `claude-3-5-sonnet-20241022` (`server/src/llm.rs`).

### 2. Architecture
- **Page representation:** text only. `webpage_parse.rs::visit_and_parse_webpage` does a reqwest GET with a spoofed Chrome 128 user agent and `sec-ch-*` headers. `dom_parse_webpage` then cleans the HTML with an ammonia allowlist: it drops 27 tags (including `figure`, `nav`, `header`, `article`, `svg`, `canvas`, `em`, `strong`) and keeps only semantic attributes (`href`, `alt`, `title`, `aria-label`, `role`, `type`, `name`, `data-label`). Image `src` is stripped. There is no JavaScript rendering, no accessibility tree and no screenshots.
- **Action space:** there are no tools and no function calling. The model only chooses a search-result index (`agent_search/human.rs::select_next_result`), returns a `sufficient` true/false (`agent_search.rs::check_sufficient_information`), or rewrites the findings document. Outputs are parsed by regex from fenced JSON (`utils.rs::parse_json_response`).
- **Browser driving:** none. There is no Playwright, CDP or headless Chrome anywhere in the code (I grepped for them).
- **Rendering or mock-browser UI:** none. It is a JSON HTTP API only (`server.rs`, three routes under `/v1`).
- **Agent loop and state:** four fixed strategies.
  - `human`: pick a result, extract, check whether it's enough, repeat.
  - `parallel` and `sequential`: visit every result, in parallel or one by one.
  - `parallel_tree`: the LLM sorts results into dependency "levels" and each level runs in parallel (`agent_search/parallel_tree.rs`).
  
  State lives only in memory: an `AnalysisDocument` holding the content plus the visited and unvisited lists. There is no persistence, checkpointing, resume or leasing.
- **Security:** none. There is no credential handling. Untrusted page HTML goes straight into prompts with no delimiting and no injection guard (`agent_search.rs::visit_and_extract_relevant_info`). URLs are fetched with no SSRF protection. The compose file hardcodes Langfuse secrets and defaults the proxy key to `sk-1234`. One good habit: containers use `cap_drop: ALL`.

### 3. What we could borrow, module by module
- **Browser provider:** nothing. The UA and header spoofing in `webpage_parse.rs` is the opposite of our real-Chromium approach.
- **`read_page` representation:** this is the one useful idea. `WHITELISTED_ATTRIBUTES` in `webpage_parse.rs` is a small, sensible list of attributes to keep (`aria-label`, `role`, `alt`, `title`, `href`, `name`, `type`, `data-label`). We could use it as the allowlist for a compact interactive-element view that `read_page` builds in the page. Its blank-line squeeze (`utils.rs::enforce_n_sequential_newlines`) is trivial to rewrite in TypeScript. Its tag *blacklist* is not suitable for faithful capture: it throws away figures, emphasis and images.
- **Action execution:** nothing.
- **Capture fidelity:** this is a counter-example. `scrape_site.rs::format_result_md` has gpt-4o *rewrite* each page into Markdown. That breaks D15 ("never model rewrites"). Our Defuddle-plus-verify pipeline is the right call.
- **Live view and mock browser:** nothing.
- **Agent loop:** two minor patterns.
  1. The sentinel `USE_SAME_WEB_SEARCH_FINDINGS_DOCUMENT` (`prompts.rs`) lets the model say "no change" instead of re-emitting a large document, which saves tokens on no-op steps. Our equivalent would be a typed `{ unchanged: true }` result from a tool.
  2. Running independent page visits in parallel with a concurrency cap (`scrape_site.rs`, `buffer_unordered(max_concurrency)`), which suits batch note capture across several URLs.
  
  Its separate "sufficiency check" LLM call after every step costs an extra round trip each time. If we want a stopping check, it should go inside the main turn as a structured field.

### 4. Dependency, vendoring or ideas only
- **Dependency:** no. It's in the wrong language (Rust against our TypeScript-first stack), it adds about five services (SearXNG, Valkey, Caddy, LiteLLM, Langfuse), it is unmaintained, and it solves a different problem (search) from ours (driving a browser).
- **Vendoring:** no. **AGPL-3.0 is copyleft with a network clause.** Copying its code into a web app we deploy could oblige us to publish our source to users. Even a small amount of copying is risky, and the useful parts are each about 20 lines.
- **Ideas:** yes, but only the few above, rewritten from scratch in TypeScript. Re-implementing an attribute list or a sentinel pattern is fine; copying the code is not.

### 5. Risks and gaps if anyone still considered it
- **Bugs:**
  - `human.rs` pushes *visited* results into `analysis.unvisited_results`.
  - `unvisited_results.remove(next_index)` has no bounds check, so an out-of-range index from the model panics the task.
  - `parallel_tree.rs::construct_dependency_tree` uses plain `serde_json::from_str`, but its prompt asks for a fenced code block containing JSON with `//` comments, so parsing will usually fail.
  - `llm_proxy_api_key()` calls `unwrap()` on an environment variable.
- **Gaps:**
  - No JavaScript rendering, so single-page apps, logged-in pages, PDFs and video are all out of reach.
  - Image `src` is stripped, so visual fidelity is lost.
  - Every page is fully LLM-rewritten.
  - No tests, no state persistence, no human approval, no injection defenses.
- **Licence:** the AGPL is a legal hazard for any code reuse.

**Recommendation:** treat it as reference reading only. Skip it for every module except `read_page`. There, re-implement its attribute allowlist idea in TypeScript inside our own extractor, and keep an eye on its "unchanged" sentinel for the loop. Nothing in it changes the approved §1–§4 or §6 decisions.

The clone is in the scratchpad, outside our repo: `/private/tmp/claude-501/-Users-sethvin-nanayakkara-orca-workspaces-MasterTutor-houndshark/da9cab1f-0477-48e7-b492-c59001c21006/scratchpad/web-browser/`. The files cited above are under `server/src/` in that folder.
