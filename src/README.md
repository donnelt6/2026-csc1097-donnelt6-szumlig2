# Caddie Workspace Guide

This `src/` directory is the developer workspace for Caddie. It contains the running application code, shared contracts, local test entrypoints, and the deployment-facing configuration used by the web app, API, and worker.

Use the repository root `README.md` for the project overview. Use this file when you need to run, test, or deploy the codebase.

## Workspace Layout

- `apps/web/`: Next.js frontend
- `apps/api/`: FastAPI backend
- `apps/worker/`: Celery worker and beat scheduler
- `packages/shared/`: shared TypeScript contracts
- `packages/shared/python/`: shared Python schemas
- `package.json`: workspace-level web and E2E scripts

## Local Development Flow

Typical local setup uses four long-running processes:

1. FastAPI API
2. Celery worker
3. Celery beat
4. Next.js web app

The web app talks to the API over HTTP. The API uses Supabase for data/storage/auth integration and Redis for queueing/rate-limit support. The worker handles ingestion and reminder background work.

## Install Dependencies

Node workspace:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src
npm install
cd apps/web
npm install
```

API Python environment:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Worker Python environment:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Reminder detection also needs a spaCy English model in the worker environment:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
.\.venv\Scripts\python -m spacy download en_core_web_sm
```

## Environment Variables

Each app has its own `.env.example`.

Core services used across the stack:

- Supabase
- OpenAI
- Redis

Common requirements:

- The web app needs `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- The API needs Supabase credentials, Redis access, and `OPENAI_API_KEY`.
- The worker needs Supabase credentials, Redis access, and `OPENAI_API_KEY`.

Additional worker-only configuration includes:

- Web crawling settings such as `WEB_MAX_BYTES`, `WEB_USER_AGENT`, `WEB_TIMEOUT_SECONDS`, and `WEB_RESPECT_ROBOTS`
- YouTube caption settings such as `YOUTUBE_DEFAULT_LANGUAGE`, `YOUTUBE_ALLOW_AUTO_CAPTIONS`, `YOUTUBE_MAX_BYTES`, and optional YouTube cookie settings for hosted bot checks
- `DEFAULT_TIMEZONE` for reminder delivery defaults

## Run Locally

API:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Worker:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
.\.venv\Scripts\python -m celery -A worker.tasks worker --loglevel=info -P solo
```

Beat:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
.\.venv\Scripts\python -m celery -A worker.tasks beat --loglevel=info
```

Web:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run dev
```

## How The Main Flows Fit Together

Authentication:

- The web app signs users in through Supabase Auth.
- The web app sends `Authorization: Bearer <JWT>` on API requests.
- The API uses the user token for user-scoped access and the service role key only for privileged storage/admin operations.

File ingestion:

- The web app creates a source through the API and uploads or references the source material.
- The API stores source metadata and enqueues worker processing.
- The worker extracts text, chunks it, generates embeddings, and writes chunk records for retrieval.

Web URL ingestion:

- The API creates a `web` source and stores the requested URL in source metadata.
- The worker validates the host, checks `robots.txt`, fetches the page, extracts readable content, stores a pseudo-document snapshot, and writes chunks.
- Reprocess uses the stored snapshot. Refresh re-crawls the live page.

YouTube ingestion:

- The API creates a `youtube` source and stores the URL plus caption preferences.
- The worker fetches metadata and captions with `yt-dlp`, stores a transcript snapshot, then chunks and embeds it.
- Reprocess uses the stored snapshot. Refresh re-fetches captions and metadata.
- If the hosted worker gets YouTube's bot-check error, configure `YOUTUBE_COOKIES_FILE` or `YOUTUBE_COOKIES_B64` in the worker deployment with exported YouTube `cookies.txt` content.

Chat:

- The web app sends a hub-scoped or global-scope question to the API.
- The API retrieves matching chunks, builds prompt context, and returns an answer with citations.
- Users can also restrict chat to selected completed sources.

## Test Layers

Use the smallest useful layer first.

- API unit and route tests: fast, offline, good for backend behavior and response-shape checks
- API integration tests: real FastAPI app with in-memory doubles at the auth/store/queue edges
- Worker tests: pure helper/module tests without live external services
- Web component tests: jsdom tests with mocked API and Next.js helpers
- Web mocked E2E tests: real browser plus real Next.js app, but fake auth and mocked API traffic
- Web true E2E tests: real browser against the live local stack and real external integrations

Useful commands:

- `cd apps/api && python -m pytest`
- `cd apps/api && python -m pytest -q tests/integration`
- `cd apps/worker && python -m pytest`
- `npm --workspace apps/web run test`
- `npm --workspace apps/web run test:e2e`
- `npm --workspace apps/web run test:e2e:true`

## Evals And Analytics

- Offline chat evals live in `apps/api/evals/`
- Run `python evals/run_eval.py --dataset evals/dataset.jsonl` from `apps/api`
- Reports are written under `apps/api/eval-results/`

Hub owners and admins also have product-side analytics based on chat and feedback events.

## Deployment Notes

- Local API development can omit `ALLOWED_ORIGINS`; non-local environments must set an explicit allowlist.
- `/health` is the baseline API health probe.
- Worker and beat should both be treated as required deployed processes.
- Promotion and deploy checks are coordinated through `.gitlab-ci.yml`.
