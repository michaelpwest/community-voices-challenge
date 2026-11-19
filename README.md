# Community Voices

A local-first demonstration of Retrieval-Augmented Generation (RAG) for weekly community reporting.

> **Status:** Planning / initial implementation. This README describes the intended workflow and is subject to change and verification before submission.

## Challenge

Choose an active online community, automatically ingest its recent discussions, and generate a **Community Voices Document** that summarizes the past week and predicts the next week's topics. Compare a baseline LLM report with a RAG-grounded report.

The challenge allows any frontend/backend tools and suggests keeping the effort to a couple of hours or less.

## Proposed MVP

- One community: [games on lemmy.world](https://lemmy.world/c/games), ingested through Lemmy's public API (no account or key required).
- Repeatable ingestion of recent posts, deduplicated and timestamped.
- Locally generated embeddings stored in a searchable vector store.
- Two reports from the **same local LLM**, using the same prompt and generation settings: baseline without retrieval and RAG with retrieved evidence.
- A responsive web UI showing summaries, predictions, source references, and a side-by-side comparison.

## Proposed stack (subject to validation)

- TypeScript / Node.js API
- Responsive React-based web UI (mobile-friendly; native mobile app is out of scope for MVP)
- Ollama for local text generation (`llama3.1:8b`) and embeddings (`nomic-embed-text`), both configurable
- SQLite + sqlite-vec for lightweight local storage and vector similarity search, with no separate database server required
- A single root `npm start` launcher for local development/demo

## Getting started

_Not implemented yet. These are the intended reviewer steps._

1. Install Node.js.
2. Install/start Ollama, or provide the URL of an existing Ollama server, then pull the models: `ollama pull llama3.1:8b` and `ollama pull nomic-embed-text`.
3. Clone the repository and run `npm install`.
4. Copy `.env.example` to `.env` and configure as needed (never commit `.env`).
5. Run `npm start` to launch the web UI (planned `http://localhost:3000`) and API (planned `http://localhost:3001`).
6. Ingest live community discussions (requires internet access), generate the baseline and RAG reports, and compare them.

**Reviewer requirement:** Before submission, replace this section with exact, fully tested instructions including model download commands, database initialization, ports, ingestion instructions, and troubleshooting.

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
