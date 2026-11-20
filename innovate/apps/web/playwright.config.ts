import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the milestone "done when" criteria. Needs `docker compose up`,
 * migrations, and the fixtures (`pnpm fixtures`). Playwright starts the worker and a
 * production build of the web app unless they're already running (reuseExistingServer).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MAGIC_LINK_LOG = resolve(root, ".data/e2e-magic-links.log");
const PORT = Number(process.env.E2E_PORT ?? 3100);
const env = { MAGIC_LINK_LOG_FILE: MAGIC_LINK_LOG, AUTH_URL: `http://localhost:${PORT}`, INNOVATE_E2E: "1" };

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    viewport: { width: 1600, height: 960 },
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 960 } } }],
  webServer: [
    {
      command: "pnpm --filter @innovate/worker start",
      cwd: root,
      env,
      // The worker has no HTTP port; Playwright waits on the web server and the tests wait on jobs.
      reuseExistingServer: true,
      stdout: "pipe",
      timeout: 60_000,
      wait: { stdout: /listening on "media"/ },
    },
    {
      command: `pnpm --filter @innovate/web build && pnpm --filter @innovate/web exec next start --port ${PORT}`,
      cwd: root,
      env,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
