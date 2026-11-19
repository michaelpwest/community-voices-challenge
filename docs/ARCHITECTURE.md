# Community Voices — Proposed Architecture

> Draft architecture, not an assertion that these components have been implemented.

## Overview

A local-first, responsive web app consumes a TypeScript backend API. The backend ingests community discussions, generates local embeddings through Ollama, retrieves relevant discussions using vector search, and generates two versions of the same weekly report.

```text
       Permitted community source (live feed)
                      |
                      v
               Ingestion service
                      | normalize, dedupe, timestamps
                      v
        Local vector store (SQLite + sqlite-vec)
              (texts + metadata + embeddings)
                      ^
                      | top-k search, date filter
                      v
               Report generation API
                /                 \
    Baseline: same LLM          RAG: same LLM
      no retrieved posts       + retrieved evidence
                \                 /
                 -> A/B comparison <-
                          |
                  Responsive web UI
```

## Planned components

| Component | Responsibility |
| --- | --- |
| Launcher | Dependency checks, Ollama URL configuration, child-process lifecycle, optional manual actions |
| Ingestion service | Fetch permitted posts, normalize, deduplicate, paginate, record provenance |
| Embedding service | Call local Ollama embeddings endpoint and persist embedding metadata |
| Vector storage | Store posts/chunks and search vectors with recency restrictions |
| Report service | Build prompts and generate baseline/RAG reports with the same LLM |
| API | Health, ingestion trigger, latest reports, report generation, comparisons |
| Web UI | Responsive display of reports, supporting links, comparison, and status; buttons to refresh the feed and generate reports. It polls the report job while one is running, including one started from the launcher. |

## Proposed endpoints

- `GET /api/health` — status of the API, database, and Ollama dependency
- `POST /api/ingest` — run a feed refresh and return a summary (502 if the source cannot be read, 409 if one is already running)
- `GET /api/search?q=...&k=5` — the stored discussions most similar to a query within the past seven days, with source links
- `POST /api/reports/generate` — start generating both report variants in the background (202; 409 if already running)
- `GET /api/reports/status` — state of that job: idle, running (with the current step), succeeded, or failed (with the reason)
- `GET /api/reports/latest` — the latest stored run: both reports, the evidence given to the RAG run, shared settings, and the comparison (404 before the first run)

## Minimum data model

**discussion:** stable external ID, kind (post or comment), community, parent post ID, title/body, author, source URL, linked article URL, score, posted timestamp, fetched timestamp, content hash.

**embedding:** discussion ID, embedding vector, model name, content hash of the embedded text, dimensions, created timestamp. One per discussion; no chunks (D-010).

**ingestion_run:** finished timestamp and the run summary (window, counts, any embedding error).

**report_run:** period start/end, model/prompt/settings, generated timestamp, baseline report, RAG report, cited source IDs, evaluation notes.

All four tables are defined in `src/storage/schema.ts`. A report_run is stored as one JSON document that also holds the evidence passages (label, source URL, excerpt, and how each was selected).

## Ingestion design

- Source: Lemmy public API for `games` on lemmy.world (D-005). Fetch posts with `/api/v3/post/list` (sort `New`, paginate until older than the window), then comments per post with `/api/v3/comment/list`.
- Rate-limit requests and send a descriptive user-agent.
- Manual refresh only (D-008): ingestion runs when triggered from the launcher, web UI, or `POST /api/ingest`. No background scheduler; the requirement is **automated ingestion**, not an always-on scheduler.
- Upsert based on stable external IDs; avoid repeatedly embedding unchanged text.
- Keep source URL and posted-at timestamps for each discussion.
- Tests use a small labeled offline fixture in the Lemmy response shape (D-004), so parsing, normalization, and deduplication are tested without network access. The fixture is never loaded into the app database.
- Bound the number of posts/chunks to fit the LLM's context window; document selection rules. The ingestion rules (which posts and comments are kept, what is skipped, pacing, and retries) are recorded in D-010.
- If Ollama is unavailable during a refresh, the fetched discussions are still stored and the summary reports the embedding error; the next refresh embeds whatever is pending.

## Retrieval design

1. Select discussions in the past-week period.
2. Generate embeddings for retrieval queries using the same embedding model as stored vectors.
3. Retrieve top-k relevant posts/chunks, optionally diversify and deduplicate results.
4. Pass a bounded, clearly delimited evidence bundle with URLs/IDs to the local LLM.
5. Require summary claims to rely on retrieved evidence; label forecasts as predictions.

**Important:** Semantic top-k retrieval alone may miss broad community themes, so report evidence combines it with the week's highest-scored posts and their top comments (D-011). The code is in `src/reports/`: evidence selection, prompt, schema, citation checking, and comparison are separate modules.

## Fair baseline vs. RAG comparison

Use the **same model**, report period, instruction template, and temperature/settings. The baseline gets no retrieved posts; the RAG run gets a traceable evidence bundle. Show the difference in specificity, verifiable references, and unsupported claims. Record model/version and retrieval parameters so results can be explained.

## Local process model

- Web: `localhost:3000` (Vite dev server; forwards `/api` requests to the API) (D-009)
- API: `localhost:3001` (Hono; listens on the loopback interface only)
- Ollama: configurable URL, default `http://localhost:11434`; models `llama3.1:8b` (generation, explicit `num_ctx`) and `nomic-embed-text` (embeddings, with `search_document:`/`search_query:` prefixes) per D-007
- Database: local SQLite file with the sqlite-vec extension; no separate server
- `npm start` orchestrates checks and starts only the processes it owns; the CLI can trigger ingestion and graceful exit.
- The API has no login, so it accepts requests only when the `Host` and `Origin` headers name this computer's own API or web port. That keeps other websites open in the same browser from triggering refreshes or reading data.
- A feed refresh and a report generation never run at the same time; the second request is refused with 409.
- The launcher asks its child processes to stop over a Node IPC channel. The API and web processes also stop on their own if the launcher disappears, so a killed launcher does not leave them running.

## Known risks

- Reviewer hardware may not support a large local model; favor a small model and document requirements.
- First-run model downloads may be substantial; provide explicit instructions and progress.
- lemmy.world may be slow or unavailable, and the offline fixture covers tests only (D-004); the demo fails without the live feed, so surface clear errors and document the dependency.
- A week of comments (~1,400 measured) far exceeds a small model's context; comment selection and retrieval bounds are required.
- sqlite-vec is a native extension; verify it installs on macOS, Linux, and Windows.
- LLM predictions are uncertain; avoid presenting them as confirmed future events.
- A full mobile app would add setup complexity; use a mobile-responsive web UI for MVP.
