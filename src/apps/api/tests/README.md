# API Test Guide

This folder documents the backend test strategy for the Caddie API.

The API uses two main layers:

- fast offline tests for units, helpers, routers, and store behavior
- a thin integration layer that exercises the real FastAPI app with in-memory doubles at key boundaries

## Test Layers

Unit and route tests:

- Live across `tests/`
- Mock Supabase, Redis, queueing, and OpenAI boundaries
- Best for router behavior, status codes, response shapes, access control checks, and store/helper logic

Integration tests:

- Live in `tests/integration/`
- Run the real FastAPI application through `TestClient`
- Replace auth, store, and queue edges with shared in-memory doubles
- Best for higher-confidence checks of full request handling without requiring a real deployed stack

## Which Layer To Run

Run the standard test suite when:

- you changed router logic
- you changed dependencies, schemas, or store helpers
- you want fast feedback during normal backend development

Run the integration layer when:

- you changed request flow across multiple backend modules
- you changed dependency wiring or route registration
- you want confidence that the real FastAPI app still behaves correctly end-to-end at the HTTP layer

## Dependencies

The standard test suite requires:

- the API Python environment
- `pip install -r requirements.txt`

The integration layer uses the same Python environment and remains offline. It does not require a live Supabase project, Redis instance, or OpenAI access.

`tests/conftest.py` sets safe defaults and overrides shared dependencies so the suite can run deterministically.

## Coverage Areas

Current coverage includes:

- auth helpers in `app/dependencies.py`
- rate limiting in `app/services/rate_limit.py`
- PostgREST error mapping in `app/routers/errors.py`
- router behavior for hubs, sources, chat, FAQs, memberships, and users
- chat and FAQ logic in `app/services/store/` with stubbed collaborators
- thin integration coverage for authenticated hub, source, and chat flows

## Commands

Run the full backend suite:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
python -m pytest
```

Run only the integration layer:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/api
python -m pytest -q tests/integration
```

## Notes

- Start with the standard suite unless the change crosses module boundaries in a way unit-level mocking might miss.
- Keep the integration layer small and focused on high-value request paths.

