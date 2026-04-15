# Shared Packages

This folder contains shared contracts used across the Caddie codebase.

The project has both TypeScript and Python runtimes, so shared contract code exists in both languages:

- the Next.js frontend needs TypeScript types
- the FastAPI API and Celery worker need Python schemas and models

## Why There Are Two Shared Packages

The web app, API, and worker all work with many of the same concepts:

- hubs
- sources
- chat messages
- memberships
- generated content

Those runtimes cannot consume the same source files directly, because the frontend runs in TypeScript while the backend services run in Python.

So the repo keeps two language-appropriate shared packages:

- `shared/`: shared TypeScript contracts for frontend-facing code
- `shared/python/`: shared Python schemas for backend-facing code

This avoids duplicating contract intent across every app while still fitting the language and tooling used by each runtime.

## Folder Guide

- `shared/`: TypeScript package exported through `index.ts`
- `shared/python/`: Python package exposing shared schemas through `shared_schemas/`

## When To Change These Packages

Update shared packages when:

- a cross-service contract changes shape
- a request or response model needs to stay aligned across apps
- a shared product concept is being duplicated in multiple runtimes

Do not add app-specific UI logic or service-specific persistence details here. These packages should stay focused on shared contracts, not implementation behavior.