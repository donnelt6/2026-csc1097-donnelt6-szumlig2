# Web Test Guide

This folder documents the frontend test strategy for Caddie.

The web app uses three layers. Choose the lightest layer that can catch the regression you care about.

## Test Layers

Component tests:

- Live in `tests/`
- Run in jsdom
- Mock API calls and selected Next.js helpers
- Best for isolated UI behavior, permissions-driven rendering, form interactions, and component state changes

Mocked E2E:

- Live in `../e2e/`
- Run the real Next.js app in Playwright
- Replace browser auth with the deterministic fake auth client in `lib/e2eAuth.ts`
- Mock API traffic so CI does not need a live backend, worker, Redis, or Supabase project
- Best for stable browser journeys such as auth entry, upload UX, and chat UI flows

True E2E:

- Live in `../e2e/true/`
- Run the real web app against the real local stack and external integrations
- Best for highest-confidence checks across auth, ingestion, and chat
- Most expensive layer to run and maintain

## Which Layer To Run

Run component tests when:

- you changed UI rendering logic
- you changed local component state or props
- you changed API error handling or empty/loading states

Run mocked E2E when:

- you changed a full browser journey
- you need confidence in route-level integration between pages and components
- you want a CI-friendly end-to-end check without the real backend stack

Run true E2E when:

- you changed real auth, ingestion, worker, storage, or retrieval integration
- you need to verify the whole stack together
- you are preparing for a release or final acceptance pass

## Dependencies

Component tests require:

- `npm install`

Mocked E2E requires:

- `npm install`
- Playwright browser support
- the local Next.js app launched by the test command

True E2E requires:

- `npm install`
- Playwright browser support
- running web, API, worker, and Redis services
- valid Supabase and OpenAI credentials
- true E2E env vars and test credentials

## Commands

Component tests:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run test
```

Mocked E2E:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run test:e2e
```

True E2E:

```powershell
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm run test:e2e:true
```

## Notes

- Mocked E2E is the default browser-layer choice for CI.
- True E2E should stay small and high-value, because it depends on the real stack.
- If a change can be covered well by a component test, prefer that over expanding the heavier suites.
