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
export const MAIL_LOG = resolve(root, ".data/e2e-mail.log");
export const SMS_LOG = resolve(root, ".data/e2e-sms.log");
const RT_PORT = Number(process.env.E2E_REALTIME_PORT ?? 3101);
const SITES_PORT = Number(process.env.E2E_SITES_PORT ?? 3199);
const env = {
  MAGIC_LINK_LOG_FILE: MAGIC_LINK_LOG,
  MAIL_LOG_FILE: MAIL_LOG,
  AUTH_URL: `http://localhost:${PORT}`,
  INNOVATE_E2E: "1",
  REALTIME_PORT: String(RT_PORT),
  REALTIME_PUBLIC_URL: `ws://localhost:${RT_PORT}`,
  // The fake sites (e2e/fake-sites.mjs) live on localhost, so the e2e worker may fetch private hosts.
  INGEST_ALLOW_PRIVATE_URLS: "true",
  E2E_SITES_PORT: String(SITES_PORT),
  INGEST_VIMEO_ENABLED: "true",
  VIMEO_ACCESS_TOKEN: "e2e-vimeo-token",
  VIMEO_API_BASE: `http://localhost:${SITES_PORT}/vimeo-api`,
  // Agents and reference descriptions talk to a scripted fake of the Anthropic API (e2e/fake-sites.mjs).
  ANTHROPIC_API_KEY: "e2e-anthropic-key",
  ANTHROPIC_BASE_URL: `http://localhost:${SITES_PORT}/anthropic`,
  // Text-to-save: tests sign webhook requests with this token; codes go to the SMS log (no Twilio account).
  TWILIO_AUTH_TOKEN: "e2e-twilio-token",
  TWILIO_PHONE_NUMBER: "+15005550006",
  TWILIO_WEBHOOK_URL: `http://localhost:${PORT}/api/twilio/inbound`,
  SMS_LOG_FILE: SMS_LOG,
};

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
      command: "node e2e/fake-sites.mjs",
      env,
      url: `http://localhost:${SITES_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: "pnpm --filter @innovate/realtime start",
      cwd: root,
      env,
      url: `http://localhost:${RT_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
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
