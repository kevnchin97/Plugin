import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, test as base } from "@playwright/test";
import { createBoard, signIn } from "./helpers";

/**
 * M4 "done when": the Chrome extension saves images, videos and pages to a board.
 * Loads the real built extension (apps/extension/dist) into Chromium and drives its popup and
 * service worker against the local fake sites.
 */
/** The slice of the extension API these tests call from extension pages. */
declare const chrome: {
  tabs: { query(q: { url: string }): Promise<{ id?: number }[]> };
  runtime: { sendMessage(msg: unknown): Promise<{ ok: boolean; message: string; url: string; savedAs?: string }> };
};

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");
const APP = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SITES = `http://localhost:${process.env.E2E_SITES_PORT ?? 3199}`;

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // Fixture callbacks are named `provide` (not `use`) so the React hooks lint rule doesn't misfire.
  context: async ({}, provide) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      baseURL: APP,
      viewport: { width: 1500, height: 900 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await provide(context);
    await context.close();
  },
  extensionId: async ({ context }, provide) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await provide(new URL(sw.url()).host);
  },
});

test("the extension saves a page, an image and a video to a board", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await signIn(page);
  const boardId = await createBoard(page, "From the web");

  // Token from Settings.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  expect(token).toMatch(/^inv_/);

  // Connect the extension.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Innovate address").fill(APP);
  await options.getByLabel("Token").fill(token);
  await options.getByRole("button", { name: "Save and connect" }).click();
  await expect(options.getByRole("status")).toContainText("Connected.");

  // A web page to save from.
  const site = await context.newPage();
  await site.goto(`${SITES}/page.html`);
  const tabId = await options.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]!.id!, SITES);

  // 1. Page, via the popup with the board picker.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.locator("#title")).toHaveText("Fake gallery: winter light");
  await popup.getByLabel("Board").selectOption({ label: "From the web" });
  await popup.getByRole("button", { name: "Save to Innovate" }).click();
  await expect(popup.getByRole("status")).toHaveText("Saved page to From the web");

  // 2. Image (what "Save image to Innovate" does): best version from srcset, then save.
  const best = await popup.evaluate(
    ([tab, src]) => chrome.runtime.sendMessage({ type: "resolve-image", tabId: tab, srcUrl: src }),
    [tabId, `${SITES}/photo-small.png`] as const,
  );
  expect(best.url).toBe(`${SITES}/photo-large.png`);
  const img = await popup.evaluate(
    ([url, page]) => chrome.runtime.sendMessage({ type: "save", payload: { kind: "image", url, pageUrl: page, title: "Winter light still" } }),
    [best.url, `${SITES}/page.html`] as const,
  );
  expect(img).toMatchObject({ ok: true, savedAs: "image" });

  // 3. Video (what "Save video to Innovate" does).
  const vid = await popup.evaluate(
    ([url, page]) => chrome.runtime.sendMessage({ type: "save", payload: { kind: "video", url, pageUrl: page, title: "Winter clip" } }),
    [`${SITES}/clip.mp4`, `${SITES}/page.html`] as const,
  );
  expect(vid).toMatchObject({ ok: true, savedAs: "video" });

  // All three on the board; the image and the page preview imported, the video ingested.
  await page.goto(`/boards/${boardId}`);
  const cards = page.locator("[data-item-id][data-kind=reference]");
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "Fake gallery: winter light" })).toContainText(`localhost`);
  await expect
    .poll(
      async () => {
        await page.reload();
        const imgs = await page.locator("[data-item-id][data-kind=reference] img").count();
        const processing = await page.getByText("Processing…").count();
        return imgs >= 3 && processing === 0;
      },
      { timeout: 60_000, intervals: [1500] },
    )
    .toBe(true);
  const refs = (await (await page.request.get("/api/references")).json()).references as { title: string; type: string; sourceUrl: string; status: string; width: number }[];
  expect(refs.find((r) => r.title === "Winter light still")).toMatchObject({ type: "image", status: "ready", sourceUrl: `${SITES}/photo-large.png`, width: 600 });
  expect(refs.find((r) => r.title === "Winter clip")).toMatchObject({ type: "video", status: "ready" });
  expect(refs.find((r) => r.type === "link")).toMatchObject({ title: "Fake gallery: winter light", sourceUrl: `${SITES}/page.html` });
});

test("a platform video the server can't import falls back to saving the page", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Innovate address").fill(APP);
  await options.getByLabel("Token").fill(token);
  await options.getByRole("button", { name: "Save and connect" }).click();
  await expect(options.getByRole("status")).toContainText("Connected.");
  const r = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: "save", payload: { kind: "video", url: "https://www.youtube.com/watch?v=abc", pageUrl: "https://www.youtube.com/watch?v=abc", title: "Some video" } }),
  );
  expect(r).toMatchObject({ ok: true, savedAs: "link" });
  expect(r.message).toContain("Saved the page");
});
