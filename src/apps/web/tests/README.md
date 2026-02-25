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
