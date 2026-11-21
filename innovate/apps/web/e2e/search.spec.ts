import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { fixture, signIn, uploadVideo } from "./helpers";

/**
 * M6 "done when": natural-language search over images and video keyframes returns relevant
 * results on the seed data. The test builds the seed's demo film and its extracts (same frames as
 * apps/worker/src/seed-boards.ts) in a fresh workspace, waits for CLIP embeddings, then searches.
 */

type Hit = { reference: { id: string; title: string; type: string }; time: number | null; keyword: boolean; similarity: number | null };

async function extract(page: Page, refId: string, kind: "still" | "gif", title: string, inFrame: number, outFrame?: number) {
  const data =
    kind === "still"
      ? { kind, referenceId: refId, frame: inFrame, format: "jpg" }
      : { kind, referenceId: refId, inFrame, outFrame, options: { width: 320, fps: 10, loop: "loop", quality: 60 } };
  const { job } = await (await page.request.post("/api/exports", { data })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/jobs/${job.id}`)).json()).job.status, { timeout: 60_000 }).toBe("completed");
  expect((await page.request.post(`/api/jobs/${job.id}/save`, { data: { title } })).ok()).toBe(true);
}

async function search(page: Page, q: string, extra = ""): Promise<{ hits: Hit[]; semantic: boolean }> {
  const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}${extra}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

const titles = (hits: Hit[]) => hits.map((h) => h.reference.title);

/** The detected scene the hit's keyframe came from must overlap the expected shot [from, to) in seconds.
 *  (Scene boundaries can differ slightly between machines, so the check is on the scene, not an exact time.) */
async function expectSceneOverlaps(page: Page, hit: Hit, from: number, to: number) {
  expect(hit.time).not.toBeNull();
  const { reference } = await (await page.request.get(`/api/references/${hit.reference.id}`)).json();
  const scenes = reference.scenes as { start: number; end: number }[];
  const scene = scenes.find((s) => hit.time! >= s.start - 0.01 && hit.time! < s.end) ?? scenes.find((s) => Math.abs(s.start - hit.time!) < 0.05);
  expect(scene, `scene at ${hit.time}s`).toBeDefined();
  expect(scene!.start < to && scene!.end > from, `scene ${scene!.start}–${scene!.end}s overlaps ${from}–${to}s`).toBe(true);
}

test("natural-language search ranks images and video keyframes by what they look like", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  // The seed film (five looks: dusk, neon, cells, fractal push-in, ember) and three extracts.
  await uploadVideo(page, "demo.mp4");
  const filmId = page.url().split("/make/")[1]!.split("?")[0]!;
  await extract(page, filmId, "still", "Dusk falloff", 30);
  await extract(page, filmId, "gif", "Neon sweep", 100, 135);
  await extract(page, filmId, "gif", "Cells, amber on violet", 170, 205);
  // And an uploaded image (an orange-to-blue gradient sky).
  await page.goto("/library");
  const up = await page.request.post("/api/images", { data: { filename: "Gradient sky.png", contentType: "image/png", size: readFileSync(fixture("portrait.png")).length, width: 600, height: 900 } });
  const { id: imageId, uploadUrl } = await up.json();
  expect((await page.request.put(uploadUrl, { data: readFileSync(fixture("portrait.png")), headers: { "content-type": "image/png" } })).ok()).toBe(true);
  expect((await page.request.post(`/api/references/${imageId}/ingest`)).ok()).toBe(true);

  // Embeddings are computed on the worker after ingest/save; wait until every item is searchable.
  const ready = async () => {
    const [n, d, c, g] = await Promise.all([
      search(page, "pink and teal neon light"),
      search(page, "warm orange dusk glow"),
      search(page, "scattered golden dots on purple"),
      search(page, "an orange and blue gradient sky", "&type=image"),
    ]);
    const all = new Set([...titles(n.hits), ...titles(d.hits), ...titles(c.hits), ...titles(g.hits)]);
    return ["demo", "Dusk falloff", "Neon sweep", "Cells, amber on violet", "Gradient sky"].filter((t) => !all.has(t));
  };
  await expect.poll(ready, { timeout: 150_000, intervals: [2000] }).toEqual([]);

  // Neon: the GIF and the film's neon scene, not the dusk still.
  const neon = await search(page, "pink and teal neon light");
  expect(neon.semantic).toBe(true);
  const neonTitles = titles(neon.hits);
  expect(neonTitles).toContain("Neon sweep");
  expect(neonTitles.indexOf("Neon sweep")).toBeLessThan(neonTitles.indexOf("Dusk falloff") === -1 ? Infinity : neonTitles.indexOf("Dusk falloff"));
  // The film's best-matching scene is the neon shot (videos only, so the check doesn't depend on
  // where the relevance cut-off falls relative to the GIF).
  const filmHit = (await search(page, "pink and teal neon light", "&type=video")).hits.find((h) => h.reference.id === filmId)!;
  await expectSceneOverlaps(page, filmHit, 3.5, 6.5); // the neon shot runs 3.5 s – 6.5 s

  // Cells: the amber-on-violet GIF is the top extract; the film hit lands on that shot.
  const cells = await search(page, "scattered golden dots on purple");
  expect(cells.hits.filter((h) => h.reference.type !== "video")[0]?.reference.title).toBe("Cells, amber on violet");
  const cellsFilm = (await search(page, "scattered golden dots on purple", "&type=video")).hits.find((h) => h.reference.id === filmId)!;
  await expectSceneOverlaps(page, cellsFilm, 6.5, 9.5); // the cells shot runs 6.5 s – 9.5 s

  // Dusk: warm orange light ranks the dusk still above the neon GIF.
  const dusk = titles((await search(page, "warm orange dusk glow")).hits);
  expect(dusk).toContain("Dusk falloff");
  expect(dusk.indexOf("Dusk falloff")).toBeLessThan(dusk.indexOf("Neon sweep") === -1 ? Infinity : dusk.indexOf("Neon sweep"));

  // Filters: type and source.
  const gifsOnly = await search(page, "pink and teal neon light", "&type=gif");
  expect(gifsOnly.hits.length).toBeGreaterThan(0);
  expect(gifsOnly.hits.every((h) => h.reference.type === "gif")).toBe(true);
  const uploads = await search(page, "an orange and blue gradient sky", "&source=upload");
  expect(uploads.hits.every((h) => !["Neon sweep", "Dusk falloff", "Cells, amber on violet"].includes(h.reference.title))).toBe(true);
  expect(titles(uploads.hits)).toContain("Gradient sky");
  const future = await search(page, "neon", "&from=2999-01-01");
  expect(future.hits).toHaveLength(0);

  // Keyword fallback: a title word matches even when it isn't something CLIP can see.
  const kw = await search(page, "falloff");
  expect(kw.hits.find((h) => h.reference.title === "Dusk falloff")?.keyword).toBe(true);

  // UI: "/" focuses the header search; results link a video hit to its matching scene.
  await page.goto("/");
  await expect(async () => {
    await page.keyboard.press("/"); // retried until the page has hydrated
    await expect(page.getByLabel("Search the library")).toBeFocused({ timeout: 500 });
  }).toPass();
  await page.keyboard.type("pink and teal neon light");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=pink/);
  await expect(page.getByTestId("search-summary")).toContainText("ranked by what they look like");
  await expect(page.locator('[data-testid="search-hit"][data-title="Neon sweep"]')).toBeVisible();
  await page.getByRole("button", { name: "GIFs" }).click();
  await expect(page).toHaveURL(/type=gif/);
  await expect(page.locator('[data-testid="search-hit"][data-title="demo"]')).toHaveCount(0);
  await page.getByRole("button", { name: "GIFs" }).click();
  const filmCard = page.locator('[data-testid="search-hit"][data-title="demo"]');
  await expect(filmCard.getByTestId("hit-time")).toContainText("Scene at 00:00:0");
  await filmCard.getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/make/${filmId}\\?in=\\d+`));
});
