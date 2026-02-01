# Caddie Worker (Celery)

Celery worker that handles ingestion, parsing, chunking, and embedding, and writes chunks to Supabase/pgvector. Web URLs are crawled into a pseudo-document snapshot before chunking. YouTube ingestion pulls captions with `yt-dlp` and stores a transcript snapshot.

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

## Files and purpose
- `.env.example` - Template for required env vars (no secrets).
- `README.md` - Setup notes for running the worker locally.
- `pyproject.toml` - Project metadata and dependency list.
- `requirements.txt` - Editable install entrypoint for local dev.
- `worker/__init__.py` - Marks the worker package.
- `worker/config.py` - Loads worker settings from env.
- `worker/main.py` - Worker entrypoint placeholder.
- `worker/tasks.py` - Ingestion tasks (download/crawl, extract, chunk, embed, insert), robots.txt enforcement, and reminder detection.
