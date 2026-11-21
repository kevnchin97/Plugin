import { expect, test } from "@playwright/test";
import { createBoard, dragTo, fixture, signIn, uploadVideo } from "./helpers";

/**
 * M2 "done when": save to a board with a parent link back to the source; a masonry grid with
 * native ratios, clusters (columns), drag and drop, and multi-select.
 */

test("an export saved to a board links back to its source range", async ({ page }) => {
  await signIn(page);
  await createBoard(page, "Night Exteriors");
  await uploadVideo(page, "scenes.mp4");
  await page.keyboard.press("]"); // 00:00:02:00
  await page.keyboard.press("i");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o"); // 00:00:03:00
  await page.getByTestId("save-to").selectOption({ label: "Night Exteriors" });
  await page.getByTestId("player").focus();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  const dl = page.waitForEvent("download");
  await page.keyboard.press("g");
  await dl;
  await page.keyboard.press("Enter");
  await expect(page.getByText(/to Night Exteriors/)).toBeVisible();

  // Home is a board; every board is a card on it. Double-click opens it.
  await page.goto("/");
  await page.locator("[data-item-id][data-kind=board]").filter({ hasText: "Night Exteriors" }).first().dblclick();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  const card = page.locator("[data-item-id][data-kind=reference]");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("00:00:02:00 → 00:00:03:00");
  await card.getByRole("link", { name: "Source" }).click();
  await expect(page).toHaveURL(/\/make\/[0-9a-f-]+\?in=50&out=75/);
  await expect(page.getByTestId("in-tc")).toHaveText("00:00:02:00");
  await expect(page.getByTestId("out-tc")).toHaveText("00:00:03:00");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:02:00");
});

