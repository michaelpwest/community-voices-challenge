# Community Voices — Implementation Plan

## Goal

Build the smallest useful local-first application that ingests recent discussions from one active community and produces a weekly report covering **the past week** and **predictions for the coming week**. Demonstrate the effect of retrieval by comparing the same local LLM with and without RAG.

## Scope and constraints

- Target a compact coding-challenge MVP, not a production SaaS platform.
- Implement one supported community before generalizing.
- Reviewer must be able to clone, set up, and demo locally using the README.
- Use local Ollama models for LLM generation and embeddings; internet is needed for initial downloads and live ingestion.
- Avoid requiring a paid LLM API.
- A small labeled offline fixture supports automated tests (D-004); the demo still depends on the live community feed, so feed failures must produce clear errors.
- Keep credentials out of Git and avoid scraping against source terms or rate limits.

## Decisions to confirm before coding

- [x] Community and compliant ingestion method: `games` on lemmy.world via Lemmy's public API (D-005)
- [x] LLM and embedding models: `llama3.1:8b` and `nomic-embed-text`, configurable via `.env` (D-007)
- [x] Vector store: SQLite + sqlite-vec (D-006)
- [x] Frontend: responsive web app, not native mobile for this exercise (D-002)
- [x] Local AI: Ollama for generation and embeddings (D-001)
- [x] Same model and settings for baseline and RAG (D-003)
- [x] Small labeled offline fixture for tests, alongside live ingestion (D-004)
- [x] Ingestion and reports run on demand only; no scheduler (D-008)

## MVP acceptance criteria

- [x] A repeatable command/API operation ingests recent community discussions and prevents duplicates.
- [x] Documents include source URL, author/identifier when permitted, posted timestamp, and content.
- [x] The system generates and persists embeddings and can retrieve top-k relevant discussions using vector similarity, with a recent-date filter.
- [x] RAG generation uses retrieved evidence, produces a past-week summary and next-week predictions, and cites source posts.
- [x] Baseline generation uses the **same LLM, task prompt, time range, and sampling settings** without retrieved community evidence.
- [x] Comparison UI shows both outputs and a short evidence-based evaluation (specificity, citations, unsupported claims).
- [x] All app components can be launched and stopped locally, with useful errors for missing services.
- [x] Setup, limitations, and tests are documented and verified.

## Milestone 1 — Minimal foundation

- [x] Initialize TypeScript workspace, API, responsive web UI, lint/test tooling.
- [x] Add `.env.example` for URLs, model names, DB configuration, and source configuration.
- [x] Implement `npm start` launcher: detect Ollama, validate prerequisites, start API on `:3001` and web on `:3000`.
- [x] Support a configured Ollama URL; offer guided setup rather than silently installing software.
- [ ] Add launcher actions: refresh feed, clear data **with confirmation**, system status, graceful exit. _Implemented and unit-tested; the menu and Ctrl+C still need a manual check in a real terminal. Refresh feed reports "not implemented" until Milestone 2._
- [x] Ensure API and web can also start independently for testing/automation.

**Done when:** a fresh clone can start the UI/API after documented prerequisites, and the launcher handles Ctrl+C without killing pre-existing Ollama services.

## Milestone 2 — Data ingestion and embeddings

- [x] Define a data-source interface and implement it for Lemmy `games` on lemmy.world (D-005).
- [x] Fetch the past week's posts and their comments with pagination, rate limiting, a descriptive user-agent, and error handling.
- [x] Select comments to keep within context limits (e.g. top-scored per post) and document the rule. _Top 10 by score per post, configurable (D-010)._
- [x] Normalize text, timestamps, canonical URLs, and stable IDs; deduplicate/upsert.
- [x] Add a small labeled offline fixture in the Lemmy response shape for tests (D-004); never load it into the app database.
- [x] Chunk only if needed, compute embeddings through Ollama, and store them. _No chunking needed; one embedding per post or comment (D-010)._
- [x] Implement semantic top-k retrieval with a seven-day window and source metadata.

**Done when:** a repeat ingestion does not duplicate records and relevant posts can be retrieved with usable source links.

## Milestone 3 — Report generation and A/B comparison

