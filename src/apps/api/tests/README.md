# API Tests

These tests cover the FastAPI service logic. External services
are mocked so tests run offline and do not touch Supabase, Redis, or OpenAI.

What is tested
- Auth helpers in `app/dependencies.py`.
- Rate limiting behavior in `app/services/rate_limit.py`.
- PostgREST error mapping in `app/routers/errors.py`.
- Router behavior for hubs, sources, chat, memberships, and users.
- Chat flow in `app/services/store.py` with stubbed matches and LLM output.
- Source creation cleanup in `app/services/store.py` when upload URL generation fails.

How it works
- `tests/conftest.py` sets safe env defaults and overrides FastAPI dependencies.
- Routers are exercised via `TestClient` and store calls are monkeypatched.
- The goal is to validate request handling, status codes, and response shapes.
- Store unit tests use lightweight fake clients and tables instead of Supabase.

Run the tests
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
pip install -r requirements.txt
pytest
```
