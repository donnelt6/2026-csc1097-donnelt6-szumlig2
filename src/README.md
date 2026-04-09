# Caddie Repo Structure

This `src/` folder contains the scaffold for Caddie: a Next.js frontend, FastAPI backend, Celery ingestion worker, and shared contracts.

## Structure
- `apps/web/` - Next.js frontend with hubs list, hub detail, file/URL upload widget, and chat flow.
- `apps/api/` - FastAPI service exposing hubs, sources, and chat endpoints backed by Supabase + OpenAI.
- `apps/worker/` - Celery ingestion worker package that downloads from Supabase Storage, crawls web URLs, or fetches YouTube transcripts; extracts text, chunks, embeds, and writes to pgvector.
- `packages/shared/` - Shared TypeScript and Pydantic models to keep contracts aligned.
- `Makefile` - Convenience commands for running services locally.

## Quickstart
1) Install Node deps: `cd src && npm install && cd apps/web && npm install`
2) Set env vars from `.env.example` in each app (Supabase/OpenAI/Redis). Worker also accepts web crawl settings (`WEB_MAX_BYTES`, `WEB_USER_AGENT`, `WEB_RESPECT_ROBOTS`) and YouTube caption settings (`YOUTUBE_DEFAULT_LANGUAGE`, `YOUTUBE_ALLOW_AUTO_CAPTIONS`).
3) Run API: `cd apps/api && uvicorn app.main:app --reload --port 8000`
4) Run worker: `cd apps/worker && celery -A worker.tasks worker --loglevel=info`
5) Run beat (reminders): `cd apps/worker && celery -A worker.tasks beat --loglevel=info`
6) Run web: `cd apps/web && npm run dev` (expects `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`)

Supabase/OpenAI/Redis env placeholders live in each app's `.env.example`. The API and worker require these to run.
Note: the API expects Supabase Auth JWTs for user-scoped access and uses the service role key only for storage/admin tasks.
Reminder detection uses spaCy; install `en_core_web_sm` in the worker env for due-date suggestions.
Web URL ingestion respects robots.txt by default; set `WEB_RESPECT_ROBOTS=false` in the worker env to override.
The worker is split into focused modules under `apps/worker/worker/`; `worker.tasks` now stays focused on Celery task registration and task-level orchestration.

## How URL ingestion works
- The user submits a URL from the hub upload panel.
- The API creates a `sources` row with `type="web"` and stores the URL in `ingestion_metadata`.
- The worker validates the URL (public host only), checks `robots.txt`, and fetches the page.
- HTML is cleaned with readability (fallback to basic HTML-to-text), then normalized.
- The worker stores a pseudo-document snapshot in Supabase Storage (Markdown with title/URL/crawl time).
- The extracted text is chunked, embedded, and stored in `source_chunks`.
- Reprocess uses the stored snapshot; Refresh re-crawls the URL and updates the snapshot/metadata.

## How YouTube ingestion works
- The user submits a YouTube URL from the hub upload panel.
- The API creates a `sources` row with `type="youtube"` and stores the URL + caption preferences in `ingestion_metadata`.
- The worker uses `yt-dlp` to fetch video metadata and captions (manual first, auto if allowed).
- Captions are cleaned to plain text, normalized, and stored as a pseudo-document snapshot in Supabase Storage.
- The transcript text is chunked, embedded, and stored in `source_chunks`.
- Reprocess uses the stored snapshot; Refresh re-fetches captions and updates the snapshot/metadata.

## Daily run commands (PowerShell)
Use three terminals so each process keeps running.

API:
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Worker:
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
.\.venv\Scripts\python -m celery -A worker.tasks worker --loglevel=info -P solo
```

Beat (reminders):
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
.\.venv\Scripts\python -m celery -A worker.tasks beat --loglevel=info
```

Web:
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run dev
```


## Auth note
Sign in via `/auth` using Supabase email/password auth. The web app stores the Supabase session and sends `Authorization: Bearer <JWT>` on API requests. The API enforces RLS with the user token and only uses the service role key for storage/admin tasks (ingestion, member lookups).
Password recovery is Supabase-native:
- `/auth/forgot-password` requests a recovery email through Supabase.
- `/auth/reset-password` completes the recovery flow and updates the password through Supabase.
- Local development builds auth email links from the current browser origin, so localhost testing does not depend on `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL`.
- Non-local/deployed environments must set `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` to the real site base URL; placeholder values are rejected so email links fail closed instead of pointing at the wrong app.
- Supabase project setup must include recovery email enabled, the deployed recovery redirect URL allowlisted, and recovery token expiry set to 30 minutes if supported by the project settings.

## Chat note
Chat supports hub-only context or hub + web search when `global` scope is selected. Users can also select which completed sources to include when answering a question. Streaming is not implemented yet; it is planned as a future improvement.

## RAG evals and analytics
- Offline chat evals live in `apps/api/evals/`.
- Run `python evals/run_eval.py --dataset evals/dataset.jsonl` from `apps/api` to write a JSON report under `eval-results/`.
- Optional extras:
- `pip install -e .[evals]` for Ragas answer-level metrics
- `pip install -e .[observability]` for Langfuse trace export
- Hub owners/admins now get chat analytics based on question, answer, citation, copy, and feedback events.

## Rate limits (API)
Defaults (configurable in `apps/api/.env`):
- Chat: 20 requests per minute
- Sources: 30 requests per minute
- Read endpoints: 120 requests per minute
- Write endpoints: 60 requests per minute
- Health endpoint: 60 requests per minute

Chat read/write hardening also applies the standard read/write limiter to:
- `GET /chat/sessions`
- `GET /chat/sessions/{id}/messages`
- `GET /chat/history`
- `PATCH /chat/sessions/{id}`
- `DELETE /chat/sessions/{id}`

## Pre-Deployment Checks
- Set `ALLOWED_ORIGINS` explicitly for every non-local API environment. The API now fails fast on startup if `ENVIRONMENT != local` and no valid allowlist is configured.
- Local API development can omit `ALLOWED_ORIGINS`; it falls back to explicit localhost origins only, never `*`.
- For GitLab-driven production promotion, configure `GITHUB_MIRROR_REPO`, `GITHUB_MIRROR_USERNAME`, `GITHUB_MIRROR_TOKEN`, and `PRODUCTION_API_HEALTH_URL` in GitLab CI/CD variables before triggering `promote_production`.
- Verify `/health` returns `{"status":"ok"}` from the deployed API.
- Verify the worker process and beat process are both running after deploy.
- Review recent API and worker logs for stable failure prefixes such as `api.startup.config_invalid`, `rate_limit.redis_unavailable`, `worker.ingest.failed`, `worker.web_ingest.failed`, and `worker.youtube_ingest.failed`.
- Treat default-branch CI failures, repeated worker task failures, failed health checks, and startup config validation failures as deploy blockers.

## GitLab Promotion Flow
1. Merge the approved change into `main` on GitLab.
2. Wait for the `lint`, `test`, and `build` stages to pass.
3. Trigger the manual `promote_production` job only when the hosted environment should be brought online.
4. Let Netlify and Railway deploy from the mirrored GitHub `main` commit.
5. Confirm the `post_deploy_health` job passes against the production Railway API.
