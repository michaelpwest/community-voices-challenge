# Community Voices

A local-first demonstration of Retrieval-Augmented Generation (RAG) for weekly community reporting.

> **Status:** Milestones 1 to 3 are in place: the launcher, API, and web UI start; the past week of the community can be ingested, embedded, and searched; and the baseline and RAG reports can be generated and compared from the launcher or the API. Showing the reports in the web UI is not implemented yet.

## Challenge

Choose an active online community, automatically ingest its recent discussions, and generate a **Community Voices Document** that summarizes the past week and predicts the next week's topics. Compare a baseline LLM report with a RAG-grounded report.

The challenge allows any frontend/backend tools and suggests keeping the effort to a couple of hours or less.

## Proposed MVP

- One community: [games on lemmy.world](https://lemmy.world/c/games), ingested through Lemmy's public API (no account or key required).
- Repeatable ingestion of recent posts, deduplicated and timestamped.
- Locally generated embeddings stored in a searchable vector store.
- Two reports from the **same local LLM**, using the same prompt and generation settings: baseline without retrieval and RAG with retrieved evidence.
- A responsive web UI showing summaries, predictions, source references, and a side-by-side comparison.

## Stack

- TypeScript on Node.js 22.13 or newer; API built with Hono
- Responsive React web UI served by Vite (mobile-friendly; native mobile app is out of scope for MVP)
- Ollama for local text generation (`llama3.1:8b`) and embeddings (`nomic-embed-text`), both configurable
- SQLite (Node's built-in `node:sqlite`) + sqlite-vec for local storage and vector similarity search, with no separate database server required
- A single root `npm start` launcher for local development/demo

## Getting started

So far these steps have been run on Windows 11 with Node.js 26 only.

1. Install Node.js 22.13 or newer.
2. Install and start [Ollama](https://ollama.com/download), then pull the models: `ollama pull llama3.1:8b` and `ollama pull nomic-embed-text`. To use an Ollama server on another machine, set `OLLAMA_URL` in `.env` instead.
3. Clone the repository and run `npm install`.
4. Optional: copy `.env.example` to `.env` to change ports, models, or URLs (never commit `.env`). Defaults are used when `.env` is absent.
5. Run `npm start`. The launcher checks Ollama and the models, then starts the API on `http://localhost:3001` and the web UI on `http://localhost:3000`.
6. Choose **Refresh feed** in the launcher menu (or run `curl -X POST http://localhost:3001/api/ingest`). This reads the past week of posts and their top comments from lemmy.world and embeds them; it needs internet access and took about a minute in testing. Running it again adds no duplicates.
7. Choose **Generate reports** in the launcher menu. The same local model writes two reports for the past week: a baseline with no retrieved posts, and a RAG report grounded in retrieved posts and comments. The launcher prints both sets of themes and predictions and a short comparison. This took about 16 seconds on a desktop GPU and will take longer on a CPU.
8. Read the full result at `http://localhost:3001/api/reports/latest`: both reports, the evidence passages with their source links, the settings shared by both runs, and the comparison metrics.
9. Open `http://localhost:3000` to see setup status and how much data is stored. The reports are not shown there yet.
10. Optional: try retrieval directly, for example `http://localhost:3001/api/search?q=studio+layoffs&k=5`. Results come only from the past seven days and include a link to each source post or comment.

The launcher never installs software. If Ollama is not running or a model is missing, it explains what to do and asks before starting Ollama or downloading a model. Its menu offers feed refresh, system status, clearing local data (after typing `DELETE`), and quit. On exit it stops only the processes it started; an Ollama server that was already running is left alone.

### What gets ingested

- Every post from the past seven days, plus each post's 10 highest-scored comments (`LEMMY_COMMENTS_PER_POST` in `.env`).
- Deleted or removed items, bot comments, and blank comments are skipped.
- Requests are made one at a time with a pause between them and an identifying user-agent (`LEMMY_USER_AGENT`).
- If lemmy.world cannot be reached, the refresh fails with a message saying so and existing data is left as it was. There is no offline sample data in the app; the synthetic fixture under `src/sources/lemmy/fixtures/` is used by tests only.

The full rules and their trade-offs are in decision D-010 in the [decision log](docs/DECISIONS.md).

### How the two reports are compared

- **Same everything except evidence:** both runs use the same model, instructions, report period, and sampling settings. The RAG run is given retrieved posts and comments; the baseline is told none were retrieved.
- **Baseline is general knowledge:** it comes from what the model already knew, so it is labeled as unverified and should not be read as this week's activity.
- **Citations are checked:** the RAG report cites evidence by label (`S1`, `S2`, ...), and each label maps to a source link. A cited label that matches no evidence is removed and counted.
- **Predictions are forecasts:** each has a rationale and a low, medium, or high confidence, and is never presented as something that happened.
- **Comparison metrics are rough:** they count citations and check whether the names and numbers in each report appear in the week's stored discussions. They indicate grounding; they do not grade writing quality.

Details and trade-offs are in decision D-011 in the [decision log](docs/DECISIONS.md).

### Other commands

| Command | Purpose |
| --- | --- |
| `npm run api` | Start only the API |
| `npm run web` | Start only the web UI |
| `npm test` | Run the tests (no Ollama or internet needed) |
| `npm run lint` | Lint the code |
| `npm run typecheck` | Type-check the server and web code |

**Reviewer requirement:** Before submission, complete this section with ingestion and report instructions and troubleshooting, and re-test it from a clean clone.

## What to examine

- The ingestion and deduplication flow
- The embedding and vector retrieval implementation
- Evidence cited in the RAG report
- A/B results and the evaluation notes
- Tests and clean separation of responsibilities

## Documentation

- [Implementation plan](docs/PLAN.md)
- [Coding agent guidelines](AGENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decision log](docs/DECISIONS.md)

## Submission checklist

- [ ] Clone-tested on a clean environment
- [ ] No committed credentials or personal data
- [ ] `npm start` and README steps verified
- [ ] Live ingestion works, and feed failures produce clear errors
- [ ] Baseline/RAG reports and comparison can be reproduced
- [ ] Tests run successfully
- [ ] Public GitHub repository link ready to send
