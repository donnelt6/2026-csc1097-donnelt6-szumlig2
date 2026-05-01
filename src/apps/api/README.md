# Caddie API

This app is the FastAPI backend for Caddie. It handles hubs, sources, memberships, reminders, generated content, analytics, and chat over ingested knowledge.

It sits between the Next.js frontend and the backing services used for auth, storage, retrieval, queueing, and embeddings.

## Main Responsibilities

- Expose HTTP endpoints for the web app
- Enforce authentication and role-based access rules
- Validate request and response shapes with Pydantic models
- Read and write product data through the store layer
- Enqueue background ingestion work for the worker
- Coordinate source creation flows for file uploads, web URLs, YouTube imports, and manual media fallbacks
- Run chat retrieval and answer generation
- Produce FAQ and guide content using stored source material

## Run Locally

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

## Required Configuration

See `.env.example`.

Typical local requirements:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`
- `OPENAI_API_KEY`

The API expects a Supabase Auth JWT in `Authorization: Bearer <token>` for user-scoped routes.

Optional operational settings include rate-limit values and proxy/header configuration.

## Request Flow

Most requests follow this path:

1. FastAPI routes the request in `app/main.py`
2. Dependencies in `app/dependencies.py` resolve auth, clients, and common guards
3. Router handlers in `app/routers/` validate inputs and enforce access rules
4. The store layer in `app/services/store/` performs domain logic and persistence work
5. The API returns a validated response schema from `app/schemas.py`

Background ingestion adds one more step:

6. `app/services/queue.py` enqueues worker jobs for asynchronous processing

Manual media recovery for YouTube adds a related source flow:

7. The API can create a linked file source when a failed YouTube source is eligible for manual audio or video upload fallback

## Folder Guide

- `app/main.py`: FastAPI entrypoint and router registration
- `app/dependencies.py`: auth/client dependency helpers
- `app/schemas.py`: request and response models
- `app/core/config.py`: settings loader and defaults
- `app/routers/`: HTTP boundary layer grouped by feature
- `app/services/queue.py`: worker task enqueue helper
- `app/services/rate_limit.py`: rate-limit utilities
- `app/services/store/`: split Supabase-backed store package
- `tests/`: backend unit, route, and integration tests
- `evals/`: offline RAG evaluation harness and datasets
- `migrations/`: SQL migrations for schema and data-layer changes

## Store Layer

The store package has been split into smaller domain-focused modules under `app/services/store/`.

Key point:

- Router files should stay thin and delegate data and domain logic into the store layer.

Examples of owned areas inside the store package:

- hubs
- sources
- chat
- reminders
- memberships
- moderation
- analytics
- shared helpers and internals

The compatibility import path remains `app.services.store`.

## Evals

Offline chat evaluation lives in `evals/`.

Run from this folder:

```powershell
python evals/run_eval.py --dataset evals/dataset.jsonl
```


## Tests

There are two main backend test layers:

- `tests/`: unit, helper, and route-level tests with mocked external boundaries
- `tests/integration/`: thin higher-level integration tests using the real FastAPI app with shared in-memory doubles

Run everything:

```powershell
python -m pytest
```

Run only the integration layer:

```powershell
python -m pytest -q tests/integration
```

See `tests/README.md` for test-layer detail.

## Deployment-Sensitive Notes

- `ENVIRONMENT=local` can omit `ALLOWED_ORIGINS`
- Non-local environments must set a non-empty `ALLOWED_ORIGINS` allowlist
