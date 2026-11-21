import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createBoard, editorRefId, exportAndSave, ffprobe, signIn, uploadVideo } from "./helpers";

/**
 * M7 "done when": build and present a treatment deck with GIFs, publish a reel link, and publish
 * a portfolio page. Plus the deck PDF (posters for motion) and the reel's optional MP4 render.
 */

test("treatment deck: draft from a board, edit, present with GIFs, share, PDF", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const boardId = await createBoard(page, "Winter Ad");
  await uploadVideo(page, "scenes.mp4");
  const film = editorRefId(page);
  await exportAndSave(page, film, { kind: "gif", inFrame: 50, outFrame: 74 }, { title: "Bars GIF", boardId });
  await exportAndSave(page, film, { kind: "still", frame: 150 }, { title: "Gradient still", boardId });

  // New deck from the treatment template, drafted from the board.
  await page.goto("/decks");
  await page.getByLabel("Template").selectOption("treatment");
  await page.getByLabel("Draft from board").selectOption({ label: "From: Winter Ad" });
  await page.getByRole("button", { name: "New deck" }).click();
  await expect(page).toHaveURL(/\/decks\/[0-9a-f-]{36}$/);
  const deckId = page.url().split("/decks/")[1]!;
  const thumbs = page.getByTestId("slide-thumb");
  await expect(thumbs).toHaveCount(7);
  for (const [i, h] of ["Logline", "Tone", "Look and feel", "Characters", "Locations", "Shot approach"].entries())
    await expect(thumbs.nth(i + 1)).toHaveAccessibleName(new RegExp(`Slide ${i + 2}: ${h}`));
  await expect(page.getByTestId("slide-editor").getByLabel("Slide heading")).toHaveValue("Winter Ad: treatment");

  // The shot-approach slide got the board's GIF (motion first).
  await thumbs.nth(6).click();
  await expect(page.getByTestId("slide-editor").getByRole("button", { name: /Media 1: Bars GIF/ })).toBeVisible();

  // Edit the logline.
  await thumbs.nth(1).click();
  const editor = page.getByTestId("slide-editor");
  await editor.getByLabel("Slide text").fill("A night-shift nurse drives home through the first snow and finds the town gone quiet.");
  // Add a full-bleed GIF slide after it, filled from the media panel.
  await page.getByLabel("Add slide").selectOption("media");
  await expect(thumbs).toHaveCount(8);
  await page.getByTestId("media-picker").getByRole("button", { name: "Add Bars GIF" }).click();
  await expect(editor.getByRole("button", { name: /Media 1: Bars GIF/ })).toBeVisible();
  await editor.getByLabel("Slide heading").fill("The first snow");
  await page.getByTestId("deck-title").fill("Winter Ad: treatment v1");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10_000 });
  await page.reload();
  await expect(thumbs).toHaveCount(8);
  await expect(thumbs.nth(2)).toHaveAccessibleName(/Slide 3: The first snow/);

  // Present: keyboard through the slides; the GIF slide plays the GIF.
  await page.getByRole("link", { name: "Present" }).click();
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}/present`));
  const presenter = page.getByTestId("presenter");
  await page.keyboard.press("Home");
  await expect(presenter.getByTestId("slide-counter")).toHaveText("1 / 8");
  await expect(presenter.getByText("Winter Ad: treatment v1").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(presenter.getByTestId("slide-counter")).toHaveText("2 / 8");
  await expect(presenter).toContainText("A night-shift nurse drives home");
  await page.keyboard.press("ArrowRight");
  await expect(presenter.getByTestId("slide-counter")).toHaveText("3 / 8");
  const gif = presenter.locator('[data-testid="slide-media"] img[src*=".gif"]');
  await expect(gif).toBeVisible(); // animated GIF shown (not the still poster canvas)
  await expect(page).toHaveURL(/#slide-3$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/decks/${deckId}$`));

  // Share as a view-only link; a guest presents it without signing in.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByTestId("share-url").first().inputValue();
  await page.keyboard.press("Escape");
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(`${url}#slide-3`);
  await expect(guest.getByTestId("slide-counter")).toHaveText("3 / 8");
  await expect(guest.locator('[data-testid="slide-media"] img[src*=".gif"]')).toBeVisible();
  await guest.keyboard.press("ArrowLeft");
  await expect(guest.getByTestId("slide-counter")).toHaveText("2 / 8");
  await guestCtx.close();

  // PDF: one page per slide, posters embedded, motion linked to the live deck.
  const dl = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "PDF" }).click();
  const pdf = await dl;
  expect(pdf.suggestedFilename()).toBe("winter-ad-treatment-v1_deck.pdf");
  const raw = readFileSync((await pdf.path())!).toString("latin1");
  expect(raw.startsWith("%PDF-")).toBe(true);
  expect(raw.match(/\/Type \/Page\b/g)?.length).toBe(8);
  expect(raw).toMatch(/\/Subtype \/Image/);
  expect(raw).toContain(`/s/${url.split("/s/")[1]}#slide-`);
});

