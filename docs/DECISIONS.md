# Community Voices — Decision Log

Record meaningful decisions briefly, with the alternatives, rationale, and trade-offs.

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

**Why:** Open, permitted API that a reviewer can use from a fresh clone; a full week can be fetched on demand. Activity measured over the 7 days before this decision: 47 posts, 1,439 comments, 31 distinct posters. Topics follow release and event calendars, so predictions have something concrete to draw from.

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

## D-009 — Application tooling

Chosen while building Milestone 1; confirm or change.

**Choice:**
- One npm package (no workspaces): server code in `src/`, web UI in `web/`.
- API: Hono on `@hono/node-server`.
- Web UI: React with the Vite dev server, which proxies `/api` to the API.
- Styling: Tailwind CSS (v4, through its Vite plugin). Utility classes live in the components; `web/src/styles.css` only defines the color names, each with a light and a dark value. This replaced a hand-written stylesheet of about 370 lines.
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
- Loading sqlite-vec through `node:sqlite` is verified on Windows x64 (Node 26) and Linux x64 (Ubuntu 22.04, Node 22); macOS is untested.
- On Node 22, `node:sqlite` prints an "experimental" warning. The launcher and `npm run api` suppress it.

## D-010 — Ingestion and retrieval rules

Chosen while building Milestone 2; confirm or change.

**Choice:**
- **Posts:** every post published in the past 168 hours, read from the "New" listing page by page until an ordinary post is older than the window. Old pinned posts are skipped without ending the walk.
- **Comments:** each post's 10 highest-scored comments from any thread depth (`LEMMY_COMMENTS_PER_POST`, 0–50).
- **Skipped:** deleted or removed items, comments by bot accounts, and blank comments.
- **Identity:** `lemmy:<instance>:<post|comment>:<id>`. Re-fetched items update the existing row; a content hash decides whether the text changed and needs a new embedding.
- **Links:** each item links to its page on the instance it was read from (`<instance>/post/<id>` or `<instance>/comment/<id>`).
- **Embeddings:** one vector per post or comment, no chunking. A comment is embedded with its post title for context. Text past 6,000 characters is left out of the embedding only.
- **Vector search:** vectors are stored in an ordinary table and ranked with sqlite-vec's `vec_distance_cosine`, comparing against every stored vector, filtered by community and time window.
- **Pacing:** one request at a time, at least 300 ms apart; timeouts, HTTP 429, and 5xx are retried up to three times, honoring `Retry-After`.
- **Test fixture:** hand-written and synthetic (D-004), in `src/sources/lemmy/fixtures/`.

**Alternatives:**
- All comments per post: about 1,400 a week, most of them low-signal, and several requests per busy post.
- Chunking long posts: adds a chunk table and merging of results for text that is almost always short here.
- A sqlite-vec `vec0` index table: faster on large collections, but it fixes the vector size at creation and complicates changing the embedding model.
- A fixture captured from real posts: more realistic, but it would republish real users' content in a public repository.

**Why:** A full refresh is about 50 requests and stores roughly 350 items (measured: 45 posts, 313 comments, 54 seconds including embedding; 15 seconds when nothing changed). At that size an exact search is instant and always correct.

**Trade-off:**
- New comments on posts older than a week are not picked up.
- Score-based selection favors early and popular comments; a late but important reply can be missed.
- Exact search would slow down with hundreds of thousands of vectors, far beyond one community's week.

## D-011 — Report generation and comparison

Chosen while building Milestone 3; confirm or change.

