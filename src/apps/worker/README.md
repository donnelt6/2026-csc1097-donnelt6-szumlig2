# Caddie Worker

This app is the Celery worker for Caddie. It handles asynchronous ingestion and reminder-related background work that should not run inside the request-response cycle of the API.

The worker is intentionally split into focused modules under `worker/`, with `worker.tasks` kept as the task registration and orchestration layer.

## Main Responsibilities

- Process uploaded source files
- Crawl and ingest supported web pages
- Fetch and ingest YouTube captions
- Extract and normalize text from source material
- Chunk content and generate embeddings
- Write chunk records and snapshot artefacts back to Supabase
- Support reminder and other background task flows owned by the worker

## Run Locally

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m celery -A worker.tasks worker --loglevel=info -P solo
.\.venv\Scripts\python -m celery -A worker.tasks beat --loglevel=info
```

## Required Configuration

See `.env.example`.

Typical local requirements:

- `REDIS_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Worker-specific settings include:

- `WEB_MAX_BYTES`
- `WEB_USER_AGENT`
- `WEB_TIMEOUT_SECONDS`
- `WEB_RESPECT_ROBOTS`
- `YOUTUBE_DEFAULT_LANGUAGE`
- `YOUTUBE_ALLOW_AUTO_CAPTIONS`
- `YOUTUBE_MAX_BYTES`
- `YOUTUBE_REQUEST_TIMEOUT_SECONDS`
- `YOUTUBE_METADATA_RETRIES`
- `YOUTUBE_TASK_SOFT_TIME_LIMIT_SECONDS`
- `YOUTUBE_TASK_TIME_LIMIT_SECONDS`
- `YOUTUBE_COOKIES_FILE`, `YOUTUBE_COOKIES_B64`, or `YOUTUBE_COOKIES_RAW` when hosted YouTube requests require authenticated cookies
- `DEFAULT_TIMEZONE`

Reminder detection also requires a spaCy English model such as `en_core_web_sm`.

## End-To-End Ingestion Flow

File upload ingestion:

1. The web app creates or uploads a source through the API
2. The API stores source metadata and enqueues a worker task
3. The worker downloads the stored file from Supabase Storage
4. `worker/content.py` extracts text from the uploaded content
5. The worker normalizes and chunks the extracted text
6. The worker generates embeddings and writes `source_chunks`
7. The source status is updated so the web app can use it for chat and generated content

Web URL ingestion:

1. The API creates a source with `type="web"`
2. The worker validates the URL and blocks unsupported or non-public targets
3. `worker/web.py` checks `robots.txt`, fetches the page, and extracts readable text
4. The worker stores a pseudo-document snapshot in Supabase Storage
5. The worker chunks, embeds, and writes retrieval records
6. Refresh re-crawls the live page, while reprocess uses the stored snapshot

YouTube ingestion:

1. The API creates a source with `type="youtube"`
2. `worker/youtube.py` fetches metadata and captions with `yt-dlp`
3. Captions are cleaned to transcript text
4. The worker stores a transcript snapshot in Supabase Storage
5. The worker chunks, embeds, and writes retrieval records
6. Refresh re-fetches metadata and captions, while reprocess uses the stored snapshot

Hosted workers can be challenged by YouTube with `Sign in to confirm you're not a bot`. In that case,
export YouTube cookies in Netscape `cookies.txt` format and configure one of:

- `YOUTUBE_COOKIES_FILE`: absolute path to a mounted `cookies.txt` file
- `YOUTUBE_COOKIES_B64`: base64-encoded contents of `cookies.txt`, useful for deployment secrets
- `YOUTUBE_COOKIES_RAW`: raw `cookies.txt` contents, useful only if the host supports multiline secrets cleanly

Prefer `YOUTUBE_COOKIES_FILE` or `YOUTUBE_COOKIES_B64` for deployment. Do not commit cookie files.

## Module Ownership

The `worker/` package is split by responsibility:

- `worker/tasks.py`: Celery task entrypoints and task-level orchestration
- `worker/app.py`: shared Celery app, logger, and settings bootstrap
- `worker/config.py`: environment-backed worker settings
- `worker/content.py`: file extraction helpers for uploaded documents
- `worker/web.py`: web crawling, validation, robots, and extraction helpers
- `worker/youtube.py`: YouTube metadata, caption selection, and transcript helpers
- `worker/storage.py`: Supabase Storage and source-row helper operations
- `worker/common.py`: shared normalization, batching, and parsing helpers
- `worker/response_utils.py`: defensive OpenAI response parsing helpers
- `worker/main.py`: minimal worker entrypoint

If a change is source-type-specific, it usually belongs in `content.py`, `web.py`, or `youtube.py`. If a change is task orchestration or retries, it usually belongs in `tasks.py`.

## Operational Notes

- Run both the worker and beat processes in deployed environments
- The worker uses the Supabase service role key because ingestion and storage-side writes need privileged access


## Tests

Worker tests focus on helper logic and avoid live networked dependencies.

Run them with:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
python -m pytest
```