test("reel: sequence with trims and cards, a published link, and an MP4 render", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await uploadVideo(page, "scenes.mp4");
  const film = editorRefId(page);
  await exportAndSave(page, film, { kind: "clip", inFrame: 100, outFrame: 149 }, { title: "Two-second clip" });

  await page.goto("/reels");
  await page.getByRole("button", { name: "New reel" }).click();
  await expect(page).toHaveURL(/\/reels\/[0-9a-f-]{36}$/);
  await page.getByTestId("reel-title").fill("Showreel 2026");
  await page.getByLabel("Title", { exact: true }).first().fill("Jane Doe");
  await page.getByLabel("Subtitle").fill("Director");
  await page.getByLabel("Title", { exact: true }).nth(1).fill("Thank you");
  await page.getByLabel("Contact").fill("jane@example.com");

  const picker = page.getByTestId("media-picker");
  await picker.getByRole("button", { name: "Add to reel: scenes" }).click();
  await picker.getByRole("button", { name: "Add to reel: Two-second clip" }).click();
  await expect(page.getByTestId("reel-item")).toHaveCount(2);

  // Trim the film to 1.0 s – 3.0 s.
  await page.getByTestId("reel-item").first().click();
  await page.getByLabel("Trim in, seconds").fill("1");
  await page.getByLabel("Trim out, seconds").fill("3");
  // 2.5 s title + 2 s film + 2 s clip + 2.5 s end card = 9 s.
  await expect(page.getByTestId("reel-total")).toHaveText("0:09.0");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 10_000 });

  // Publish as a link; the guest gets a clean player that plays title card → clips → end card.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByTestId("share-url").first().inputValue();
  await page.keyboard.press("Escape");
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(url);
  await expect(guest.getByTestId("shared-title")).toHaveText("Showreel 2026");
  await guest.getByRole("button", { name: "Play Showreel 2026" }).click();
  await expect(guest.getByTestId("reel-card")).toContainText("Jane Doe");
  await expect(guest.getByTestId("reel-player")).toHaveAttribute("data-segment", "1", { timeout: 6_000 });
  await expect(guest.getByTestId("reel-video")).toBeVisible();
  await expect.poll(() => guest.getByTestId("reel-video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5_000 }).toBeGreaterThan(1.05);
  await expect(guest.getByTestId("reel-player")).toHaveAttribute("data-segment", "3", { timeout: 10_000 });
  await expect(guest.getByTestId("reel-card")).toContainText("Thank you");
  await guestCtx.close();

  // Optional MP4 render on the worker: 1080p, cards included, audio throughout.
  const dl = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "Render MP4" }).click();
  const mp4 = await dl;
  expect(mp4.suggestedFilename()).toBe("showreel-2026_reel.mp4");
  const info = ffprobe((await mp4.path())!);
  const v = info.streams.find((s) => s.codec_type === "video")!;
  expect([v.codec_name, v.width, v.height]).toEqual(["h264", 1920, 1080]);
  expect(info.streams.some((s) => s.codec_type === "audio" && s.codec_name === "aac")).toBe(true);
  expect(Number(info.format.duration)).toBeGreaterThan(8.8);
  expect(Number(info.format.duration)).toBeLessThan(9.3);
  await expect(page.getByTestId("render-download")).toBeVisible();
});

test("portfolio: publish a page with a custom address, bio, contact, a GIF and a reel", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await uploadVideo(page, "scenes.mp4");
  const film = editorRefId(page);
  await exportAndSave(page, film, { kind: "gif", inFrame: 50, outFrame: 74 }, { title: "Bars GIF" });
  const reel = await (await page.request.post("/api/reels", { data: { title: "Car work" } })).json();
  const put = await page.request.put(`/api/reels/${reel.reel.id}`, {
    data: { title: "Car work", titleCard: "Car work", titleCardSub: "", endCard: "", endCardSub: "", items: [{ id: crypto.randomUUID(), referenceId: film, inSec: 0, outSec: 2 }] },
  });
  expect(put.ok()).toBe(true);

  const slug = `jane-${Date.now().toString(36)}`;
  await page.goto("/portfolio");
  await page.getByLabel("Portfolio address").fill("No");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Use at least 3 characters.")).toBeVisible();

  await page.getByLabel("Portfolio address").fill(slug);
  await page.getByLabel("Portfolio title").fill("Jane Doe, director");
  await page.getByLabel("Bio").fill("Commercials and short films. Quiet light, long takes.");
  await page.getByLabel("Contact email").fill("jane@example.com");
  await page.getByLabel("Website").fill("https://example.com");
  await page.getByRole("button", { name: "Feature" }).click();
  await page.getByLabel("Add a reel").selectOption({ label: "Car work" });
  await page.getByTestId("media-picker").getByRole("button", { name: "Add to portfolio: Bars GIF" }).click();
  await expect(page.getByTestId("portfolio-row")).toHaveCount(2);
  await page.getByLabel("Caption for Bars GIF").fill("Test pattern study");
  await page.getByLabel(/Published/).check();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByTestId("portfolio-public-link")).toHaveAttribute("href", `/p/${slug}`);

  // Anyone can open it, no login.
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(new URL(`/p/${slug}`, page.url()).toString());
  await expect(guest.getByTestId("portfolio-title")).toHaveText("Jane Doe, director");
  await expect(guest.getByText("Quiet light, long takes.")).toBeVisible();
  await expect(guest.getByTestId("portfolio-contact")).toContainText("jane@example.com");
  await expect(guest.getByTestId("portfolio-item")).toHaveCount(2);
  await expect(guest.getByTestId("reel-player")).toBeVisible();
  await expect(guest.getByText("Test pattern study")).toBeVisible();

  // Another workspace can't take the address; unpublishing takes the page down.
  const other = await browser.newContext();
  const op = await other.newPage();
  await signIn(op);
  const clash = await op.request.put("/api/portfolio", { data: { slug, items: [] } });
  expect(clash.status()).toBe(409);
  await other.close();
  await page.getByLabel(/Published/).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("portfolio-public-link")).toHaveCount(0);
  const gone = await guest.goto(new URL(`/p/${slug}`, page.url()).toString());
  expect(gone?.status()).toBe(404);
  await guestCtx.close();
});
