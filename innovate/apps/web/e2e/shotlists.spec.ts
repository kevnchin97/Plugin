import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createBoard, dragTo, signIn, uploadVideo } from "./helpers";

/**
 * M5 "done when": the full shot-list builder with motion references, drag-in from boards, and
 * PDF and CSV export. Plus reorder, filter, group and the live share link.
 */

async function gifOnBoard(page: Page, boardId: string) {
  await uploadVideo(page, "scenes.mp4");
  const refId = page.url().split("/make/")[1]!.split("?")[0]!;
  const ex = await page.request.post("/api/exports", {
    data: { kind: "gif", referenceId: refId, inFrame: 50, outFrame: 74, options: { width: 320, fps: 10, loop: "loop", quality: 60 } },
  });
  const { job } = await ex.json();
  await expect.poll(async () => (await (await page.request.get(`/api/jobs/${job.id}`)).json()).job.status, { timeout: 60_000 }).toBe("completed");
  const saved = await page.request.post(`/api/jobs/${job.id}/save`, { data: { boardId, title: "Bars reference" } });
  expect(saved.ok()).toBe(true);
}

async function fillShot(page: Page, row: number, f: { scene?: string; setting?: string; description?: string; framing?: string; status?: string; duration?: string; lens?: string }) {
  const r = page.getByTestId("shot-row").nth(row);
  if (f.scene) await r.getByLabel("Scene").fill(f.scene);
  if (f.setting) await r.getByLabel("Setting").fill(f.setting);
  if (f.description) await r.getByLabel("Description").fill(f.description);
  if (f.lens) await r.getByLabel("Lens").fill(f.lens);
  if (f.duration) await r.getByLabel("Duration in seconds").fill(f.duration);
  await r.getByLabel("Description").press("Tab"); // blur saves
  if (f.framing) await r.getByLabel("Framing").selectOption(f.framing);
  if (f.status) await r.getByLabel("Status").selectOption(f.status);
}

const descriptions = (page: Page) => page.getByTestId("shot-row").getByLabel("Description").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

