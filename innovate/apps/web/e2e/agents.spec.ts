import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { fixture, signIn } from "./helpers";

/**
 * M8 "done when" (agents): the Research Agent and general agents propose, the user approves, and
 * every applied change can be undone. Claude is a scripted fake (e2e/fake-sites.mjs) so the real
 * worker loop, tools, proposal, apply and undo all run without calling Anthropic.
 */

const SITES = `http://localhost:${process.env.E2E_SITES_PORT ?? 3199}`;

async function startAgent(page: Page, prompt: string) {
  const res = await page.request.post("/api/agents", { data: { prompt } });
  expect(res.status()).toBe(201);
  const { task } = await res.json();
  await page.goto(`/agents/${task.id}`);
  return task.id as string;
}

async function uploadImage(page: Page, name: string) {
  const bytes = readFileSync(fixture("portrait.png"));
  const { id, uploadUrl } = await (await page.request.post("/api/images", { data: { filename: `${name}.png`, contentType: "image/png", size: bytes.length, width: 600, height: 900 } })).json();
  expect((await page.request.put(uploadUrl, { data: bytes, headers: { "content-type": "image/png" } })).ok()).toBe(true);
  expect((await page.request.post(`/api/references/${id}/ingest`)).ok()).toBe(true);
  return id as string;
}

