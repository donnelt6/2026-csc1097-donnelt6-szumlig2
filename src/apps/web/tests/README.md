# Web Tests

These tests cover UI components with mocked API calls and Next.js helpers.
They run in a jsdom environment and do not require a backend.

What is tested
- Auth routing behavior in `AuthGate`.
- Hub listing and filtering in `HubsList`.
- Upload flow, retries, and permissions in `UploadPanel`.
- FAQ generation UI in `FaqPanel`.

Run the tests
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm install
npm run test
```

Playwright E2E
- `apps/web/e2e/` runs a very small browser suite against the real Next.js app.
- E2E mode swaps in a deterministic fake auth client and uses mocked API responses, so CI does not need a live Supabase project or backend stack.

Run the E2E suite
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm install
npm run test:e2e
```

True E2E
- `apps/web/e2e/true/` runs a separate real-stack browser suite against the real Next.js app, API, worker, Redis, Supabase auth/storage, and live OpenAI-backed ingestion/chat.
- The setup and cleanup scripts reset a dedicated hub namespace for the current run id instead of mocking auth or API traffic.

Run the true E2E suite
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/web
npm install
npm run test:e2e:true
```
