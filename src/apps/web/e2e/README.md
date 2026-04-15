# Web E2E Guide

This folder contains the Playwright browser-level test suites for the Caddie web app.

There are two different E2E layers here:

- mocked E2E in this folder
- true real-stack E2E in `true/`

They serve different purposes and should not be treated as interchangeable.

## Mocked E2E

Files in the top level of `e2e/` such as:

- `auth.spec.ts`
- `upload.spec.ts`
- `chat.spec.ts`

run the real Next.js app in Playwright, but replace external dependencies with controlled test seams.

Key characteristics:

- browser auth is replaced with the deterministic fake auth client
- API traffic is mocked through fixtures such as `fixtures/mockApi.ts`
- CI does not need a live API, worker, Redis, Supabase project, or OpenAI access

Use mocked E2E when you want confidence in:

- route-to-component browser journeys
- key user flows in a stable CI-friendly form
- UI integration that is broader than a component test but does not need the full backend stack

Run it with:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run test:e2e
```

## True Real-Stack E2E

The `true/` folder contains the heavier browser suite that runs against the real local stack.

Important files include:

- `true/real-ingestion-chat.spec.js`
- `true/setup.mjs`
- `true/cleanup.mjs`
- `true/support/`

Key characteristics:

- uses the real web app, API, worker, Redis, Supabase auth/storage, and live OpenAI-backed flows
- setup and cleanup scripts create or reset dedicated test state
- validates the actual integration between auth, ingestion, retrieval, and chat

Use true E2E when you need confidence in:

- full-stack ingestion behavior
- real auth and storage integration
- release-level or acceptance-style verification

Run it with:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run test:e2e:true
```
