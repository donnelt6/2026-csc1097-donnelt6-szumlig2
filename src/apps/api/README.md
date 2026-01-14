# Caddie API (FastAPI)

FastAPI backend exposing hubs, sources, and chat endpoints backed by Supabase/Postgres and pgvector.

## Run locally
```bash
cd apps/api
python -m venv .venv && .venv/Scripts/activate  # PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Environment variables live in `.env.example`. Provide `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `OPENAI_API_KEY`, and `DEV_USER_ID` (a Supabase auth user id) for local development.

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `README.md` - Setup notes for running the API locally.
- `pyproject.toml` - Project metadata and dependency list.
- `requirements.txt` - Editable install entrypoint for local dev.
- `migrations/001_init.sql` - Base schema + RLS policies.
- `migrations/002_match_source_chunks.sql` - Vector search RPC.
- `app/__init__.py` - Marks the package for imports.
- `app/main.py` - FastAPI app entrypoint and router wiring.
- `app/dependencies.py` - Dependency helpers for future injection.
- `app/schemas.py` - Pydantic request/response models.
- `app/core/config.py` - Settings loader and defaults.
- `app/routers/__init__.py` - Router module export.
- `app/routers/chat.py` - Chat endpoint and error handling.
- `app/routers/hubs.py` - Hubs CRUD endpoints.
- `app/routers/sources.py` - Source upload/status endpoints.
- `app/services/__init__.py` - Services package marker.
- `app/services/queue.py` - Celery task enqueue helper.
- `app/services/rate_limit.py` - Simple rate limiting utility.
- `app/services/store.py` - Supabase-backed data store + chat logic.
