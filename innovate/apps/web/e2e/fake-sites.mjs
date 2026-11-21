// Local stand-ins for "the web" in e2e tests (SPEC §8: never call real platforms in tests):
// a page with og tags, an image with srcset and a video, plus a fake of the Vimeo API whose
// download link serves a generated fixture, and a scripted fake of the Anthropic Messages API (so
// the real agent loop runs end to end without calling Claude). Started by playwright.config.ts.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.E2E_SITES_PORT || 3199);
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const base = `http://localhost:${PORT}`;

function file(res, name, type) {
  const path = resolve(FIXTURES, name);
  res.writeHead(200, { "content-type": type, "content-length": statSync(path).size, "access-control-allow-origin": "*" });
  createReadStream(path).pipe(res);
}

const PAGE = `<!doctype html><html><head>
<title>Fake gallery</title>
<meta property="og:title" content="Fake gallery: winter light">
<meta property="og:image" content="${base}/cover.png">
</head><body>
<h1>Winter light</h1>
<img id="photo" src="${base}/photo-small.png" srcset="${base}/photo-small.png 1x, ${base}/photo-large.png 2x" width="300" height="450">
<video id="clip" src="${base}/clip.mp4" width="320" muted></video>
</body></html>`;

/* ---------- Fake Anthropic Messages API (POST /anthropic/v1/messages) ---------- */

const claudeLog = [];
const readBody = (req) =>
  new Promise((ok) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => ok(data));
  });
