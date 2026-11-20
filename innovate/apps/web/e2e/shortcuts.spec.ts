import { expect, test } from "@playwright/test";
import { SHORTCUTS } from "../lib/shortcuts";
import { fixture, signIn } from "./helpers";

test("? lists every shortcut, and J/K/L shuttle", async ({ page }) => {
  await signIn(page);
  await page.goto("/make");
  await page.getByTestId("file-input").setInputFiles(fixture("scenes.mp4"));
  await expect(page.getByTestId("scene")).toHaveCount(4, { timeout: 90_000 });

  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  for (const s of SHORTCUTS) await expect(dialog.locator(`[data-shortcut="${s.action}"]`)).toContainText(s.label);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const shuttle = page.getByTestId("shuttle");
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await expect(shuttle).toHaveText("▶▶ 2×");
  const tc = page.getByTestId("current-tc");
  await expect(tc).not.toHaveText("00:00:00:00");
  await page.keyboard.press("k");
  await expect(shuttle).toHaveText("");
  const stopped = await tc.innerText();
  await page.waitForTimeout(300);
  await expect(tc).toHaveText(stopped);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(shuttle).toHaveText("◀◀ 2×");
  await page.keyboard.press("k");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});