test("columns, drag and drop, multi-select, undo, and persistence", async ({ page }) => {
  await signIn(page);
  const id = await createBoard(page, "Handheld Intimacy");
  await page.goto(`/boards/${id}`);
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();

  // A column and two notes.
  await page.locator("[data-tool=column]").click();
  await page.keyboard.type("Close-ups");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("column-title")).toHaveText("Close-ups");
  for (const text of ["Breath on glass", "Hands, not faces"]) {
    await canvas.click({ position: { x: 900, y: 700 } });
    await page.keyboard.press("n");
    await page.keyboard.type(text);
    await canvas.click({ position: { x: 900, y: 700 } });
  }
  const notes = page.locator("[data-item-id][data-kind=note]");
  await expect(notes).toHaveCount(2);

  // Multi-select both (Shift+click) and drag them into the column together.
  await notes.nth(0).click();
  await notes.nth(1).click({ modifiers: ["Shift"] });
  await dragTo(page, notes.nth(1), page.locator("[data-kind=column]"));
  const column = page.locator("[data-kind=column]");
  await expect(column.locator("[data-kind=note]")).toHaveCount(2);
  await expect(page.locator("[data-column-body] [data-kind=note]").first()).toContainText("Breath on glass");

  // Undo puts them back on the canvas; redo returns them.
  await canvas.click({ position: { x: 1100, y: 120 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(column.locator("[data-kind=note]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(column.locator("[data-kind=note]")).toHaveCount(2);

  // Persisted.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator("[data-kind=column] [data-kind=note]")).toHaveCount(2);
  await expect(page.getByTestId("column-title")).toHaveText("Close-ups");

  // Drag one back out onto the canvas.
  await dragTo(page, page.locator("[data-kind=column] [data-kind=note]").first(), { x: 1000, y: 650 });
  await expect(page.locator("[data-kind=column] [data-kind=note]")).toHaveCount(1);
});

test("Unsorted tray: uploads land there and drag onto the board and back", async ({ page }) => {
  await signIn(page);
  const id = await createBoard(page, "Commercial: Winter Ad");
  await page.goto(`/boards/${id}`);
  await page.getByTestId("board-file-input").setInputFiles(fixture("portrait.png"));
  const trayItem = page.getByTestId("tray-item");
  await expect(trayItem).toHaveCount(1);
  await dragTo(page, trayItem.first(), { x: 600, y: 400 });
  const card = page.locator("[data-item-id][data-kind=reference]");
  await expect(card).toHaveCount(1);
  await expect(trayItem).toHaveCount(0);
  // Native aspect ratio (2:3) on the canvas.
  const media = card.locator("img").first();
  await expect.poll(async () => {
    const b = await media.boundingBox();
    return b ? Math.round((b.width / b.height) * 100) / 100 : 0;
  }).toBeCloseTo(600 / 900, 1);
  await dragTo(page, card, page.getByTestId("tray"));
  await expect(card).toHaveCount(0);
  await expect(trayItem).toHaveCount(1);
});

test("nested boards: open a board card, breadcrumbs, and drop cards into it", async ({ page }) => {
  await signIn(page);
  const parent = await createBoard(page, "Winter Ad");
  await page.goto(`/boards/${parent}`);
  const canvas = page.getByTestId("board-canvas");
  await page.locator("[data-tool=board]").click();
  const boardCard = page.locator("[data-item-id][data-kind=board]");
  await expect(boardCard).toHaveCount(1);
  await canvas.click({ position: { x: 300, y: 650 } });
  await page.keyboard.press("n");
  await page.keyboard.type("Wardrobe: wool, no logos");
  await canvas.click({ position: { x: 1100, y: 700 } });
  await dragTo(page, page.locator("[data-kind=note]").first(), boardCard);
  await expect(page.locator("[data-kind=note]")).toHaveCount(0);
  await expect(boardCard).toContainText("1 card");

  await boardCard.dblclick();
  await expect(page).not.toHaveURL(new RegExp(parent));
  await expect(page).toHaveURL(/\/boards\//);
  await expect(page.getByRole("navigation", { name: "Breadcrumbs" })).toContainText("Winter Ad");
  await expect(page.locator("[data-kind=note]")).toContainText("Wardrobe: wool, no logos");
  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link", { name: "Winter Ad" }).click();
  await expect(page).toHaveURL(new RegExp(parent));
});

test("grid view: masonry of the same board, with multi-select moves into a column", async ({ page }) => {
  await signIn(page);
  const id = await createBoard(page, "Grid check");
  await page.goto(`/boards/${id}`);
  const canvas = page.getByTestId("board-canvas");
  await page.locator("[data-tool=column]").click();
  await page.keyboard.type("Selects");
  await page.keyboard.press("Enter");
  for (const t of ["One", "Two"]) {
    await canvas.click({ position: { x: 900, y: 700 } });
    await page.keyboard.press("n");
    await page.keyboard.type(t);
    await canvas.click({ position: { x: 900, y: 700 } });
  }
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const cards = page.getByTestId("grid-card");
  await expect(cards).toHaveCount(2);
  await cards.nth(0).click();
  await cards.nth(1).click({ modifiers: ["Shift"] });
  await page.getByLabel("Move selection to").selectOption({ label: "Selects" });
  await expect(page.getByRole("heading", { name: /Selects/ })).toContainText("2");
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.locator("[data-kind=column] [data-kind=note]")).toHaveCount(2);
});

test("arrows connect two cards and survive a reload", async ({ page }) => {
  await signIn(page);
  const id = await createBoard(page, "Arrows");
  await page.goto(`/boards/${id}`);
  const canvas = page.getByTestId("board-canvas");
  for (const [t, x] of [["From here", 300], ["To there", 1000]] as const) {
    await canvas.click({ position: { x, y: 600 } });
    await page.keyboard.press("n");
    await page.keyboard.type(t);
    await canvas.click({ position: { x: 640, y: 800 } });
  }
  await page.locator("[data-tool=arrow]").click();
  await page.locator("[data-kind=note]").filter({ hasText: "From here" }).click();
  await page.locator("[data-kind=note]").filter({ hasText: "To there" }).click();
  await expect(page.locator("[data-arrow-id]")).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator("[data-arrow-id] path").nth(1)).toHaveAttribute("d", /^M /);
});
