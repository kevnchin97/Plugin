/**
 * Smoke test for the packaged desktop app: launches the real executable with Playwright and checks
 * that it opens signed in, ingests a video (bundled ffmpeg), exports a GIF, finds it by what it
 * looks like (CLIP on the bundled AI runtime, embedded pgvector), and still has it after a restart
 * (the database is flushed on quit).
 *
 *   node scripts/smoke.mjs <path to Innovate.exe | Innovate binary>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { _electron: electron } = createRequire(join(desktop, "../web/package.json"))("@playwright/test");

const exe = resolve(process.argv[2] ?? "");
if (!existsSync(exe)) throw new Error(`No app at ${exe}`);
const resources = join(dirname(exe), "resources");
const out = join(desktop, "dist/smoke");
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "innovate-smoke-"));
const t0 = Date.now();
const log = (m) => console.log(`[smoke ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// A short test video, made with the app's own ffmpeg.
const ffmpegDir = join(resources, "server/node_modules/ffmpeg-static");
const ffmpeg = join(ffmpegDir, readdirSync(ffmpegDir).find((f) => /^ffmpeg(\.exe)?$/.test(f)));
const clip = join(data, "smoke.mp4");
execFileSync(ffmpeg, [
  "-y", "-v", "error",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=4",
  "-f", "lavfi", "-i", "color=c=0xff2e88:size=640x360:rate=24:duration=4",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
  "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
  "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
]);
log("made a test video with the bundled ffmpeg");

async function launch() {
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, INNOVATE_DATA_DIR: data }, timeout: 120_000 });
  const page = await app.firstWindow();
  await page.getByTestId("board-title").waitFor({ timeout: 120_000 });
  return { app, page, origin: new URL(page.url()).origin };
}

let { app, page, origin } = await launch();
log(`window open on ${origin}, board "${await page.getByTestId("board-title").textContent()}"`);
await page.screenshot({ path: join(out, "01-home.png") });

await page.goto(`${origin}/make`);
await page.getByTestId("file-input").setInputFiles(clip);
await page.waitForURL(/\/make\/[0-9a-f-]{36}/, { timeout: 120_000 });
await page.getByTestId("scene").first().waitFor({ timeout: 180_000 });
const refId = page.url().split("/make/")[1].split("?")[0];
log(`ingested: ${await page.getByTestId("scene").count()} scene(s)`);
await page.screenshot({ path: join(out, "02-gif-maker.png") });

const api = page.context().request;
const { job } = await (
  await api.post(`${origin}/api/exports`, { data: { kind: "gif", referenceId: refId, inFrame: 110, outFrame: 140, options: { width: 320, fps: 10, loop: "loop", quality: 60 } } })
).json();
for (let i = 0; ; i++) {
  const j = (await (await api.get(`${origin}/api/jobs/${job.id}`)).json()).job;
  if (j.status === "completed") break;
  if (j.status === "failed" || i > 240) throw new Error(`GIF export failed: ${j.error ?? "timed out"}`);
  await page.waitForTimeout(500);
}
if (!(await api.post(`${origin}/api/jobs/${job.id}/save`, { data: { title: "Pink flash" } })).ok()) throw new Error("Saving the GIF failed");
log("exported and saved a GIF");

// Search by look: downloads the CLIP model on first use (~150 MB), then embeds on this machine.
let found = false;
for (let i = 0; i < 150 && !found; i++) {
  const s = await (await api.get(`${origin}/api/search?q=${encodeURIComponent("bright pink")}&type=gif`)).json();
  found = s.semantic && s.hits.some((h) => h.reference.title === "Pink flash");
  if (!found) await page.waitForTimeout(2000);
}
if (!found) throw new Error("Search by look didn't find the GIF");
log("search by look found the GIF");

await page.goto(`${origin}/library`);
await page.getByTestId("library-item").first().waitFor();
await page.screenshot({ path: join(out, "03-library.png") });
await app.close();
log("closed");

// Reopen: the data must still be there.
({ app, page, origin } = await launch());
await page.goto(`${origin}/library`);
await page.locator('[data-testid="library-item"]', { hasText: "Pink flash" }).waitFor({ timeout: 30_000 });
log("reopened: the GIF is still in the library");
await app.close();
rmSync(data, { recursive: true, force: true, maxRetries: 5 });
log("passed");
