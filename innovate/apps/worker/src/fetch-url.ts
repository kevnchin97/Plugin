/**
 * Direct video URL ingest (no adapter needed). Guards against SSRF by refusing hosts that
 * resolve to private, loopback or link-local addresses unless INGEST_ALLOW_PRIVATE_URLS=true.
 * TODO(M4): pin the resolved address for the actual connection to close the DNS-rebinding gap.
 */
import { createWriteStream } from "node:fs";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VIDEO_MIME_TYPES } from "@innovate/shared";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addrs) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 it wraps. Don't add
    // ::ffff:0:0/96 to the BlockList: Node then matches every IPv4 address against it.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a.address)?.[1];
    if (mapped ? blocked.check(mapped, "ipv4") : blocked.check(a.address, a.family === 6 ? "ipv6" : "ipv4"))
      throw new Error("That URL points to a private network address, which Innovate won't fetch.");
  }
}

export function contentTypeFor(url: URL, header: string | null): string {
  const ct = (header ?? "").split(";")[0]!.trim().toLowerCase();
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(ct)) return ct;
  const ext = url.pathname.split(".").pop()?.toLowerCase();
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ct === "application/octet-stream" || ct === "binary/octet-stream") return "video/mp4";
  throw new Error(`That link isn't a direct video file (server says "${ct || "unknown"}"). Paste a link that ends in .mp4, .mov or .webm.`);
}

export async function downloadUrl(
  raw: string,
  file: string,
  opts: { maxBytes: number; allowPrivate: boolean; onProgress?: (f: number) => void; signal?: AbortSignal },
): Promise<{ contentType: string; bytes: number; filename: string }> {
  let url = new URL(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links are supported.");
    if (!opts.allowPrivate) await assertPublicHost(url);
    res = await fetch(url, { redirect: "manual", signal: opts.signal, headers: { "user-agent": "InnovateBot/0.1 (+media ingest)" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new Error(`Couldn't download the video (HTTP ${res?.status ?? "error"}).`);
  const contentType = contentTypeFor(url, res.headers.get("content-type"));
  const total = Number(res.headers.get("content-length") || 0);
  if (total > opts.maxBytes) throw new Error("That video is larger than the import limit.");
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > opts.maxBytes) return cb(new Error("That video is larger than the import limit."));
      if (total) opts.onProgress?.(received / total);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(file));
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "video");
  return { contentType, bytes: received, filename };
}
