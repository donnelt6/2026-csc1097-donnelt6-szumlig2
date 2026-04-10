import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/true",
  // This suite can legitimately spend several minutes on ingestion plus one
  // real grounded answer, so the test budget must exceed both waits combined.
  timeout: 450_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalSetup: "./e2e/true/setup.mjs",
  globalTeardown: "./e2e/true/cleanup.mjs",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    env: {
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL:
        process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL ?? "http://127.0.0.1:3000",
    },
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
