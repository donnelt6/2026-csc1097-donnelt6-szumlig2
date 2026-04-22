# Caddie Web

This app is the Next.js frontend for Caddie. It is the main user-facing surface for authentication, hub management, source ingestion, reminders, guides, FAQs, moderation, analytics, and chat.

## Main Responsibilities

- Authenticate users with Supabase Auth
- Render hub and dashboard workflows
- Call the FastAPI backend for product actions
- Maintain client-side session, selection, and UI state
- Provide browser-based test entrypoints for component tests and E2E suites

## Run Locally

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm install
npm run dev
```

Required environment variables live in `.env.example`.

At minimum, local development needs:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Route Structure

Top-level routes are organised under `app/`.

Important routes include:

- `app/page.tsx`: main landing page and hub list entry
- `app/auth/page.tsx`: sign-in and sign-up flow
- `app/auth/callback/`: auth callback handling
- `app/auth/forgot-password/`: recovery request flow
- `app/auth/reset-password/`: password reset completion flow
- `app/hubs/[hubId]/page.tsx`: hub-level workspace for sources, chat, members, reminders, dashboard content, and moderation/admin features
- `app/settings/`: user settings

## Auth Flow

The web app uses Supabase Auth in the browser.

High-level flow:

1. The user signs in or signs up through the auth pages
2. `components/auth/AuthProvider.tsx` tracks the browser session
3. `components/auth/AuthGate.tsx` protects authenticated routes
4. API calls from `lib/api.ts` include the Supabase JWT when required
5. Recovery flows are handled through the auth callback, forgot-password, and reset-password routes

For local development, recovery links are built from the current browser origin. Hosted environments should set `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` correctly.

## Folder Guide

- `app/`: route entrypoints and layout files
- `components/`: UI components grouped by feature area
- `components/auth/`: auth-specific client components
- `components/dashboard/`: dashboard-specific UI
- `components/hub-dashboard/`: hub dashboard pages and related controls
- `components/navigation/`: sidebar, notifications, theme, and profile navigation
- `lib/api.ts`: API client helpers
- `lib/supabaseClient.ts`: browser Supabase client setup
- `lib/e2eAuth.ts`: deterministic fake auth surface used by mocked E2E runs
- `lib/useSourceSelection.ts`: per-hub selected-source persistence
- `tests/`: jsdom component tests
- `e2e/`: Playwright suites

## UI Feature Areas

Important component groups include:

- `HubsList` and related hub navigation components
- `UploadPanel` and source management controls
- `ChatPanel` and source selection controls
- `FaqPanel` and dashboard content pages
- `MembersPanel` and moderation/admin panels
- reminders, notifications, and dashboard views

## Test Layers

The frontend has three distinct test layers.

Component tests:

- Live in `tests/`
- Run in jsdom
- Mock API calls and Next.js helpers
- Best for component behavior, state transitions, and permissions-driven UI cases

Mocked E2E:

- Live in `e2e/`
- Run the real Next.js app in a browser
- Use deterministic fake auth plus mocked API responses
- Best for stable browser-journey coverage in CI without requiring the full backend stack

True E2E:

- Live in `e2e/true/`
- Run against the real web app, API, worker, Redis, Supabase auth/storage, and live OpenAI-backed flows
- Best for highest-confidence end-to-end checks, but also the heaviest and least convenient layer

Commands:

```powershell
npm run test
npm run test:e2e
npm run test:e2e:true
```

See `tests/README.md` for test selection guidance.

## Notes

- Drag-and-drop guide ordering uses `@dnd-kit`.
- The app relies on the API for product behavior; mocked E2E intentionally does not validate real backend integration.
- When debugging auth or upload issues, verify both browser env vars and the matching API configuration.
