# Caddie Worker (Celery)

Celery worker that handles ingestion, parsing, chunking, and embedding, and writes chunks to Supabase/pgvector.

## Run locally
```bash
cd apps/worker
python -m venv .venv && .venv/Scripts/activate  # PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
celery -A worker.tasks worker --loglevel=info
```

Configure `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` in `.env.example` for local development. The worker uses the service role key so it can write chunks through RLS.

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `README.md` - Setup notes for running the worker locally.
- `pyproject.toml` - Project metadata and dependency list.
- `requirements.txt` - Editable install entrypoint for local dev.
- `worker/__init__.py` - Marks the worker package.
- `worker/config.py` - Loads worker settings from env.
- `worker/main.py` - Worker entrypoint placeholder.
- `worker/tasks.py` - Ingestion tasks (download, extract, chunk, embed, insert).
