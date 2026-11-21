import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { twilioSignature } from "@innovate/shared/twilio";
import { ROOT, signIn } from "./helpers";

/**
 * M8 "done when" (text-to-save): a user verifies their phone, texts links (SMS or WhatsApp) to
 * the Twilio webhook, and they land on an "Inbox from text" board with a confirmation reply.
 * Requests are signed like Twilio signs them (TWILIO_AUTH_TOKEN from playwright.config.ts).
 */

const SMS_LOG = resolve(ROOT, ".data/e2e-sms.log");
const TOKEN = "e2e-twilio-token";
const SITES = `http://localhost:${process.env.E2E_SITES_PORT ?? 3199}`;

function lastCode(to: string): string | null {
  if (!existsSync(SMS_LOG)) return null;
  const lines = readFileSync(SMS_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; body: string });
  const hit = lines.reverse().find((l) => l.to === to);
  return hit ? /\b(\d{6})\b/.exec(hit.body)![1]! : null;
}

async function text(page: Page, from: string, body: string, opts: { badSignature?: boolean } = {}) {
  const url = new URL("/api/twilio/inbound", page.url()).toString();
  const params = { MessageSid: `SM${Date.now()}`, AccountSid: "ACtest", From: from, To: "+15005550006", Body: body, NumMedia: "0" };
  const signature = opts.badSignature ? "not-a-signature" : twilioSignature(TOKEN, url, params);
  const res = await page.request.post(url, { form: params, headers: { "x-twilio-signature": signature } });
  return { status: res.status(), type: res.headers()["content-type"], body: await res.text() };
}

test("verify a phone number, then text links that land on “Inbox from text” with a reply", async ({ page }) => {
  await signIn(page);
  const digits = String(Date.now()).slice(-7);
  const phone = `+1555${digits}`;

  // Verify the number in Settings (the code is "sent" to the dev SMS log).
  await page.goto("/settings");
  await page.getByLabel("Phone number").fill(`+1 555 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await expect.poll(() => lastCode(phone)).not.toBeNull();
  await page.getByLabel("Verification code").fill(lastCode(phone) === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code isn't right.")).toBeVisible();
  await page.getByLabel("Verification code").fill(lastCode(phone)!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByTestId("phones")).toContainText(phone);
  await expect(page.getByTestId("phones")).toContainText("Verified");
  await expect(page.getByText("Then text links to")).toContainText("+15005550006");

  // An SMS with two links (a page and an image) is saved, and Twilio gets a TwiML reply.
  const sms = await text(page, phone, `Look at this ${SITES}/page.html and this still: ${SITES}/cover.png`);
  expect(sms.status).toBe(200);
  expect(sms.type).toContain("text/xml");
  expect(sms.body).toContain("<Message>Saved 2 links to “Inbox from text” in Innovate.</Message>");

  // WhatsApp works the same; a Vimeo link goes through the (enabled) official-API adapter.
  const wa = await text(page, `whatsapp:${phone}`, "vimeo.com/123456");
  expect(wa.body).toContain("Saved 1 link to “Inbox from text”");

  const list = await (await page.request.get("/api/boards")).json();
  const inbox = (list.all as { id: string; title: string }[]).filter((b) => b.title === "Inbox from text");
  expect(inbox).toHaveLength(1);
  const board = await (await page.request.get(`/api/boards/${inbox[0]!.id}`)).json();
  const refs = Object.values(board.references) as { type: string; sourceUrl: string }[];
  expect(refs.map((r) => r.type).sort()).toEqual(["image", "link", "video"]);
  expect(refs.map((r) => r.sourceUrl)).toEqual(expect.arrayContaining([`${SITES}/page.html`, `${SITES}/cover.png`, "https://vimeo.com/123456"]));

  // Texts with no link get instructions; unknown numbers are told to verify; forged requests are refused.
  expect((await text(page, phone, "hello!")).body).toContain("Text a link");
  expect((await text(page, "+15550000000", `${SITES}/page.html`)).body).toContain("isn't connected to Innovate");
  expect((await text(page, phone, `${SITES}/page.html`, { badSignature: true })).status).toBe(403);
  const after = await (await page.request.get(`/api/boards/${inbox[0]!.id}`)).json();
  expect(Object.keys(after.references)).toHaveLength(3);
});
