import { defineConfig } from "@playwright/test";

// End-to-end smoke test. Expects local Supabase (seeded), `pnpm dev` and the Inngest dev
// server; see README "Testing". AI_MOCK=1 keeps it deterministic and free.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
