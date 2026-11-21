import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const MAGIC_LINK_LOG = resolve(ROOT, ".data/e2e-magic-links.log");
export const fixture = (name: string) => resolve(ROOT, "fixtures", name);

/** Sign in through the real magic-link flow; the dev mailer appends links to a log file. */
export async function signIn(page: Page, email = `e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@innovate.local`) {
  const before = existsSync(MAGIC_LINK_LOG) ? readFileSync(MAGIC_LINK_LOG, "utf8").length : 0;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page).toHaveURL(/\/login\/check-email/);
  let url: string | undefined;
  await expect
    .poll(() => {
      const added = existsSync(MAGIC_LINK_LOG) ? readFileSync(MAGIC_LINK_LOG, "utf8").slice(before) : "";
      const line = added
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { email: string; url: string })
        .find((l) => l.email === email);
      url = line?.url;
      return Boolean(url);
    })
    .toBe(true);
  await page.goto(url!);
  await expect(page).toHaveURL(/\/$/);
  return email;
}

export function ffprobe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-print_format", "json", "-show_streams", "-show_format", file]);
  return JSON.parse(out.toString()) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_read_frames?: string; duration?: string }[];
    format: { format_name: string; duration: string };
  };
}

/** Pointer-driven drag (dnd-kit listens to pointer events, so move in steps). */
export async function dragTo(page: Page, from: Locator, to: { x: number; y: number } | Locator) {
  const a = (await from.boundingBox())!;
  const target = "x" in to ? to : await (async () => {
    const b = (await to.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 60) };
  })();
  await page.mouse.move(a.x + Math.min(40, a.width / 2), a.y + Math.min(30, a.height / 2));
  await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + 40, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  // dnd-kit swallows clicks for ~50 ms after a drag ends (so the drop isn't also a click).
  await page.waitForTimeout(120);
}

export async function createBoard(page: Page, title: string, parentBoardId?: string): Promise<string> {
  const res = await page.request.post("/api/boards", { data: { title, parentBoardId } });
  expect(res.ok()).toBe(true);
  return (await res.json()).board.id as string;
}

/** Upload a fixture through the GIF Maker and wait until the editor is ready. */
export async function uploadVideo(page: Page, file: string) {
  await page.goto("/make");
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  await expect(page).toHaveURL(/\/make\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId("scene").first()).toBeVisible({ timeout: 90_000 });
}
