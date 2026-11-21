import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adapterFor, VimeoAdapter, vimeoVideoId } from "../src/server/adapters";

/** A recorded-shape fake of the Vimeo API (no real network in tests, SPEC §8). */
let server: Server;
let base = "";
const VIDEO_BYTES = Buffer.from("fake-mp4-bytes");
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/videos/") && req.headers.authorization !== "bearer test-token") return void res.writeHead(401).end();
    if (req.url?.startsWith("/videos/123456")) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          name: "Night drive test",
          duration: 12,
          width: 1920,
          height: 1080,
          link: "https://vimeo.com/123456",
          download: [
            { quality: "sd", type: "video/mp4", width: 640, height: 360, link: `${base}/files/sd.mp4` },
            { quality: "source", type: "video/quicktime", width: 1920, height: 1080, link: `${base}/files/source.mov` },
          ],
        }),
      );
    } else if (req.url?.startsWith("/videos/999999")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "Not mine", download: [] }));
    } else if (req.url === "/files/source.mov") res.writeHead(200, { "content-type": "video/quicktime" }).end(VIDEO_BYTES);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("Vimeo adapter", () => {
  it("recognises Vimeo video URLs", () => {
    expect(vimeoVideoId(new URL("https://vimeo.com/123456789"))).toBe("123456789");
    expect(vimeoVideoId(new URL("https://vimeo.com/123456789/abcdef1234"))).toBe("123456789");
    expect(vimeoVideoId(new URL("https://player.vimeo.com/video/123456789?h=x"))).toBe("123456789");
    expect(vimeoVideoId(new URL("https://vimeo.com/channels/staffpicks/123456789"))).toBe("123456789");
    expect(vimeoVideoId(new URL("https://vimeo.com/about"))).toBeNull();
    expect(vimeoVideoId(new URL("https://notvimeo.com/123456"))).toBeNull();
  });

  it("fetches metadata and the best download (source first)", async () => {
    const a = new VimeoAdapter("test-token", base, true);
    const meta = await a.fetchMetadata(new URL("https://vimeo.com/123456"));
    expect(meta).toMatchObject({ title: "Night drive test", platform: "vimeo", durationSec: 12, width: 1920 });
    const media = await a.fetchMedia(new URL("https://vimeo.com/123456"));
    expect(media.contentType).toBe("video/quicktime");
    const bytes = Buffer.from(await new Response(media.stream).arrayBuffer());
    expect(bytes.equals(VIDEO_BYTES)).toBe(true);
  });

  it("refuses videos the account can't download, bad tokens, and foreign download hosts", async () => {
    await expect(new VimeoAdapter("test-token", base, true).fetchMedia(new URL("https://vimeo.com/999999"))).rejects.toThrow(/Only videos you own/);
    await expect(new VimeoAdapter("wrong", base, true).fetchMetadata(new URL("https://vimeo.com/123456"))).rejects.toThrow(/token/);
    await expect(new VimeoAdapter("test-token", base, false).fetchMedia(new URL("https://vimeo.com/123456"))).rejects.toThrow(/unexpected host/);
  });

  it("is off unless enabled by config", () => {
    const url = new URL("https://vimeo.com/123456");
    expect(adapterFor(url, {})).toBeNull();
    expect(adapterFor(url, { INGEST_VIMEO_ENABLED: "true" })).toBeNull();
    expect(adapterFor(url, { INGEST_VIMEO_ENABLED: "true", VIMEO_ACCESS_TOKEN: "x" })?.id).toBe("vimeo");
    expect(adapterFor(new URL("https://youtube.com/watch?v=x"), { INGEST_VIMEO_ENABLED: "true", VIMEO_ACCESS_TOKEN: "x" })).toBeNull();
  });
});
