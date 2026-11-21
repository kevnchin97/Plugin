import postgres from "postgres";
import { expect, test } from "@playwright/test";
import { createBoard, fixture, signIn } from "./helpers";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://innovate:innovate@localhost:5432/innovate";

test("library: native-ratio masonry, multi-select, add to board", async ({ page }) => {
  await signIn(page);
  await createBoard(page, "Selects");
  // A portrait still via the board uploader (lands in Unsorted / the library).
  const id = await createBoard(page, "Upload target");
  await page.goto(`/boards/${id}`);
  await page.getByTestId("board-file-input").setInputFiles([fixture("portrait.png")]);
  await expect(page.getByTestId("tray-item")).toHaveCount(1);

  await page.goto("/library");
  const item = page.getByTestId("library-item").first();
  await expect(item).toBeVisible();
  const box = (await item.locator("img").first().boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(600 / 900, 1);
  await item.click();
  await expect(page.getByTestId("selection-count")).toHaveText("1 selected");
  await page.getByLabel("Add selection to board").selectOption({ label: "Selects" });
  await expect(page.getByText("Added 1 to Selects")).toBeVisible();
});

test("library: 5,000 items are interactive in under a second (SPEC §6)", async ({ page }) => {
  const email = await signIn(page);
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const [ws] = await sql`select m.workspace_id from memberships m join users u on u.id = m.user_id where u.email = ${email}`;
    // 5,000 image references (mixed aspect ratios) pointing at one stored key; marked embedded so search skips them.
    await sql`
      insert into refs (workspace_id, type, status, stage, title, original_key, thumbnail_key, width, height, created_at, embedded_at)
      select ${ws!.workspace_id}, 'image', 'ready', 'ready', 'Ref ' || g,
             'perf/none.jpg', 'perf/none.jpg',
             case when g % 3 = 0 then 600 else 1600 end, 900,
             now() - (g || ' seconds')::interval, now()
      from generate_series(1, 5000) g`;
  } finally {
    await sql.end();
  }

  const t0 = Date.now();
  await page.goto("/library");
  const first = page.getByTestId("library-item").first();
  await first.click();
  await expect(page.getByTestId("selection-count")).toHaveText("1 selected");
  const elapsed = Date.now() - t0;
  console.log(`library with 5,000 items: interactive after ${elapsed} ms`);
  expect(elapsed).toBeLessThan(1000);
  // Virtualized: only a window of cards is in the DOM, yet all 5,000 load in the background.
  expect(await page.getByTestId("library-item").count()).toBeLessThan(200);
  await expect
    .poll(
      async () => {
        await page.getByTestId("library").evaluate((el) => (el.scrollTop = el.scrollHeight));
        return page.getByText("Ref 5000", { exact: true }).isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