test("shot list builder: motion references from a board, reorder, filter, group, CSV, PDF and a live link", async ({ page, browser }) => {
  await signIn(page);
  const boardId = await createBoard(page, "Prep");
  await gifOnBoard(page, boardId);

  // New shot list planned from the board.
  await page.goto("/shotlists");
  await page.getByLabel("Plan from board").selectOption({ label: "From: Prep" });
  await page.getByRole("button", { name: "New shot list" }).click();
  await expect(page).toHaveURL(/\/shotlists\/[0-9a-f-]{36}$/);
  await page.getByTestId("shotlist-title").fill("Winter Ad: day 1");
  await page.getByTestId("shotlist-title").press("Enter");

  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "+ Add shot" }).click();
  await expect(page.getByTestId("shot-row")).toHaveCount(3);
  await fillShot(page, 0, { scene: "1", setting: "Cabin", description: "Wide on the cabin at dusk", framing: "WS", status: "approved", duration: "6" });
  await fillShot(page, 1, { scene: "1", setting: "Cabin", description: "Push in on her hands", framing: "CU", status: "planned", duration: "4.5", lens: "85mm" });
  await fillShot(page, 2, { scene: "2", setting: "Ridge road", description: "Car passes, lights flare", framing: "EWS", status: "approved", duration: "3" });

  // Drag a reference from the board panel onto shot 2's motion cell.
  const tile = page.getByTestId("ref-tile").first();
  await expect(tile).toContainText("Bars reference");
  await dragTo(page, tile, page.getByTestId("motion-cell").nth(1));
  await expect(page.getByTestId("shot-row").nth(1).getByRole("button", { name: "Open Bars reference full size" })).toBeVisible();
  // Inline looping thumbnail opens full size.
  await page.getByRole("button", { name: "Open Bars reference full size" }).click();
  await expect(page.getByTestId("motion-lightbox")).toContainText("Bars reference");
  await page.keyboard.press("Escape");
  // Drop below the list to start a new shot with it.
  await dragTo(page, tile, page.getByRole("button", { name: "+ Add shot" }));
  await expect(page.getByTestId("shot-row")).toHaveCount(4);
  await expect(page.getByTestId("shot-row").nth(3).getByRole("button", { name: "Open Bars reference full size" })).toBeVisible();
  await page.getByTestId("shot-row").nth(3).getByRole("button", { name: /Delete shot/ }).click();
  await expect(page.getByTestId("shot-row")).toHaveCount(3);

  // Reorder: drag shot 3 to the top; then Alt+↓ moves it back down one.
  await dragTo(page, page.getByTestId("shot-row").nth(2).getByRole("button", { name: /Reorder shot/ }), page.getByTestId("shot-row").nth(0));
  await expect.poll(() => descriptions(page)).toEqual(["Car passes, lights flare", "Wide on the cabin at dusk", "Push in on her hands"]);
  await page.getByTestId("shot-row").nth(0).getByLabel("Description").press("Alt+ArrowDown");
  await expect.poll(() => descriptions(page)).toEqual(["Wide on the cabin at dusk", "Car passes, lights flare", "Push in on her hands"]);
  await page.waitForTimeout(500);
  await page.reload();
  await expect.poll(() => descriptions(page)).toEqual(["Wide on the cabin at dusk", "Car passes, lights flare", "Push in on her hands"]);
  await expect(page.getByTestId("totals")).toHaveText("3 shots · 13.5s");

  // Filter by status, group by location.
  await page.getByRole("button", { name: "approved" }).click();
  await expect(page.getByTestId("shot-row")).toHaveCount(2);
  await page.getByRole("button", { name: "approved" }).click();
  await page.getByLabel("Group shots by").selectOption("setting");
  await expect(page.getByTestId("group-header")).toHaveText([/Location Cabin\s*2/, /Location Ridge road\s*1/]);
  await page.getByLabel("Group shots by").selectOption("none");

  // CSV.
  const csvDl = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV" }).click();
  const csv = await csvDl;
  expect(csv.suggestedFilename()).toBe("winter-ad-day-1_shot-list.csv");
  const csvText = readFileSync((await csv.path())!, "utf8").replace(/^﻿/, "");
  const lines = csvText.trim().split("\r\n");
  expect(lines[0]).toBe("#,Scene,Setting,Description,Framing,Movement,Lens,Rig,Duration (s),Status,Motion reference,Motion link");
  expect(lines).toHaveLength(4);
  expect(lines[1]).toContain("Wide on the cabin at dusk,WS");
  expect(lines[3]).toMatch(/Push in on her hands,CU,,85mm,,4\.5,planned,Bars reference,http:\/\/localhost:\d+\/shotlists\/[0-9a-f-]+#shot-/);

  // Live share link (view-only).
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByTestId("share-url").first().inputValue();
  await page.keyboard.press("Escape");
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(url);
  await expect(guest.getByTestId("shared-title")).toHaveText("Winter Ad: day 1");
  await expect(guest.getByTestId("shared-shot")).toHaveCount(3);
  await page.getByTestId("shot-row").nth(1).getByLabel("Description").fill("Car passes, headlights flare into lens");
  await page.getByTestId("shot-row").nth(1).getByLabel("Description").press("Tab");
  await expect(guest.getByTestId("shared-description").nth(1)).toHaveText("Car passes, headlights flare into lens");

  // PDF: rendered on the worker, with the first frame and a link to the live list.
  const pdfDl = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "PDF" }).click();
  const pdf = await pdfDl;
  expect(pdf.suggestedFilename()).toBe("winter-ad-day-1_shot-list.pdf");
  const bytes = readFileSync((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const raw = bytes.toString("latin1");
  expect(raw).toMatch(/\/Subtype \/Image/);
  const token = url.split("/s/")[1]!;
  expect(raw).toContain(`/s/${token}#shot-`); // link annotation to the motion version on the live list
  await guestCtx.close();
});
