import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/make");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("magic link signs in, creates a workspace, and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("API routes reject anonymous requests", async ({ request }) => {
  const res = await request.get("/api/references");
  expect(res.status()).toBe(401);
});
