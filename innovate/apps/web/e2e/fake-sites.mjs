// Local stand-ins for "the web" in e2e tests (SPEC §8: never call real platforms in tests):
// a page with og tags, an image with srcset and a video, plus a fake of the Vimeo API whose
// download link serves a generated fixture. Started by playwright.config.ts on E2E_SITES_PORT.
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

createServer((req, res) => {
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/health") return void res.writeHead(200).end("ok");
  if (url.pathname === "/page.html") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  if (/^\/(cover|photo-small|photo-large)\.png$/.test(url.pathname)) return file(res, "portrait.png", "image/png");
  if (url.pathname === "/clip.mp4" || url.pathname === "/vimeo-files/source.mp4") return file(res, "scenes.mp4", "video/mp4");
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
