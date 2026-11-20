import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { ffprobe, fixture, signIn } from "./helpers";

/**
 * M1 "done when": upload a video, see proxy + filmstrip + detected scenes, then export a
 * still, a GIF and a clip with sound from one range using only the keyboard, downloading each.
 *
 * scenes.mp4 is 25 fps with cuts at frames 50 and 125 (and a merged flash at 165/170).
 */
async function upload(page: Page, file: string) {
  await page.goto("/make");
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  await expect(page).toHaveURL(/\/make\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

async function download(page: Page, key: string, testInfo: { outputPath(name: string): string }) {
  const pending = page.waitForEvent("download", { timeout: 60_000 });
  await page.keyboard.press(key);
  const d = await pending;
  const path = testInfo.outputPath(d.suggestedFilename());
  await d.saveAs(path);
  return { name: d.suggestedFilename(), path };
}

test("GIF Maker: upload, scenes, keyboard-only still + GIF + clip with sound", async ({ page }, testInfo) => {
  await signIn(page);
  await upload(page, "scenes.mp4");

  // Ingest stages are shown, then the editor with proxy, filmstrip and scenes.
  await expect(page.getByTestId("ingest").or(page.getByTestId("editor"))).toBeVisible();
  await expect(page.getByTestId("scene")).toHaveCount(4, { timeout: 90_000 });
  const video = page.getByTestId("player");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBeLessThanOrEqual(540);
  await expect(page.getByTestId("timeline").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:00:00");

  // From here on: keyboard only.
  const tc = page.getByTestId("current-tc");
  await page.keyboard.press("]");
  await expect(tc).toHaveText("00:00:02:00"); // cut at frame 50
  await page.keyboard.press("]");
  await expect(tc).toHaveText("00:00:05:00"); // cut at frame 125
  await page.keyboard.press("[");
  await expect(tc).toHaveText("00:00:02:00");
  await page.keyboard.press("]");
  await page.keyboard.press("i");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(tc).toHaveText("00:00:06:00");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(tc).toHaveText("00:00:06:01");
  await page.keyboard.press("o");
  await expect(page.getByTestId("in-tc")).toHaveText("00:00:05:00");
  await expect(page.getByTestId("out-tc")).toHaveText("00:00:06:01");
  await expect(page.getByTestId("dur")).toContainText("27 fr");

  // The playhead's frame is what the video shows.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.floor(v.currentTime * 25))).toBe(151);

  const still = await download(page, "s", testInfo);
  expect(still.name).toBe("scenes_00m06s.png");
  expect(ffprobe(still.path).streams[0]).toMatchObject({ codec_name: "png", width: 640, height: 360 });

  const gif = await download(page, "g", testInfo);
  expect(gif.name).toBe("scenes_00m05s-00m06s.gif");
  const g = ffprobe(gif.path);
  expect(g.format.format_name).toBe("gif");
  expect(g.streams[0]).toMatchObject({ codec_name: "gif", width: 640, height: 360 });
  // 27 frames at 25 fps = 1.08 s -> 16 frames at 15 fps.
  expect(Number(g.streams[0]!.nb_read_frames)).toBe(16);

  const clip = await download(page, "c", testInfo);
  expect(clip.name).toBe("scenes_00m05s-00m06s.mp4");
  const c = ffprobe(clip.path);
  const v = c.streams.find((s) => s.codec_type === "video")!;
  const a = c.streams.find((s) => s.codec_type === "audio");
  expect(v).toMatchObject({ codec_name: "h264", width: 640, height: 360 });
  expect(Number(v.nb_read_frames)).toBe(27);
  expect(a?.codec_name).toBe("aac");
  expect(Number(a!.duration)).toBeCloseTo(1.08, 1);

  // Enter saves the latest export to the library, linked to its source.
  await expect(page.getByTestId("export-row")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved scenes_00m05s-00m06s.mp4 to Unsorted")).toBeVisible();
  await expect(page.locator('[data-testid=export-row][data-kind=clip]')).toContainText("In library");

  await page.goto("/library");
  const items = page.getByTestId("library-item");
  await expect(items).toHaveCount(2);
  await expect(page.locator('[data-testid=library-item][data-type=clip]')).toContainText("from scenes");
});

test("re-requesting an identical export reuses the finished job", async ({ page }, testInfo) => {
  await signIn(page);
  await upload(page, "scenes.mp4");
  await expect(page.getByTestId("scene")).toHaveCount(4, { timeout: 90_000 });
  await page.keyboard.press("]");
  const first = await download(page, "s", testInfo);
  const second = await download(page, "s", testInfo);
  expect(second.name).toBe(first.name);
  await expect(page.getByTestId("export-row")).toHaveCount(1);
});

test("clicking a scene sets in and out to its bounds", async ({ page }) => {
  await signIn(page);
  await upload(page, "scenes.mp4");
  await expect(page.getByTestId("scene")).toHaveCount(4, { timeout: 90_000 });
  await page.getByRole("button", { name: "In order" }).click();
  await page.getByTestId("scene").nth(1).click();
  await expect(page.getByTestId("in-tc")).toHaveText("00:00:02:00");
  await expect(page.getByTestId("out-tc")).toHaveText("00:00:04:24");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:02:00");
  // Alt+I / Alt+O clear the marks again; with no marks the range follows the scene.
  await page.keyboard.press("Alt+KeyI");
  await page.keyboard.press("Alt+KeyO");
  await expect(page.getByText(/Auto · scene 02/)).toBeVisible();
});

test("WebM uploads work too", async ({ page }) => {
  await signIn(page);
  await upload(page, "short.webm");
  await expect(page.getByTestId("scene").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ref-title")).toHaveText("short");
});

test("platform links explain that adapters aren't enabled", async ({ page }) => {
  await signIn(page);
  await page.goto("/make");
  await page.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Import link" }).click();
  await expect(page.getByText(/YouTube links need an ingest adapter/)).toBeVisible();
});

test("saving the same export twice at once creates one library item", async ({ page }) => {
  await signIn(page);
  await upload(page, "scenes.mp4");
  await expect(page.getByTestId("scene")).toHaveCount(4, { timeout: 90_000 });
  await page.keyboard.press("s");
  await expect(page.locator("[data-testid=export-row][data-status=completed]")).toHaveCount(1);
  // Fire two saves for the same job concurrently through the API.
  const id = await page.evaluate(() => document.querySelector("[data-testid=export-row]")?.getAttribute("data-job"));
  const results = await page.evaluate(async (jobId) => {
    const post = () => fetch(`/api/jobs/${jobId}/save`, { method: "POST" }).then((r) => r.json());
    return Promise.all([post(), post(), post()]);
  }, id);
  expect(new Set(results.map((r: { referenceId: string }) => r.referenceId)).size).toBe(1);
  await page.goto("/library");
  await expect(page.getByTestId("library-item")).toHaveCount(2);
});

test("variable-frame-rate (phone) footage is conformed so frames stay exact", async ({ page }, testInfo) => {
  await signIn(page);
  await upload(page, "vfr.mp4");
  await expect(page.getByTestId("scene").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("VFR conformed")).toBeVisible();
  await expect(page.getByText(/· 30 fps ·/)).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:01:00");
  const still = await download(page, "s", testInfo);
  // Frame 30 of the 30 fps capture has luma 16 + 4 * 30 = 136.
  const out = execFileSync("ffmpeg", ["-v", "error", "-i", still.path, "-vf", "signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]).toString();
  const luma = Number(/YAVG=([\d.]+)/.exec(out)?.[1]);
  expect(Math.abs(luma - 136)).toBeLessThan(2);
});