let n = 0;
const toolUse = (name, input, text) => [...(text ? [{ type: "text", text }] : []), { type: "tool_use", id: `toolu_fake_${++n}`, name, input }];
const reply = (content, stop = content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn") => ({
  id: `msg_fake_${++n}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});
/** Tool results of the latest user turn, parsed (the agent sends JSON). */
function lastResults(messages) {
  const last = messages[messages.length - 1];
  if (!Array.isArray(last?.content)) return [];
  return last.content.filter((b) => b.type === "tool_result").map((b) => ({ error: b.is_error, value: b.is_error ? b.content : JSON.parse(b.content) }));
}

/**
 * A deterministic stand-in for Claude: picks a script from the request and the turn number.
 * Requests without tools are reference descriptions.
 */
function fakeClaude(body) {
  if (!body.tools?.length) return reply([{ type: "text", text: "Frames from a generated test film: graded colour fields with soft grain." }]);
  const first = typeof body.messages[0].content === "string" ? body.messages[0].content : "";
  const turn = body.messages.filter((m) => m.role === "assistant").length;
  const results = lastResults(body.messages);
  if (results.some((r) => r.error)) return reply([{ type: "text", text: `A tool failed: ${results.find((r) => r.error).value}` }]);

  if (/Brief:/.test(first)) {
    const brief = first.split("Brief:")[1].trim();
    if (turn === 0) return reply(toolUse("search_vimeo", { query: brief, count: 5 }, "Searching Vimeo for the brief."));
    if (turn === 1) {
      const picks = results[0].value.slice(0, 3).map((h, i) => ({ url: h.url, title: h.title, reason: ["Wet asphalt kicks the neon into long streaks.", "Handheld chase framing that stays on faces.", "Practical signage as the only key light."][i], thumbnailUrl: h.thumbnailUrl }));
      return reply(toolUse("propose_save_links", { target: { newBoardTitle: `Research: ${brief}` }, picks }, "Shortlisting the strongest three."));
    }
    return reply([{ type: "text", text: "I shortlisted three Vimeo films with the wet, neon-lit chase look you described. Each pick notes what to study." }]);
  }
  if (/last three uploads/i.test(first)) {
    if (turn === 0) return reply(toolUse("recent_uploads", { count: 3, uploads_only: true }));
    if (turn === 1) return reply(toolUse("propose_create_board", { title: "Moodboard: last three uploads", referenceIds: results[0].value.map((r) => r.id), notes: ["Built from your last three uploads."] }));
    return reply([{ type: "text", text: "I propose a moodboard with your last three uploads and a note on where they came from." }]);
  }
  if (/whip pan/i.test(first)) {
    const url = /(https?:\/\/\S+)/.exec(first)?.[1];
    if (turn === 0) return reply(toolUse("ingest_link", { url }, "Importing the link so I can read its shots."));
    if (turn === 1) return reply(toolUse("get_scenes", { reference_id: results[0].value.id }));
    if (turn === 2) {
      const scenes = results[0].value.scenes;
      const fast = [...scenes].sort((a, b) => b.motion - a.motion).slice(0, 2).sort((a, b) => a.index - b.index);
      const ranges = fast.map((s) => ({ kind: "gif", inFrame: s.startFrame, outFrame: Math.min(s.endFrame - 1, s.startFrame + 24), title: `Whip pan ${s.index + 1}` }));
      return reply(toolUse("propose_export_clips", { referenceId: results[0].value.reference.id, target: { newBoardTitle: "Whip pans" }, ranges, reason: "The two shots with the most motion." }));
    }
    return reply([{ type: "text", text: "I found the two fastest moves in the film and propose a GIF of each on a new board." }]);
  }
  if (/slowly/i.test(first)) return reply(toolUse("list_boards", {}, `Still thinking (turn ${turn + 1}).`));
  return reply([{ type: "text", text: "I can't help with that one." }]);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/health") return void res.writeHead(200).end("ok");
  if (url.pathname === "/page.html") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  if (/^\/(cover|photo-small|photo-large)\.png$/.test(url.pathname)) return file(res, "portrait.png", "image/png");
  if (url.pathname === "/clip.mp4" || url.pathname === "/vimeo-files/source.mp4") return file(res, "scenes.mp4", "video/mp4");
  if (url.pathname === "/anthropic/v1/messages" && req.method === "POST") {
    // SDK 1.x sends the key as a bearer token; older ones as x-api-key.
    if (req.headers["x-api-key"] !== "e2e-anthropic-key" && req.headers.authorization !== "Bearer e2e-anthropic-key") return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }));
    const body = JSON.parse(await readBody(req));
    claudeLog.push({ model: body.model, tools: (body.tools ?? []).map((t) => t.name), beta: req.headers["anthropic-beta"] ?? null, fallbacks: body.fallbacks ?? null, first: typeof body.messages[0].content === "string" ? body.messages[0].content.slice(-300) : null });
    const out = fakeClaude(body);
    const slow = typeof body.messages[0].content === "string" && /slowly/i.test(body.messages[0].content);
    if (slow) await new Promise((r) => setTimeout(r, 1500));
    return void res.writeHead(200, { "content-type": "application/json", "request-id": `req_fake_${n}` }).end(JSON.stringify(out));
  }
  if (url.pathname === "/anthropic/_log") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(claudeLog.slice(-50)));
  if (url.pathname === "/vimeo-api/videos" && url.searchParams.get("query")) {
    if (req.headers.authorization !== "bearer e2e-vimeo-token") return void res.writeHead(401).end();
    const q = url.searchParams.get("query");
    const data = Array.from({ length: 5 }, (_, i) => ({
      link: `https://vimeo.com/${7001 + i}`,
      name: `${["Neon Rain", "Night Chase", "Signal Fires", "Wet Streets", "Last Train"][i]} (fake result for “${q}”)`,
      duration: 120 + i * 30,
      description: "A fake search result served by the e2e fake of the Vimeo API.",
      width: 1920,
      height: 1080,
      user: { name: `Director ${i + 1}` },
      pictures: { sizes: [{ width: 640, link: `${base}/cover.png?v=${i}` }] },
    }));
    return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }));
  }
  const vimeo = /^\/vimeo-api\/videos\/(\d+)$/.exec(url.pathname);
  if (vimeo) {
    if (req.headers.authorization !== "bearer e2e-vimeo-token") return void res.writeHead(401).end();
    if (vimeo[1] !== "123456") return void res.writeHead(404).end();
    return void res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        name: "Night drive (fake Vimeo)",
        duration: 8.8,
        width: 640,
        height: 360,
        link: "https://vimeo.com/123456",
        download: [{ quality: "source", type: "video/mp4", width: 640, height: 360, link: `${base}/vimeo-files/source.mp4` }],
      }),
    );
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => console.log(`[fake-sites] listening on :${PORT}`));
