# Store Package Guide

This folder contains the split Supabase-backed store layer for the Caddie API.

It is the main backend domain and persistence layer behind the router modules. Router files should stay thin and delegate most data access and business logic into this package.

## Why This Package Exists

Earlier versions of the store layer were too large and difficult to navigate as a single file. This package now splits store responsibilities by domain while preserving the existing import surface through `app.services.store`.

That means:

- code can be organised by feature ownership
- large backend behaviors are easier to find and maintain
- existing imports can still use the compatibility facade from `__init__.py`

## How It Is Composed

`__init__.py` builds `SupabaseStore` by combining domain-specific mixins plus the shared base class.

High-level composition:

- `StoreBase`: common base behavior and shared store state
- domain mixins: feature-specific operations
- helper modules: support functions used by the main mixins
- `store`: module-level shared store instance

## Domain Map

Primary domain mixins:

- `hubs.py`: hub CRUD and hub-level data access
- `sources.py`: source creation, lifecycle management, and source-row operations
- `chat.py`: retrieval-backed chat behavior and chat session/message operations
- `memberships.py`: invites, roles, and member-management behavior
- `moderation.py`: flagged chat and moderation workflows
- `analytics.py`: analytics reads and related aggregate behavior
- `content.py`: generated FAQ and guide behavior
- `reminders.py`: reminder CRUD and scheduling-related access
- `activity.py`: activity feed or activity-tracking reads/writes
- `users.py`: current-user and profile-related data access

Shared support modules:

- `base.py`: base class and shared store exceptions
- `chat_helpers.py`: chat-specific helper functions
- `source_helpers.py`: source naming, path, URL, and ID helpers
- `common_helpers.py`: shared utility helpers used across domains
- `internals.py`: internal helper logic used by store modules

## How To Navigate Changes

If you are changing:

- hub metadata or hub queries, start in `hubs.py`
- upload, web, or YouTube source behavior, start in `sources.py` and `source_helpers.py`
- answer generation, retrieval shaping, or citation behavior, start in `chat.py` and `chat_helpers.py`
- memberships or invite rules, start in `memberships.py`
- moderation or flag workflows, start in `moderation.py`
- generated FAQs or guides, start in `content.py`
- reminders, start in `reminders.py`

If a helper is domain-specific, keep it close to that domain. If it is reused across multiple domains, move it into one of the shared helper modules.

## Design Intent

This package owns:

- Supabase reads and writes
- domain-level persistence behavior
- retrieval and content-generation orchestration closely tied to stored data
- backend-side access patterns used by routers and services

This package should not become the HTTP layer. Route parsing, request validation, and response shaping still belong in `app/routers/` and `app/schemas.py`.

## Compatibility Note

The compatibility facade in `__init__.py` re-exports the composed `SupabaseStore`, the shared `store` instance, and selected helpers.

That compatibility layer exists so the store can stay split internally without forcing a broad import-path rewrite across the API.