- [x] Define the report schema: themes, supporting discussions, prior-week summary, next-week predictions, limitations.
- [x] Implement baseline generation without retrieved community posts.
- [x] Implement RAG generation using retrieved passages with traceable source IDs/URLs.
- [x] Keep model, instructions, generation settings, and report time window consistent across both variants.
- [x] Store generated report, retrieval metadata, and run configuration for repeatability.
- [x] Add simple qualitative comparison: relevance, factual grounding, citations, unsupported claims. _Automatic text checks, not a judged score (D-011)._

**Done when:** the app shows meaningful differences attributable to retrieved evidence; the RAG output does not claim unsupported certainty about future trends.

## Milestone 4 — Usable demo UI

- [x] Show the selected community, report period, and last ingestion time.
- [x] Display previous-week themes and next-week predictions.
- [x] Provide baseline/RAG side-by-side views and clickable supporting source URLs.
- [x] Provide actionable loading/error/empty states and refresh status.
- [x] Test mobile-width layout. _Checked in headless Edge at 390 px and 1280 px; not yet on a real phone._

**Done when:** a reviewer can launch the app and demonstrate the assignment from the browser without reading source code.

## Milestone 5 — Verification and submission

- [x] Unit tests for normalization/deduplication, retrieval/date filtering, prompt construction, and response validation, using the offline fixture (D-004).
- [x] Verify a complete run using live data. _From a clean copy on Windows: `npm install`, `npm start`, then refresh and generate through the browser._
- [x] Review code for compact functions, clear names, error handling, and unnecessary complexity. _No unused code or leftover markers found. Fixes: refresh and report generation can no longer overlap; the page notes when a report is older than the data._
- [x] Update README with **actual** prerequisite and startup commands.
- [x] Check security and licensing constraints; ensure `.env` is excluded. _No secrets tracked, `npm audit` clean, dependencies under permissive licenses. Added: the API refuses requests from other websites. Open: the repository has no license file._
- [ ] Commit meaningful working increments and send public repo as submission. _Milestones 1 to 4 are committed and pushed; Milestone 5 changes and the submission itself remain._

**Done when:** the README works from a clean clone and explains exactly how to reproduce the A/B comparison.

### Submission checklist

- [x] Clone-tested: a fresh clone of the public repository installs and passes all tests on Windows and on Ubuntu 22.04.
- [x] No committed credentials or personal data. The test fixture is synthetic.
- [x] `npm start` and the README steps verified on Windows 11. On Ubuntu, startup and shutdown were verified without Ollama. macOS is untested.
- [x] Live ingestion works, and feed failures produce clear errors.
- [x] Baseline/RAG reports and comparison can be reproduced.
- [x] Tests run successfully.
- [ ] Interactive launcher menu and Ctrl+C confirmed in a real terminal (see Milestone 1).
- [ ] Proposed decisions D-009, D-010, and D-011 confirmed.
- [ ] Final commit pushed and repository link sent.

## Milestone 6 — Optional items from the brief

- [x] Keep stats on which embeddings are retrieved most: a counter per discussion, raised each time similarity search returns it, shown as a "Most retrieved discussions" table (D-012).
- [x] Show a flattened visualization of the embeddings: the week's embeddings projected to two dimensions and drawn as a scatter plot with hover details, a legend, and a table view (D-012).

**Done when:** both are visible in the web UI after a feed refresh and a report run. _Checked in headless Edge at 1280 px and 390 px._

## Deferred

- Multiple communities and advanced scheduling
- Native mobile client
- Authentication, deployment automation, production observability

## Working process with AI

1. Work on **one unchecked task** or tightly related task group at a time.
2. Before implementing, state files to change and tests to add.
3. Implement only the current scope; avoid unnecessary abstractions.
4. Run checks; inspect actual outputs and fix failures.
5. Update this plan's checkboxes only after verification.
6. Commit coherent, tested features with descriptive messages.

## Open questions

- Does `llama3.1:8b` produce good enough reports, or should we switch to `qwen3:8b` (D-007)? Its reports are usable but it sometimes ignores the confidence rule and its predictions mostly restate the week's themes.
- Should predictions that claim high confidence without a source be downgraded automatically, or only flagged as they are now (D-011)?
