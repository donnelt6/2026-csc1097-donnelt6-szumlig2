# Caddie

Caddie is an AI-assisted onboarding and professional documentation assistant. It lets users create shared hubs, upload internal material, ingest web pages, Audio/Video files and YouTube transcripts, ask cited questions over that content, generate onboarding FAQs and guides, manage reminders, and collaborate with role-based membership controls.


## What Caddie Includes

- A Next.js web app for authentication, hub management, source upload, chat, reminders, guides, FAQs, moderation, and analytics
- A FastAPI backend for hub, source, chat, membership, reminder, and analytics APIs
- A Celery worker for ingestion, parsing, chunking, embedding, and reminder background work
- Shared contracts for keeping frontend and backend models aligned
- Project documentation including the functional specification, user manual, technical guide and testing documentation.

## Architecture

The implementation is organised around three main runtime services:

- `src/apps/web/`: Next.js frontend
- `src/apps/api/`: FastAPI backend
- `src/apps/worker/`: Celery worker and beat scheduler

Shared code and contracts live under:

- `src/packages/shared/`: shared TypeScript types
- `src/packages/shared/python/`: shared Python schemas

The main developer workspace guide is in `src/README.md`, with more detailed setup notes in each app-level README.

## Repository Layout

```text
.
|-- docs/                  Submission and project documents
|-- src/                   Application workspace
|   |-- apps/
|   |   |-- api/
|   |   |-- web/
|   |   `-- worker/
|   `-- packages/
```

## Core Features

- Hub creation and management
- Role-based memberships, invites, and moderation controls
- File upload ingestion for knowledge sources
- Web page ingestion with refresh and reprocessing support
- YouTube transcript ingestion
- Manual audio/video upload fallback for recoverable YouTube ingestion failures
- Retrieval-augmented chat with citations and optional web search
- AI-generated onboarding FAQs
- AI-generated step-by-step onboarding guides
- Reminder detection, scheduling, and notification flows
- Hub analytics for owners and admins

## Hosted Website

The hosted version of Caddie can be viewed at [www.caddie.wesbsite](https://www.caddie.website).

If you want to explore the deployed application instead of running the full stack locally, start there.

## Quick Start

### 1. Install dependencies

Frontend workspace:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src
npm install
cd apps/web
npm install
```

Python services:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

### 2. Configure environment variables

Copy values from each app's `.env.example` and provide the required secrets.

Main dependencies used across the stack:

- Supabase
- OpenAI
- Redis

The web app also needs:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The API and worker require Supabase, Redis, and OpenAI credentials to run correctly.

### 3. Run the services

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

## Testing

The project uses several test layers:

- API tests: `cd src/apps/api && pytest`
- API integration tests: `cd src/apps/api && pytest tests/integration -q`
- Worker tests: `cd src/apps/worker && pytest`
- Web component tests: `cd src/apps/web && npm run test`
- Web mocked E2E tests: `cd src/apps/web && npm run test:e2e`
- Web true E2E tests: `cd src/apps/web && npm run test:e2e:true`

The mocked E2E suite runs the real web app with fake auth and mocked API traffic. The true E2E suite runs against the real stack and requires the full environment to be available.

## Notes

- The API expects Supabase Auth JWTs for user-scoped routes.
- The worker uses the Supabase service role key for ingestion and storage-side operations.
- Recoverable YouTube failures can fall back to manual media uploads using `mp3`, `mp4`, or `m4a` files.
- Local development expects Redis plus the required Supabase and OpenAI configuration.
- Deployment and promotion notes currently live in `src/README.md` and `.gitlab-ci.yml`.