**Choice:**
- **One prompt for both runs:** the baseline and RAG runs use the same system message, report period, JSON schema, and sampling settings (temperature 0.2, seed 42, 2,500 output tokens, `OLLAMA_NUM_CTX`). Only the evidence section differs: retrieved passages for RAG, a "no posts were retrieved" line for the baseline.
- **Baseline behavior:** with no evidence, the model is told to write the full report from its general knowledge and to say so under limitations. The baseline is always labeled as unverified general knowledge.
- **Evidence for RAG (hybrid):** the week's 8 highest-scored posts with 2 top comments each, plus vector search (5 results each) for five broad queries covering releases, controversies, upcoming events, industry news, and recommendations. Merged, capped at 50 passages and 24,000 characters, and each passage records how it was selected.
- **Report shape:** summary, themes, predictions (each with rationale and low/medium/high confidence), and limitations. Themes and predictions carry source labels (`S1`, `S2`, ...). The model's output is constrained to this schema by Ollama and validated again on receipt.
- **Citation checking:** every cited label is checked against the evidence list. Labels that match nothing are removed from the report and reported separately.
- **Untrusted evidence:** passages sit inside a delimited section, are flattened to one line each, cannot contain the delimiter, and the prompt tells the model to ignore instructions inside them. Author names are not sent to the model.
- **Comparison:** automatic text checks applied identically to both reports: how many themes and predictions cite sources, how many distinct sources, how many "named terms" (capitalized names, acronyms, numbers) also appear in the week's stored discussions, and how many predictions claim high confidence.
- **Job model:** generation runs in the background; clients start it, poll a status route, and then fetch the stored run.

**Alternatives:**
- A baseline told to refuse without evidence: honest, but it produces an empty report and nothing to compare. Tried first and dropped.
- Similarity search alone: with broad queries it surfaced loosely related items and could miss the week's biggest thread.
- Top posts alone: no use of the vector store, and nothing beyond the most upvoted threads.
- A second LLM call to judge the reports: slower, and the judgment would itself be unverified.

**Why:** Measured on one week of `games` with `llama3.1:8b`: both reports generate in about 16 seconds on the development GPU. The RAG prompt used about 4,200 of 16,384 context tokens. The RAG report covered that week's actual threads with 22 distinct citations, while the baseline described topics that were not discussed.

**Trade-off:**
- The named-term check is a rough indicator: a term counts as found if the word appears anywhere in the week's discussions, so a wrong claim built from words that happen to be present is not caught.
- Evidence favors high-scoring threads, so the report reflects what was popular more than what was typical.
- The fixed seed reduces but does not remove run-to-run variation; two baseline runs differed while two RAG runs matched.
- The model does not always follow the confidence rule. High-confidence predictions are counted and flagged in the comparison, not corrected.

## D-012 — Retrieval statistics and embedding map

Chosen while building Milestone 6; confirm or change.

**Choice:**
- **What counts as a retrieval:** each time similarity search returns a discussion, its counter goes up by one. That covers the searches that gather report evidence and calls to the search API. Evidence chosen by score alone is not counted, because no embedding was retrieved.
- **Where it is stored:** one row per discussion with a count and the time of the last retrieval. Counts are all-time and are removed with "Clear data".
- **Flattening method:** principal component analysis (PCA), implemented directly with power iteration. The map's axes are the two directions along which the week's embeddings vary most.
- **What the map shows:** one dot per embedded post or comment from the past seven days. Color separates posts from comments; a larger dot was retrieved more often. Pointing near a dot shows its title, selecting it gives its link, and the same data is available as a table.
- **Where it is computed:** in the API on request, from the stored vectors. Nothing extra is stored.

**Alternatives:**
- t-SNE or UMAP: usually show clearer clusters, but need a library, have tuning settings, and give a different picture on each run unless seeded.
- Coloring dots by thread: more informative in principle, but a week has about 45 threads and a scatter plot stays readable with about three colors.
- Computing the projection in the browser: would send every 768-number vector to the page.

**Why:** PCA is deterministic, has no settings, needs no dependency, and takes about 70 ms for a week of data (398 vectors of 768 numbers). The counters cost one small write per retrieved result.

**Trade-off:**
- Two axes keep only about 12% of the variation in these embeddings, so the map is a rough guide. It did separate one large topic from the rest in testing, but nearby dots are not guaranteed to be similar.
- Counts favor whatever the five fixed evidence queries match, so they describe this app's retrieval more than the community's interests.
- The chart's two colors were checked for color-blind separation and contrast on both the light and dark surfaces.
