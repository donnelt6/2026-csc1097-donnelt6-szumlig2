# Routers README

This folder contains the FastAPI router modules for the API.

## What a router does

Each file in this folder groups endpoints by feature area, for example:

- `hubs.py` for hub routes
- `sources.py` for source ingestion routes
- `chat.py` for chat routes
- `faqs.py` and `guides.py` for generated content routes
- `memberships.py` for invites and member management

Each module creates an `APIRouter`, then exposes functions using decorators such as:

```python
@router.get(...)
@router.post(...)
@router.patch(...)
@router.delete(...)
```

Those decorators turn normal Python functions into HTTP endpoints.

## How these routes become part of the API

The routers are imported and registered in [`main.py`] using `app.include_router(...)`.

That means:

1. A request comes into the FastAPI app.
2. FastAPI matches the URL and HTTP method to one of the router functions in this folder.
3. Dependencies are resolved first.
4. The route function runs.
5. The returned value is serialised into the API response.

## Typical flow inside a route

Most route functions in this folder follow the same pattern:

1. Read request data from path params, query params, or a request body schema.
2. Resolve dependencies such as the current user or Supabase client.
3. Check access rules or role requirements.
4. Call the store/service layer to do the real database or business logic work.
5. Convert known errors into `HTTPException` responses.
6. Return a schema object or a simple response.

## Dependencies and helpers

A lot of the route functions use shared helpers from:

- `dependencies.py` for auth, clients, and rate limiting
- `access.py` for shared membership checks
- `errors.py` for mapping backend errors into HTTP responses
- `services/store.py` for most data access and business logic

So the routers are mainly the API boundary layer, not the main place where database logic lives.

## Why the functions look simple

These route functions are meant to stay fairly thin.

Their job is to:

- expose endpoints
- validate and shape request data
- enforce access rules
- call the correct backend logic
- return the correct response type

This keeps the routing layer easier to read and maintain.
