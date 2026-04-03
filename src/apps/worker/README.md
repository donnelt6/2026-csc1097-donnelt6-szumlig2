# Caddie Worker (Celery)

Celery worker that handles ingestion, parsing, chunking, and embedding, and writes chunks to Supabase/pgvector. Web URLs are crawled into a pseudo-document snapshot before chunking. YouTube ingestion pulls captions with `yt-dlp` and stores a transcript snapshot.
The worker is now split into focused modules inside `worker/`, with `worker.tasks` kept as the compatibility layer and Celery task registration entrypoint.

## Run locally
```bash
cd apps/worker
python -m venv .venv && .venv/Scripts/activate  # PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
celery -A worker.tasks worker --loglevel=info
celery -A worker.tasks beat --loglevel=info
```

Configure `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` in `.env.example` for local development. Web ingestion also respects `WEB_MAX_BYTES`, `WEB_USER_AGENT`, `WEB_TIMEOUT_SECONDS`, and `WEB_RESPECT_ROBOTS`. YouTube ingestion uses `YOUTUBE_DEFAULT_LANGUAGE`, `YOUTUBE_ALLOW_AUTO_CAPTIONS`, and `YOUTUBE_MAX_BYTES`. The worker uses the service role key so it can write chunks through RLS.
Reminder delivery uses `DEFAULT_TIMEZONE`.
For reminder detection, install a spaCy English model (e.g. `python -m spacy download en_core_web_sm`).

## Monitoring notes
- Run both the worker and beat processes in deployment; treat either process being down as an incident.
- Watch logs for stable failure prefixes including `worker.ingest.failed`, `worker.web_ingest.failed`, `worker.youtube_ingest.failed`, and `worker.source_suggestions.failed`.
- Repeated failures on the same task type should block deployment promotion until the underlying source/config issue is understood.

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `README.md` - Setup notes for running the worker locally.
- `pyproject.toml` - Project metadata and dependency list.
- `requirements.txt` - Editable install entrypoint for local dev.
- `worker/__init__.py` - Marks the worker package.
- `worker/app.py` - Shared Celery app, logger, and settings.
- `worker/common.py` - Shared worker helpers such as text normalization, batching, and ISO parsing.
- `worker/config.py` - Loads worker settings from env.
- `worker/content.py` - File extraction helpers for PDF, DOCX, and text-like uploads.
- `worker/response_utils.py` - Defensive helpers for parsing OpenAI SDK responses.
- `worker/storage.py` - Supabase Storage and source-row helper functions.
- `worker/web.py` - Public-URL validation, robots.txt checks, fetching, and HTML extraction helpers.
- `worker/youtube.py` - YouTube caption selection, transcript parsing, and pseudo-document helpers.
- `worker/main.py` - Minimal entrypoint that re-exports the shared Celery app.
- `worker/tasks.py` - Celery task entrypoints plus the compatibility facade that preserves the historical `worker.tasks` helper surface for tests and startup commands.
