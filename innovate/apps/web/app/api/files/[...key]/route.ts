import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { contentTypeFor, LocalStorage } from "@innovate/shared/storage";
import { storage } from "@/lib/server";

/**
 * The desktop app's object storage endpoint: signed GET (with byte ranges, so video can seek) and
 * signed PUT for browser uploads, standing in for S3 presigned URLs. 404 on servers that use S3.
 */
type Ctx = { params: Promise<{ key: string[] }> };

async function resolve(
  req: Request,
  ctx: Ctx,
  method: "GET" | "PUT",
): Promise<{ error: Response } | { s: LocalStorage; key: string; path: string; params: URLSearchParams }> {
  const s = storage();
  if (!(s instanceof LocalStorage)) return { error: new Response("Not found", { status: 404 }) };
  const key = (await ctx.params).key.map(decodeURIComponent).join("/");
  const params = new URL(req.url).searchParams;
  if (!s.verify(method, key, params)) return { error: Response.json({ error: "This link has expired." }, { status: 403 }) };
  return { s, key, path: s.pathFor(key), params };
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const r = await resolve(req, ctx, "GET");
  if ("error" in r) return r.error;
  const info = await stat(/*turbopackIgnore: true*/ r.path).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "content-type": contentTypeFor(r.key),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });
  const dl = r.params.get("dl");
  if (dl) headers.set("content-disposition", `attachment; filename="${dl.replace(/["\\\r\n]/g, "")}"`);

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    headers.set("content-range", `bytes ${start}-${end}/${info.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ r.path, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers.set("content-length", String(info.size));
  return new Response(Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ r.path)) as ReadableStream, { status: 200, headers });
}

export async function HEAD(req: Request, ctx: Ctx) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function PUT(req: Request, ctx: Ctx) {
  const r = await resolve(req, ctx, "PUT");
  if ("error" in r) return r.error;
  if (!req.body) return Response.json({ error: "Empty upload." }, { status: 400 });
  await mkdir(/*turbopackIgnore: true*/ dirname(r.path), { recursive: true });
  const tmp = `${r.path}.${process.pid}.${Date.now()}.part`;
  await pipeline(Readable.fromWeb(req.body as never), createWriteStream(/*turbopackIgnore: true*/ tmp));
  await rename(/*turbopackIgnore: true*/ tmp, r.path);
  return new Response(null, { status: 200 });
}
