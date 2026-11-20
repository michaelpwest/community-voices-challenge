# Community Voices

A local-first demonstration of Retrieval-Augmented Generation (RAG) for weekly community reporting.

It ingests the past week of an online community, then has one local language model write the weekly report twice: once grounded in retrieved posts and comments (RAG), and once with no retrieved evidence (baseline). The two reports are shown side by side with source links and a comparison.

## Challenge

Choose an active online community, automatically ingest its recent discussions, and generate a **Community Voices Document** that summarizes the past week and predicts the next week's topics. Compare a baseline LLM report with a RAG-grounded report.

## What it does

- **Community:** [games on lemmy.world](https://lemmy.world/c/games), read through Lemmy's public API. No account or key is needed.
- **Ingestion:** one action fetches the past seven days of posts and their top comments, normalizes them, and stores them without duplicates.
- **Embeddings and search:** each post and comment is embedded locally and stored in SQLite; retrieval ranks them by vector similarity within the past seven days.
- **Two reports from the same local model:** identical instructions and settings; only the retrieved evidence differs.
- **Web UI:** both reports side by side, clickable source links, a comparison table, and the evidence that was retrieved. It works at phone width.
- **Inside the retrieval:** a map of the week's embeddings flattened to two dimensions, and a table of the discussions that similarity search returns most often.

Everything runs on your machine. The only network traffic is downloading the models once and reading the community feed from lemmy.world.

## Stack

- TypeScript on Node.js 22.13 or newer; API built with Hono
- React web UI styled with Tailwind CSS and served by Vite
- Ollama for local text generation (`llama3.1:8b`) and embeddings (`nomic-embed-text`), both configurable
- SQLite (Node's built-in `node:sqlite`) with sqlite-vec for storage and vector similarity search; no database server
- One `npm start` command that checks prerequisites, starts everything, and opens the web UI in your browser

## Requirements

- **Node.js 22.13 or newer.**
- **[Ollama](https://ollama.com/download)**, running locally or reachable at a URL.
- **About 6 GB of free disk space** for the two models, and enough memory to run an 8-billion-parameter model (16 GB of RAM is a comfortable minimum). A GPU makes report generation much faster but is not required.
- **Internet access** for the model downloads and for refreshing the community feed.

## Getting started

1. Install the models (one time; the first is roughly a 5 GB download):

   ```
   ollama pull llama3.1:8b
   ollama pull nomic-embed-text
   ```

2. Clone and install:

   ```
   git clone https://github.com/michaelpwest/community-voices-challenge.git
   cd community-voices-challenge
   npm install
   ```

3. Start the app:

   ```
   npm start
   ```

   This checks Ollama and the two models, starts the API on `http://localhost:3001` and the web UI on `http://localhost:3000`, and opens the web UI in your default browser. If no browser opens, go to `http://localhost:3000` yourself. No configuration file is needed; see [Configuration](#configuration) to change ports, models, or URLs.

   Everything from here on is done in the browser. Leave the terminal running, and press Ctrl+C in it when you are finished. That stops only what `npm start` started; an Ollama server that was already running is left alone.

## Reproducing the baseline versus RAG comparison

1. Click **Refresh feed**. This reads the past week of posts and their top comments from lemmy.world and embeds them. It took about a minute in testing. Running it again adds no duplicates.
2. Click **Generate reports**. The local model writes the two reports, and the page shows each stage as it runs. This took about 16 seconds on a desktop GPU and will take longer, possibly several minutes, on a CPU.
3. Read the result on the same page:
   - **Two reports side by side** (stacked on a phone), each with a past-week summary, themes, predictions for the coming week, and limitations.
   - **Source links** under each RAG theme and prediction, opening the original post or comment on lemmy.world.
   - **How the two reports compare**, a table of the same automatic checks applied to both.
   - **Evidence** given to the retrieval run and the **settings** shared by both runs, in two expandable sections.
   - **Map of this week's embeddings**, a scatter plot in which each dot is a post or comment and nearby dots tend to be about similar things. Point at a dot to see what it is; a larger dot was retrieved more often.
   - **Most retrieved discussions**, counted each time similarity search returns one.

In testing, the RAG report covered that week's actual threads and cited them, while the baseline described plausible topics that the community had not discussed. Your results will differ in detail: the community changes daily, and the model's output varies slightly between runs even with a fixed seed.

To start over, click **Clear data** and type `DELETE` to confirm. It removes the stored discussions, embeddings, retrieval counts, and reports.

The same actions are available through the API:

- `curl -X POST http://localhost:3001/api/ingest` refreshes the feed.
- `curl -X POST http://localhost:3001/api/reports/generate` starts report generation; `http://localhost:3001/api/reports/status` shows its progress.
- `http://localhost:3001/api/reports/latest` returns the latest run as JSON, including the evidence and the metrics.
- `http://localhost:3001/api/search?q=studio+layoffs&k=5` tries retrieval on its own.
- `http://localhost:3001/api/retrieval/stats` and `http://localhost:3001/api/embeddings/map` return the retrieval counts and the map data.

## How it works

### What gets ingested

- Every post from the past seven days, plus each post's 10 highest-scored comments (`LEMMY_COMMENTS_PER_POST`).
- Deleted or removed items, bot comments, and blank comments are skipped.
- Requests are made one at a time with a pause between them and an identifying user-agent (`LEMMY_USER_AGENT`).
- If lemmy.world cannot be reached, the refresh fails with a message saying so and existing data is left as it was.

The full rules and their trade-offs are in decision D-010 in the [decision log](docs/DECISIONS.md).

### How the two reports are compared

- **Same everything except evidence:** both runs use the same model, instructions, report period, and sampling settings. The RAG run is given retrieved posts and comments; the baseline is told none were retrieved.
- **Baseline is general knowledge:** it comes from what the model already knew, so it is labeled as unverified and should not be read as this week's activity.
- **Evidence is retrieved two ways:** the week's highest-scored posts with their top comments, plus vector search for several broad queries. Each passage records how it was chosen.
- **Citations are checked:** the RAG report cites evidence by label (`S1`, `S2`, ...), and each label maps to a source link. A cited label that matches no evidence is removed and counted.
- **Predictions are forecasts:** each has a rationale and a low, medium, or high confidence, and is never presented as something that happened.
- **Community text is treated as untrusted:** it is passed to the model as delimited evidence with an instruction to ignore any commands inside it.
- **Comparison metrics are rough:** they count citations and check whether the names and numbers in each report appear in the week's stored discussions. They indicate grounding; they do not grade writing quality.

Details and trade-offs are in decision D-011 in the [decision log](docs/DECISIONS.md).

### The embedding map and retrieval counts

- **Map:** each embedding has 768 numbers. Principal component analysis reduces them to the two directions along which the week's embeddings differ most, which become the map's axes. Two axes keep only about 12% of that variation, so the map is a rough guide to what is similar, not an exact one.
- **Counts:** every time similarity search returns a discussion, its counter goes up by one. Report generation runs five searches, and each call to the search API counts too.

Details are in decision D-012 in the [decision log](docs/DECISIONS.md).

## Configuration

The defaults work without any setup. To change them, copy `.env.example` to `.env` and edit it. Never commit `.env`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT`, `API_PORT` | `3000`, `3001` | Local ports |
| `OPEN_BROWSER` | `true` | Whether `npm start` opens the web UI in your browser |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama is running, including another machine |
| `OLLAMA_MODEL` | `llama3.1:8b` | Model that writes both reports |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model that creates embeddings |
| `OLLAMA_NUM_CTX` | `16384` | Context window in tokens, used for both reports |
| `DATABASE_PATH` | `./data/community-voices.db` | The SQLite file |
| `LEMMY_INSTANCE_URL`, `LEMMY_COMMUNITY` | `https://lemmy.world`, `games` | The community to read |
| `LEMMY_COMMENTS_PER_POST` | `10` | Top-scored comments kept per post (0 to 50) |
| `LEMMY_USER_AGENT` | `community-voices/0.1 ...` | Sent with every request to the instance |

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Check prerequisites, start the API and web UI, and open the browser |
| `npm run api` | Start only the API |
| `npm run web` | Start only the web UI |
| `npm test` | Run the tests (no Ollama or internet needed) |
| `npm run lint` | Lint the code |
| `npm run typecheck` | Type-check the server and web code |

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `npm start` says Ollama is not reachable | Start Ollama, then choose **Retry**. If it runs on another machine, choose **Use a different URL** or set `OLLAMA_URL` in `.env`. Nothing is ever installed for you. |
| `npm start` or the page says a model is missing | Run the `ollama pull` command it shows, or choose **Pull now** when `npm start` offers it. |
| No browser opens | Open `http://localhost:3000` yourself. This is expected on a machine with no desktop, or when `OPEN_BROWSER=false`. |
| "Port 3000 (or 3001) is already in use" | Stop the other program, or set `WEB_PORT` or `API_PORT` in `.env`. |
| "Node.js 22.13 or newer is required" | Upgrade Node.js. The app uses Node's built-in SQLite support. |
| Feed refresh fails with "Could not read ... from lemmy.world" | The instance is down, slow, or rate limiting. Wait and try again; stored data is unaffected. |
| Report generation is slow | Expected without a GPU. The page shows the current stage. A smaller model such as `llama3.2:3b` can be set with `OLLAMA_MODEL`. |
| "No discussions from the past seven days are stored" | Refresh the feed first. Data older than seven days is outside the report period. |
| The page says the API is not responding | The app was stopped in the terminal. Run `npm start` again. |
| You want to start over | Click **Clear data** on the page and type `DELETE`, or stop the app and delete the `data` folder. |
| No colors in the terminal | Colors are off when output is not a terminal or when the `NO_COLOR` environment variable is set. |

## Limitations

- **One community.** The source is configurable, but only `games` on lemmy.world has been tried.
- **A sample of the week.** Only each post's top-scored comments are stored, and the RAG prompt holds about 50 passages chosen from them. New comments on posts older than a week are not picked up.
- **Model quality.** `llama3.1:8b` writes usable reports, but its predictions mostly extend the week's themes, and it does not always follow the confidence rules. High-confidence predictions are counted in the comparison, not corrected.
- **Rough comparison metrics.** A name counts as found if the word appears anywhere in the week's discussions, so a wrong claim made of familiar words is not caught.
- **No scheduler.** Ingestion and reports run when you ask for them.
- **Local demo only.** The web UI runs on the Vite development server and the API has no login. Both accept connections only from the same computer.
- **Tested platforms.** The full flow was run on Windows 11 (Node.js 26). On Ubuntu 22.04 (Node.js 22), installation, the test suite, and startup were verified, but not a full run with Ollama. macOS has not been tested.

## Tests

`npm test` runs about 290 tests with no network and no Ollama. They cover normalization and deduplication, pagination and comment selection, retries and rate limiting, embeddings, retrieval with the date window, retrieval counting, the two-dimensional projection, prompt construction, validation of model output, citation checking, the comparison metrics, the API routes, and the launcher (including a test that starts and stops the real launcher).

The tests use a small, hand-written, synthetic fixture in `src/sources/lemmy/fixtures/`. It is never loaded into the app's database.

## Where to look in the code

| Area | Location |
| --- | --- |
| Lemmy client, normalization, and ingestion rules | `src/sources/lemmy/`, `src/ingestion/` |
| Storage, deduplication, and vector search | `src/storage/` |
| Embeddings and model calls | `src/ollama/` |
| Retrieval and retrieval counting | `src/retrieval/`, `src/storage/insightStore.ts` |
| Flattening embeddings to two dimensions | `src/embeddings/` |
| Evidence selection, prompt, citation checks, comparison | `src/reports/` |
| API routes | `src/api/` |
| Startup checks, process management, opening the browser | `src/launcher/` |
| Web UI | `web/src/` |

## Documentation

- [Implementation plan](docs/PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decision log](docs/DECISIONS.md)
- [Coding agent guidelines](AGENTS.md)
