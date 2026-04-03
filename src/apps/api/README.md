# Caddie API (FastAPI)

FastAPI backend exposing hubs, sources, and chat endpoints backed by Supabase/Postgres and pgvector.

## Run locally
```bash
cd apps/api
python -m venv .venv && .venv/Scripts/activate  # PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Environment variables live in `.env.example`. Provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, and `OPENAI_API_KEY` for local development. The API expects a Supabase Auth JWT in the `Authorization: Bearer` header for user-scoped routes. Optional rate-limit settings include `RATE_LIMIT_READ_PER_MINUTE`, `RATE_LIMIT_WRITE_PER_MINUTE`, `RATE_LIMIT_HEALTH_PER_MINUTE`, `RATE_LIMIT_IP_MULTIPLIER`, and `TRUST_PROXY_HEADERS`.

## Deployment-sensitive config
- `ENVIRONMENT=local` can omit `ALLOWED_ORIGINS`; the API falls back to `http://localhost:3000` and `http://127.0.0.1:3000`.
- Any non-local environment must set a non-empty comma-separated `ALLOWED_ORIGINS` allowlist. Invalid or empty values now fail startup instead of silently using `*`.
- `/health` is the baseline health probe and should be checked after every deploy.
- Startup/config and auth lookup failures are logged with stable prefixes including `api.startup.config_invalid`, `api.startup.ready`, `api.auth.lookup_unreachable`, and `api.auth.lookup_failed`.

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `README.md` - Setup notes for running the API locally.
- `pyproject.toml` - Project metadata and dependency list.
- `requirements.txt` - Editable install entrypoint for local dev.
- `app/__init__.py` - Marks the package for imports.
- `app/main.py` - FastAPI app entrypoint and router wiring.
- `app/dependencies.py` - Auth helpers (JWT, Supabase clients).
- `app/schemas.py` - Pydantic request/response models including memberships.
- `app/core/config.py` - Settings loader and defaults.
- `app/routers/__init__.py` - Router module export.
- `app/routers/analytics.py` - Hub-scoped AI analytics endpoints for owners/admins.
- `app/routers/chat.py` - Chat endpoint (hub-only or hub + web search).
- `app/routers/faqs.py` - FAQ generation/list/edit endpoints.
- `app/routers/guides.py` - Guide generation/list/edit endpoints with step progress.
- `app/routers/hubs.py` - Hubs CRUD endpoints.
- `app/routers/sources.py` - Source upload/status endpoints (signed upload URL, fail, enqueue), plus web URL ingestion and refresh.
- `app/routers/reminders.py` - Reminder CRUD, candidate review, and notifications endpoints.
- `app/routers/memberships.py` - Invites and member management endpoints.
- `app/routers/users.py` - Current user endpoint.
- `app/routers/errors.py` - PostgREST error mapper.
- `app/services/__init__.py` - Services package marker.
- `app/services/queue.py` - Celery task enqueue helper.
- `app/services/rate_limit.py` - Simple rate limiting utility.
- `app/services/store/` - Split Supabase-backed store package with domain mixins, helper modules, and the compatibility facade exported from `app.services.store`.
- `evals/` - Offline RAG eval runner and starter dataset.
- FAQ generation runs synchronously in the API (no worker task). It reuses stored embeddings and citations and is triggered manually from the web UI.

