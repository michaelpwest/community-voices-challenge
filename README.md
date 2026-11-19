# Community Voices

A local-first demonstration of Retrieval-Augmented Generation (RAG) for weekly community reporting.

> **Status:** Milestone 1 (foundation) is in place: the launcher, API, and web UI start and report setup status. Feed ingestion, embeddings, and reports are not implemented yet.

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
6. Open `http://localhost:3000` to see setup status. Ingestion and reports are not implemented yet.

The launcher never installs software. If Ollama is not running or a model is missing, it explains what to do and asks before starting Ollama or downloading a model. Its menu offers feed refresh, system status, clearing local data (after typing `DELETE`), and quit. On exit it stops only the processes it started; an Ollama server that was already running is left alone.

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
