import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

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