test("Research Agent: Cmd+K brief → Vimeo shortlist with reasons → approve → board → undo", async ({ page }) => {
  await signIn(page);
  const before = (await (await page.request.get("/api/boards")).json()).all.length;

  // Cmd+K (Ctrl+K here) opens the command bar; a "Research …" request runs the Research Agent.
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-bar")).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(page.getByTestId("command-bar")).toContainText("Limited beta");
  await page.getByLabel("Agent request").fill("Research references for a rainy neon chase");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);

  // Live step log, then a proposal: three picks, each with a one-line reason.
  await expect(page.getByTestId("agent-status")).toHaveText("Waiting for your approval");
  const steps = page.getByTestId("agent-steps");
  await expect(steps).toContainText("Research Agent started");
  await expect(steps).toContainText("Searching Vimeo for “Research references for a rainy neon chase”");
  await expect(steps).toContainText("5 results");
  await expect(page.getByTestId("proposed-change")).toHaveText(["Save 3 picks to new board “Research: Research references for a rainy neon chase”"]);
  await expect(page.getByTestId("pick-reason")).toHaveText(["Wet asphalt kicks the neon into long streaks.", "Handheld chase framing that stays on faces.", "Practical signage as the only key light."]);
  await expect(page.getByTestId("agent-proposal")).toContainText("I shortlisted three Vimeo films");

  // Nothing was written before approval.
  expect((await (await page.request.get("/api/boards")).json()).all.length).toBe(before);

  await page.getByRole("button", { name: "Approve all" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Applied");
  await expect(page.getByTestId("applied-summary")).toContainText("1 board, 3 references created");
  await page.getByRole("link", { name: "Open board" }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  const boardId = page.url().split("/boards/")[1]!;
  const board = await (await page.request.get(`/api/boards/${boardId}`)).json();
  const refs = Object.values(board.references) as { title: string; type: string }[];
  expect(refs.map((r) => r.title).sort()).toEqual([
    "Neon Rain (fake result for “Research references for a rainy neon chase”)",
    "Night Chase (fake result for “Research references for a rainy neon chase”)",
    "Signal Fires (fake result for “Research references for a rainy neon chase”)",
  ]);
  expect(refs.every((r) => r.type === "link")).toBe(true);

  // Undo removes exactly what was applied.
  await page.goBack();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Undone");
  expect((await page.request.get(`/api/boards/${boardId}`)).status()).toBe(404);
  expect((await (await page.request.get("/api/boards")).json()).all.length).toBe(before);

  // The run used Claude Opus 5.5 with the server-side refusal fallback, and only proposal tools write.
  const log = (await (await page.request.get(`${SITES}/anthropic/_log`)).json()) as { model: string; tools: string[]; beta: string; fallbacks: string; first: string | null }[];
  const call = log.findLast((l) => l.first?.includes("rainy neon chase"))!;
  expect(call.model).toBe("claude-opus-5-5");
  expect(call.beta).toContain("server-side-fallback-2026-07-01");
  expect(call.fallbacks).toBe("default");
  expect(call.tools).toEqual(expect.arrayContaining(["search_vimeo", "search_library", "propose_save_links", "propose_create_deck"]));
});

test("general agents: moodboard from the last three uploads, and GIFs of the fastest moves in a link", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const uploads = [await uploadImage(page, "First"), await uploadImage(page, "Second"), await uploadImage(page, "Third")];

  // Moodboard: approve, then undo removes the board but keeps the uploads.
  await startAgent(page, "Build a moodboard from my last three uploads");
  await expect(page.getByTestId("agent-status")).toHaveText("Waiting for your approval");
  await expect(page.getByTestId("proposed-change")).toHaveText(["Create board “Moodboard: last three uploads” with 3 references"]);
  await page.getByRole("button", { name: "Approve all" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Applied");
  await page.getByRole("link", { name: "Open board" }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("board-title")).toHaveText("Moodboard: last three uploads");
  const boardId = page.url().split("/boards/")[1]!;
  const board = await (await page.request.get(`/api/boards/${boardId}`)).json();
  expect(Object.keys(board.references).sort()).toEqual([...uploads].sort());
  expect(board.items.some((i: { kind: string; content: { text?: string } }) => i.kind === "note" && i.content.text?.includes("last three uploads"))).toBe(true);
  await page.goBack();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Undone");
  expect((await page.request.get(`/api/boards/${boardId}`)).status()).toBe(404);
  for (const id of uploads) expect((await page.request.get(`/api/references/${id}`)).ok()).toBe(true);

  // Whip pans: the agent imports the link (library only), reads its scenes and proposes GIFs.
  await startAgent(page, `Pull GIFs of every whip pan in this link: ${SITES}/clip.mp4`);
  await expect(page.getByTestId("agent-status")).toHaveText("Waiting for your approval", { timeout: 90_000 });
  await expect(page.getByTestId("agent-steps")).toContainText(`Importing ${SITES}/clip.mp4`);
  await expect(page.getByTestId("agent-steps")).toContainText("scenes");
  await expect(page.getByTestId("proposed-change")).toHaveText(["Export 2 GIFs to new board “Whip pans”"]);
  await page.getByRole("button", { name: "Approve all" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Applied", { timeout: 60_000 });
  await expect(page.getByTestId("applied-summary")).toContainText("1 board, 2 references created");
  await page.getByRole("link", { name: "Open board" }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  const whip = page.url().split("/boards/")[1]!;
  const whipBoard = await (await page.request.get(`/api/boards/${whip}`)).json();
  const gifs = Object.values(whipBoard.references) as { id: string; type: string; title: string; parentReferenceId: string }[];
  expect(gifs.map((g) => g.type)).toEqual(["gif", "gif"]);
  expect(gifs.every((g) => /^Whip pan \d+$/.test(g.title))).toBe(true);
  const imported = gifs[0]!.parentReferenceId;

  // Undo: GIFs, board and the imported video all go.
  await page.goBack();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Undone");
  expect((await page.request.get(`/api/boards/${whip}`)).status()).toBe(404);
  for (const id of [imported, ...gifs.map((g) => g.id)]) expect((await page.request.get(`/api/references/${id}`)).status()).toBe(404);
});

test("agent runs can be cancelled and retried; approving only some changes", async ({ page }) => {
  await signIn(page);
  await startAgent(page, "Think slowly about my boards");
  await expect(page.getByTestId("agent-status")).toHaveText("Working…");
  await expect(page.getByTestId("agent-steps")).toContainText("Still thinking (turn 2)");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Cancelled", { timeout: 15_000 });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Working…");
  await expect(page.getByTestId("agent-steps")).toContainText("Still thinking (turn 1)");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("agent-status")).toHaveText("Cancelled", { timeout: 15_000 });

  // Partial approval: untick a change and only the rest applies.
  const a = await uploadImage(page, "Keep");
  await startAgent(page, "Research references for a rainy neon chase");
  await expect(page.getByTestId("agent-status")).toHaveText("Waiting for your approval");
  await page.getByRole("checkbox").first().uncheck();
  await expect(page.getByRole("button", { name: /Approve/ })).toBeDisabled();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("button", { name: "Approve all" })).toBeEnabled();
  const second = await page.request.post(`/api/agents/${page.url().split("/agents/")[1]}/approve`, { data: { actions: [] } });
  expect(second.status()).toBe(400);
  expect((await page.request.get(`/api/references/${a}`)).ok()).toBe(true);
});
