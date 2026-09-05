import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.OKF_E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  fullyParallel: false,
  // One worker: multiple spec files publish bundles against the same shared
  // Postgres/Redis backend, and POST /api/v1/bundles is rate-limited per
  // publisher (server/ratelimit.ts) — running spec files concurrently trips
  // that limiter and produces flaky 429s that have nothing to do with the
  // feature under test.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      OKF_INLINE_MINT: "1",
      OKF_DATA_DIR: process.env.OKF_DATA_DIR ?? "./.data/okf-e2e",
      OKF_PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://okf:okf_local_dev@localhost:5432/okf_anchor",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    },
  },
});
