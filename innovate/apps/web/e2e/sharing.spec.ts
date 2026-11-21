import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createBoard, ROOT, signIn, uploadVideo } from "./helpers";

/**
 * M3 "done when": a share link opens without login. A guest favorites a reference and comments
 * on it at a timecode, and the owner sees it live.
 */

const MAIL_LOG = resolve(ROOT, ".data/e2e-mail.log");

async function boardWithVideo(page: Page, title: string) {
  const boardId = await createBoard(page, title);
  await uploadVideo(page, "scenes.mp4");
  const refId = page.url().split("/make/")[1]!.split("?")[0]!;
  const res = await page.request.post(`/api/boards/${boardId}/ops`, {
    data: { create: [{ id: crypto.randomUUID(), kind: "reference", referenceId: refId, x: 80, y: 80, w: 320, z: 1 }] },
  });
  expect(res.ok()).toBe(true);
  return { boardId, refId };
}

async function makeLink(page: Page, access: string, opts: { password?: string; expires?: string } = {}) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Link access").selectOption({ label: access });
  if (opts.password) await page.getByLabel("Link password").fill(opts.password);
  if (opts.expires) await page.getByLabel("Link expiry date").fill(opts.expires);
  const urls = page.getByTestId("share-url");
  await page.waitForTimeout(300); // let the dialog's initial list load settle
  const before = await urls.count();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(urls).toHaveCount(before + 1);
  const url = await urls.first().inputValue();
  await page.keyboard.press("Escape");
  return url;
}

async function guestPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  return ctx.newPage();
}

test("a guest favorites and comments at a timecode; the owner sees it live", async ({ page, browser }) => {
  const ownerEmail = await signIn(page);
  const { boardId } = await boardWithVideo(page, "Client review");
  await page.goto(`/boards/${boardId}`);
  const url = await makeLink(page, "Can view, favorite and comment");
  expect(url).toMatch(/\/s\/[\w-]{20,}$/);

  // Guest: no login.
  const guest = await guestPage(browser);
  await guest.goto(url);
  await expect(guest.getByTestId("shared-title")).toHaveText("Client review");
  await expect(guest.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await guest.getByTestId("shared-card").first().click();
  const video = guest.getByTestId("feedback-video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 2.06;
  });
  await expect(guest.getByTestId("feedback-tc")).toHaveText("00:00:02:01");

  // Owner presence is visible to the guest (both are in the room).
  await expect(guest.getByTestId("presence")).toBeVisible();

  // Favorite: asks for a name first.
  await guest.getByTestId("favorite").click();
  await guest.getByLabel("Your name").fill("Ana");
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByTestId("favorite-count")).toHaveText("1");
  await expect(guest.getByTestId("guest-name")).toContainText("Ana");

  // Comment pinned to the frame.
  await guest.getByLabel("Comment", { exact: true }).fill("Love how the bars hold here @Demo");
  await expect(guest.getByTestId("attach-tc")).toBeChecked();
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(guest.getByTestId("comment")).toContainText("Love how the bars hold here");
  await expect(guest.getByTestId("comment-tc")).toHaveText("00:00:02:01");

  // Owner, live, no reload.
  await expect(page.getByText(/Ana commented: “Love how the bars/)).toBeVisible();
  const badge = page.getByTestId("feedback-badge").first();
  await expect(badge).toContainText("✎ 1");
  await expect(badge).toContainText("♥ 1");
  await badge.click();
  const comment = page.getByTestId("feedback-panel").getByTestId("comment");
  await expect(comment).toContainText("Ana");
  await expect(comment).toContainText("guest");
  await expect(comment.getByTestId("comment-tc")).toHaveText("00:00:02:01");
  await expect(comment.locator("span.text-accent")).toHaveText(" @Demo");

  // Owner resolves; the guest sees the thread close live.
  await comment.getByTestId("resolve").click();
  await expect(guest.getByTestId("comment")).toHaveCount(0);

  // The owner got an email notification (dev mailer log).
  await expect
    .poll(() => (existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, "utf8") : ""))
    .toContain(`"to":"${ownerEmail}"`);
  const mail = readFileSync(MAIL_LOG, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { to: string; subject: string })
    .filter((m) => m.to === ownerEmail);
  expect(mail.at(-1)!.subject).toBe("Ana commented on scenes");

  // Activity feed.
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByTestId("activity")).toContainText("Ana commented on scenes");
  await expect(page.getByTestId("activity")).toContainText("Ana favorited scenes");
  await guest.context().close();
});

