# Community Voices — Decision Log

Record meaningful decisions briefly, with the alternatives, rationale, and trade-offs. Entries marked **proposed** should be confirmed before implementation.

## D-001 — Local-first AI

**Choice:** Use Ollama for both report generation and embeddings.

**Alternatives:** Hosted LLM/embedding APIs.

**Why:** Avoid paid hosted LLM dependencies and demonstrate a complete local RAG pipeline.

**Trade-off:** Reviewers must have sufficient hardware and download models; setup instructions and error handling are essential.

## D-002 — Responsive web over native mobile

**Choice:** Deliver a responsive web UI on `localhost:3000` backed by an API on `localhost:3001`.

**Alternatives:** Native mobile app.

**Why:** The challenge allows a web or mobile app; a web demo is easier for reviewers to clone and run.

**Trade-off:** No native-device features in the MVP. The API can support a native client later.

## D-003 — Same model for baseline and RAG

**Choice:** Use the same LLM, prompt instructions, report period, and generation settings in both paths, varying only retrieved evidence.

**Why:** Makes the A/B comparison interpretable.

**Trade-off:** Baseline output may be generic, which is a useful observed result rather than a flaw to hide.

## D-004 — Small labeled offline fixture for tests, alongside live ingestion

**Choice:** Keep a small, clearly labeled offline fixture in the repository for automated tests. The app itself still ingests only from the live community source; the fixture is never loaded into the app database or shown as community activity.

**Alternatives:**
- No bundled sample data at all: tests for normalization, deduplication, and retrieval would depend on lemmy.world being reachable and on whatever was posted that week.
- A fixture that also serves as an offline demo fallback: more to build and label in the UI, and it risks sample data being mistaken for real weekly activity.

**Why:** Tests need stable, repeatable input that works offline. A fixture in the Lemmy response shape exercises the same parsing and normalization code as live ingestion.

**Trade-off:** The fixture must be kept in step with the Lemmy response shape and stay small. The demo still requires internet access and a working source feed during review; feed failures must produce clear errors, and the README must explain the dependency.

## D-005 — Community: games on Lemmy (lemmy.world)

**Choice:** Ingest posts and comments from the `games` community on lemmy.world (`https://lemmy.world/c/games`) through Lemmy's public JSON API (`/api/v3/post/list`, `/api/v3/comment/list`). No account or API key is required.

**Why:** Open, permitted API that a reviewer can use from a fresh clone; a full week can be fetched on demand. Activity measured on for the prior 7 days: 47 posts, 1,439 comments, 31 distinct posters. Topics follow release and event calendars, so predictions have something concrete to draw from.

**Trade-off:**
- Comment volume exceeds a small local model's context, so comments must be selected (e.g. top-scored per post) and retrieved rather than passed whole.
- One comment request per post per ingest; requests must be rate-limited and send an identifying user-agent.
- The demo depends on lemmy.world being reachable; the offline fixture is for tests only (D-004).

## D-006 — SQLite + sqlite-vec for storage and vector search

**Choice:** Store discussions, embeddings, and report runs in a local SQLite file, using sqlite-vec for vector similarity search.

**Alternatives:** PostgreSQL with pgvector.

**Why:** No separate database server or container for reviewers to install; a single file is easy to create, inspect, and reset.

**Trade-off:** Less suited to concurrent writers or large datasets, which the MVP does not need. sqlite-vec is a native extension, so installation must be verified on the target platforms.

## D-007 — Ollama models: llama3.1:8b and nomic-embed-text

**Choice:**
- Report generation (baseline and RAG): `llama3.1:8b`.
- Embeddings: `nomic-embed-text`.
- Both are configurable in `.env` (`OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`); the model names are recorded with each report run.

**Alternatives:**
- `qwen3:8b`: often rated stronger at structured output, but its thinking mode must be disabled (`think: false`) for consistent, fast output. Kept as the first alternative if report quality is weak.
- `llama3.2:3b`: smaller fallback for reviewers with ~8 GB RAM.
- Larger models (e.g. `gemma3:12b`): tighter fit on 16 GB machines alongside the app and a browser.

**Why:**
- `llama3.1:8b` needs ~5 GB, fits 16 GB machines, supports a long context, and follows citation and labeling instructions reliably. It is the most commonly recommended default for this hardware class.
- `nomic-embed-text` is small (~300 MB), fast, and widely used for local RAG.

**Trade-off / implementation notes:**
- Ollama's default context window is small and silently truncates input. Set `num_ctx` explicitly (e.g. 16384) on every generation call, identically for baseline and RAG (D-003).
- `nomic-embed-text` requires task prefixes: `search_document: ` for stored posts/comments and `search_query: ` for retrieval queries.
- Selection is based on general rankings, not a test on this project's data. Compare `llama3.1:8b` and `qwen3:8b` on one week of ingested data once ingestion works.

## D-008 — Manual ingestion only

**Choice:** Ingestion and report generation run only when requested, from the launcher's refresh action, the web UI, or `POST /api/ingest`. No background scheduler.

**Alternatives:** Optional periodic refresh (e.g. hourly polling).

**Why:** The Lemmy API can fetch a full week on demand (D-005), so polling isn't needed to build up history. A scheduler would add process lifecycle and failure handling with no MVP benefit. The challenge requires automated ingestion, which a single refresh action satisfies; it doesn't require an always-on scheduler.

**Trade-off:** Data is only as fresh as the last manual refresh; the UI must show the last ingestion time. Scheduling stays on the deferred list.

## D-009 — Application tooling (proposed)

Chosen while building Milestone 1; confirm or change.

**Choice:**
- One npm package (no workspaces): server code in `src/`, web UI in `web/`.
- API: Hono on `@hono/node-server`.
- Web UI: React with the Vite dev server, which proxies `/api` to the API.
- SQLite driver: Node's built-in `node:sqlite`, loading the sqlite-vec extension.
- TypeScript is run directly with `tsx`; there is no build step.
- Tests: Vitest. Lint: ESLint with typescript-eslint. Validation: zod.

**Alternatives:**
- Express or Fastify for the API: more familiar to some reviewers, but heavier, and Hono routes can be tested without opening a port.
- `better-sqlite3`: the most common driver, but it is a native module that needs a prebuilt binary or a compiler for the reviewer's Node version.
- Building the web UI and serving static files from the API: one process fewer, but adds a build step before the demo.

**Why:** Fewest moving parts for a reviewer: one `npm install`, no compile step, and no native module besides sqlite-vec's prebuilt extension.

**Trade-off:**
- Requires Node.js 22.13 or newer for `node:sqlite` extension loading; the launcher checks this.
- The demo runs on the Vite dev server, which is fine locally but is not a production setup.
- Loading sqlite-vec through `node:sqlite` is verified on Windows x64 with Node 26 only; macOS and Linux are untested.
