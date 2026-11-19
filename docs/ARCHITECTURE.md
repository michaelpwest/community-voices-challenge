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
| Web UI | Responsive display of reports, supporting links, comparison, and status |

## Proposed endpoints

- `GET /api/health` — status of the API, database, and Ollama dependency
- `POST /api/ingest` — request a feed refresh
- `POST /api/reports/generate` — generate both report variants
- `GET /api/reports/latest` — latest report and its metadata
- `GET /api/reports/compare` — baseline/RAG outputs and evaluation

## Minimum data model

**discussion:** stable external ID, community, title/body, source URL, posted timestamp, fetched timestamp.

**embedding:** discussion ID/chunk ID, embedding vector, model name, chunk text/hash, created timestamp.

**report_run:** period start/end, model/prompt/settings, generated timestamp, baseline report, RAG report, cited source IDs, evaluation notes.

Exact schemas and migrations will be established during implementation.

## Ingestion design

- Source: Lemmy public API for `games` on lemmy.world (D-005). Fetch posts with `/api/v3/post/list` (sort `New`, paginate until older than the window), then comments per post with `/api/v3/comment/list`.
- Rate-limit requests and send a descriptive user-agent.
- Manual refresh only (D-008): ingestion runs when triggered from the launcher, web UI, or `POST /api/ingest`. No background scheduler; the requirement is **automated ingestion**, not an always-on scheduler.
- Upsert based on stable external IDs; avoid repeatedly embedding unchanged text.
- Keep source URL and posted-at timestamps for each discussion.
- Tests use a small labeled offline fixture in the Lemmy response shape (D-004), so parsing, normalization, and deduplication are tested without network access. The fixture is never loaded into the app database.
- Bound the number of posts/chunks to fit the LLM's context window; document selection rules.

## Retrieval design

1. Select discussions in the past-week period.
2. Generate embeddings for retrieval queries using the same embedding model as stored vectors.
3. Retrieve top-k relevant posts/chunks, optionally diversify and deduplicate results.
4. Pass a bounded, clearly delimited evidence bundle with URLs/IDs to the local LLM.
5. Require summary claims to rely on retrieved evidence; label forecasts as predictions.

**Important:** Semantic top-k retrieval alone may miss broad community themes; consider combining it with engagement/recency sampling or per-topic aggregation if the initial output is skewed.

## Fair baseline vs. RAG comparison

Use the **same model**, report period, instruction template, and temperature/settings. The baseline gets no retrieved posts; the RAG run gets a traceable evidence bundle. Show the difference in specificity, verifiable references, and unsupported claims. Record model/version and retrieval parameters so results can be explained.

## Local process model

- Web: `localhost:3000` (Vite dev server; forwards `/api` requests to the API) (D-009)
- API: `localhost:3001` (Hono; listens on the loopback interface only)
- Ollama: configurable URL, default `http://localhost:11434`; models `llama3.1:8b` (generation, explicit `num_ctx`) and `nomic-embed-text` (embeddings, with `search_document:`/`search_query:` prefixes) per D-007
- Database: local SQLite file with the sqlite-vec extension; no separate server
- `npm start` orchestrates checks and starts only the processes it owns; the CLI can trigger ingestion and graceful exit.
- The launcher asks its child processes to stop over a Node IPC channel. The API and web processes also stop on their own if the launcher disappears, so a killed launcher does not leave them running.

## Known risks

- Reviewer hardware may not support a large local model; favor a small model and document requirements.
- First-run model downloads may be substantial; provide explicit instructions and progress.
- lemmy.world may be slow or unavailable, and the offline fixture covers tests only (D-004); the demo fails without the live feed, so surface clear errors and document the dependency.
- A week of comments (~1,400 measured) far exceeds a small model's context; comment selection and retrieval bounds are required.
- sqlite-vec is a native extension; verify it installs on macOS, Linux, and Windows.
- LLM predictions are uncertain; avoid presenting them as confirmed future events.
- A full mobile app would add setup complexity; use a mobile-responsive web UI for MVP.