test("password, view-only and expired links", async ({ page, browser }) => {
  await signIn(page);
  const { boardId, refId } = await boardWithVideo(page, "Locked");
  await page.goto(`/boards/${boardId}`);
  const locked = await makeLink(page, "Can view, favorite and comment", { password: "winter-ad" });
  const viewOnly = await makeLink(page, "Can view");
  const expired = await makeLink(page, "Can view", { expires: "2020-01-01" });

  const guest = await guestPage(browser);
  await guest.goto(locked);
  await expect(guest.getByRole("heading", { name: "This board is protected" })).toBeVisible();
  await guest.getByLabel("Password").fill("nope");
  await guest.getByRole("button", { name: "Open board" }).click();
  await expect(guest.getByText("That password isn't right.")).toBeVisible();
  await guest.getByLabel("Password").fill("winter-ad");
  await guest.getByRole("button", { name: "Open board" }).click();
  await expect(guest.getByTestId("shared-title")).toHaveText("Locked");

  await guest.goto(viewOnly);
  await expect(guest.getByTestId("shared-title")).toHaveText("Locked");
  await guest.getByTestId("shared-card").first().click();
  await expect(guest.getByTestId("favorite")).toBeDisabled();
  await expect(guest.getByLabel("Comment", { exact: true })).toHaveCount(0);
  const token = viewOnly.split("/s/")[1];
  const denied = await guest.request.post(`/api/s/${token}/feedback`, { data: { referenceId: refId, body: "sneaky" } });
  expect(denied.status()).toBe(403);

  await guest.goto(expired);
  await expect(guest.getByRole("heading", { name: "This link has expired" })).toBeVisible();

  // Turning a link off takes effect immediately.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const row = page.getByTestId("share-links").locator("li").filter({ has: page.locator(`input[value="${viewOnly}"]`) });
  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Escape");
  await guest.goto(viewOnly);
  await expect(guest.getByRole("heading", { name: "This link was turned off" })).toBeVisible();
  await guest.context().close();
});

test("share links only reach their own board", async ({ page, browser }) => {
  await signIn(page);
  const shared = await createBoard(page, "Shared one");
  const other = await createBoard(page, "Private one");
  await page.goto(`/boards/${shared}`);
  const url = await makeLink(page, "Can view");
  const guest = await guestPage(browser);
  await guest.goto(`${url}?board=${other}`);
  await expect(guest.getByRole("heading", { name: "Not part of this link" })).toBeVisible();
  const token = url.split("/s/")[1];
  const res = await guest.request.get(`/api/s/${token}/feedback?boardId=${other}`);
  expect(res.status()).toBe(404);
  await guest.context().close();
});

test("board edits appear live in another tab", async ({ page }) => {
  await signIn(page);
  const id = await createBoard(page, "Live edits");
  await page.goto(`/boards/${id}`);
  const other = await page.context().newPage();
  await other.goto(`/boards/${id}`);
  await expect(other.getByTestId("board-canvas")).toBeVisible();
  await page.waitForTimeout(500); // both tabs connected
  await page.getByTestId("board-canvas").click({ position: { x: 500, y: 400 } });
  await page.keyboard.press("n");
  await page.keyboard.type("Seen from the other tab");
  await page.getByTestId("board-canvas").click({ position: { x: 900, y: 700 } });
  await expect(other.locator("[data-kind=note]")).toContainText("Seen from the other tab");
});
