# API Tests

These tests cover the FastAPI service logic. External services
are mocked so tests run offline and do not touch Supabase, Redis, or OpenAI.

What is tested
- Auth helpers in `app/dependencies.py`.
- Rate limiting behavior in `app/services/rate_limit.py`.
- PostgREST error mapping in `app/routers/errors.py`.
- Router behavior for hubs, sources, chat, FAQs, memberships, and users.
- Chat flow in `app/services/store/` with stubbed matches and LLM output.
- FAQ generation logic in `app/services/store/` with stubbed LLM output.
- Source creation cleanup in `app/services/store/` when upload URL generation fails.

How it works
- `tests/conftest.py` sets safe env defaults and overrides FastAPI dependencies.
- Routers are exercised via `TestClient` and store calls are monkeypatched.
- The goal is to validate request handling, status codes, and response shapes.
- Store unit tests use lightweight fake clients and tables instead of Supabase.
- `tests/integration/` adds a thin higher-level layer that hits the real FastAPI app with shared in-memory doubles for auth, store, and queue edges.

Run the tests
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
pip install -r requirements.txt
pytest
```

Run only the integration layer
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
pytest tests/integration -q
```
