# Caddie Repo Structure

This `src/` folder contains the scaffold for Caddie: a Next.js frontend, FastAPI backend, Celery ingestion worker, and shared contracts.

## Structure
- `apps/web/` - Next.js frontend with hubs list, hub detail, upload widget, and chat flow.
- `apps/api/` - FastAPI service exposing hubs, sources, and chat endpoints backed by Supabase + OpenAI.
- `apps/worker/` - Celery ingestion worker that downloads from Supabase Storage, extracts text, chunks, embeds, and writes to pgvector.
- `packages/shared/` - Shared TypeScript and Pydantic models to keep contracts aligned.
- `Makefile` - Convenience commands for running services locally.

## Quickstart
1) Install Node deps: `cd src && npm install && cd apps/web && npm install`
2) Set env vars from `.env.example` in each app (Supabase/OpenAI/Redis).
3) Run API: `cd apps/api && uvicorn app.main:app --reload --port 8000`
4) Run worker: `cd apps/worker && celery -A worker.tasks worker --loglevel=info`
5) Run web: `cd apps/web && npm run dev` (expects `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`)

Supabase/OpenAI/Redis env placeholders live in each app's `.env.example`. The API and worker require these to run.
Note: the API expects Supabase Auth JWTs for user-scoped access and uses the service role key only for storage/admin tasks.

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

Web:
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run dev
```

## Supabase schema setup
Run the SQL migration in Supabase SQL Editor:
`2026-csc1097-donnelt6-szumlig2/src/apps/api/migrations/001_init.sql`
`2026-csc1097-donnelt6-szumlig2/src/apps/api/migrations/002_match_source_chunks.sql`
`2026-csc1097-donnelt6-szumlig2/src/apps/api/migrations/003_auth_roles.sql`
`2026-csc1097-donnelt6-szumlig2/src/apps/api/migrations/004_fix_hub_members_rls.sql`
`2026-csc1097-donnelt6-szumlig2/src/apps/api/migrations/005_fix_hub_members_rls_functions.sql`

## Auth note
Sign in via `/auth` using Supabase email/password auth. The web app stores the Supabase session and sends `Authorization: Bearer <JWT>` on API requests. The API enforces RLS with the user token and only uses the service role key for storage/admin tasks (ingestion, member lookups).

## Chat note
Chat streaming is not implemented yet; it is planned as a future improvement.

## Rate limits (API)
Defaults (configurable in `apps/api/.env`):
- Chat: 20 requests per minute
- Sources: 30 requests per minute
