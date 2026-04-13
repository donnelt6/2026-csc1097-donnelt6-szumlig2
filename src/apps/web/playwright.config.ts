import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/true/**"],
  // CI hits the first /hubs route cold in Next dev mode, so give navigation
  // and compile time more headroom than local runs.
  timeout: process.env.CI ? 60_000 : 30_000,
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    headless: true,
    navigationTimeout: process.env.CI ? 45_000 : 30_000,
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    env: {
      NEXT_PUBLIC_E2E_TEST_MODE: "true",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000",
    },
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
