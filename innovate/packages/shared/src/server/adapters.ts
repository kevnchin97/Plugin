/**
 * Platform ingest adapters (SPEC §5.1). Each sits behind the IngestAdapter interface and is off
 * unless its config flag is set. Only adapters whose platform terms allow it are implemented:
 *
 * - Vimeo: the official API (developer.vimeo.com). Vimeo returns `download` links only to accounts
 *   allowed to download that video (typically the owner, or when the owner enabled downloads), so
 *   we only ever fetch what the token's account may download. Enable with INGEST_VIMEO_ENABLED=true
 *   and VIMEO_ACCESS_TOKEN (scopes: public private video_files).
 * - YouTube, Instagram: not implemented. Their terms prohibit downloading content except through
 *   features they provide, so links to them are refused with an explanation instead.
 */
import type { IngestAdapter } from "../ingest";

export interface AdapterMetadata {
  title: string;
  platform: string;
  durationSec?: number;
  width?: number;
  height?: number;
  sourceUrl: string;
}

export class AdapterError extends Error {}

const VIMEO_ID = /(?:^|\.)vimeo\.com$/i;

export function vimeoVideoId(url: URL): string | null {
  if (!VIMEO_ID.test(url.hostname)) return null;
  // vimeo.com/123, vimeo.com/channels/x/123, vimeo.com/123/abcdef (unlisted hash), player.vimeo.com/video/123
  const m = /(?:^|\/)(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,}))?(?:[/?#]|$)/i.exec(url.pathname + "/");
  return m ? m[1]! : null;
}

interface VimeoVideo {
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  link?: string;
  download?: { quality: string; type: string; width?: number; height?: number; link: string; size?: number; expires?: string }[];
}

/** Hosts Vimeo serves downloads from. Anything else is refused (we only follow Vimeo's own links). */
const VIMEO_DOWNLOAD_HOSTS = [/(?:^|\.)vimeo\.com$/i, /(?:^|\.)vimeocdn\.com$/i, /(?:^|\.)akamaized\.net$/i, /(?:^|\.)cloudfront\.net$/i];

export class VimeoAdapter implements IngestAdapter {
  readonly id = "vimeo";
  constructor(
    private readonly token: string,
    private readonly apiBase = "https://api.vimeo.com",
    /** Tests point apiBase at a local fake; then its download links are local too. */
    private readonly allowAnyDownloadHost = false,
  ) {}

  canHandle(url: URL): boolean {
    return vimeoVideoId(url) !== null;
  }

  private async video(url: URL): Promise<VimeoVideo> {
    const id = vimeoVideoId(url);
    if (!id) throw new AdapterError("That isn't a Vimeo video link.");
    const res = await fetch(`${this.apiBase}/videos/${id}?fields=name,duration,width,height,link,download`, {
      headers: { authorization: `bearer ${this.token}`, accept: "application/vnd.vimeo.*+json;version=3.4" },
    });
    if (res.status === 404) throw new AdapterError("Vimeo can't find that video, or it's private to another account.");
    if (res.status === 401 || res.status === 403) throw new AdapterError("Vimeo didn't accept the configured token.");
    if (!res.ok) throw new AdapterError(`Vimeo API error (HTTP ${res.status}).`);
    return (await res.json()) as VimeoVideo;
  }

  async fetchMetadata(url: URL): Promise<AdapterMetadata & { platform: string }> {
    const v = await this.video(url);
    return { title: v.name, platform: "vimeo", durationSec: v.duration, width: v.width, height: v.height, sourceUrl: v.link ?? url.toString() };
  }

  /**
   * Search public Vimeo videos (official API, GET /videos?query=). Used by the Research Agent:
   * results are links + metadata only; nothing is downloaded unless the user approves an import.
   */
  async search(query: string, limit = 12): Promise<VimeoSearchHit[]> {
    const params = new URLSearchParams({ query, per_page: String(Math.min(25, Math.max(1, limit))), fields: "uri,name,link,duration,description,pictures.sizes,user.name,width,height" });
    const res = await fetch(`${this.apiBase}/videos?${params}`, { headers: { authorization: `bearer ${this.token}`, accept: "application/vnd.vimeo.*+json;version=3.4" } });
    if (res.status === 401 || res.status === 403) throw new AdapterError("Vimeo didn't accept the configured token.");
    if (res.status === 429) throw new AdapterError("Vimeo is rate-limiting searches; try again in a minute.");
    if (!res.ok) throw new AdapterError(`Vimeo API error (HTTP ${res.status}).`);
    const body = (await res.json()) as { data?: VimeoApiVideo[] };
    return (body.data ?? []).map((v) => ({
      url: v.link,
      title: v.name,
      author: v.user?.name ?? null,
      durationSec: v.duration ?? null,
      description: (v.description ?? "").slice(0, 400),
      thumbnailUrl: [...(v.pictures?.sizes ?? [])].sort((a, b) => b.width - a.width).find((p) => p.width <= 1280)?.link ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
    }));
  }

  /** The best downloadable rendition the account is allowed to fetch (prefers source/original). */
  async fetchMedia(url: URL): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }> {
    const v = await this.video(url);
    const files = (v.download ?? []).filter((d) => d.link && /video\/(mp4|quicktime|webm)/.test(d.type));
    if (!files.length)
      throw new AdapterError("Vimeo doesn't offer a download of this video to this account. Only videos you own (or that allow downloads) can be imported.");
    const rank = (d: (typeof files)[number]) => (d.quality === "source" ? 1e9 : 0) + (d.width ?? 0) * (d.height ?? 0);
    const best = files.sort((a, b) => rank(b) - rank(a))[0]!;
    const link = new URL(best.link);
    if (!this.allowAnyDownloadHost && (link.protocol !== "https:" || !VIMEO_DOWNLOAD_HOSTS.some((re) => re.test(link.hostname))))
      throw new AdapterError("Vimeo returned a download link on an unexpected host; refusing to follow it.");
    const res = await fetch(link);
    if (!res.ok || !res.body) throw new AdapterError(`Couldn't download from Vimeo (HTTP ${res.status}).`);
    return { stream: res.body, contentType: best.type.split(";")[0]! };
  }
}

export interface VimeoSearchHit {
  url: string;
  title: string;
  author: string | null;
  durationSec: number | null;
  description: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}
interface VimeoApiVideo {
  link: string;
  name: string;
  duration?: number;
  description?: string | null;
  width?: number;
  height?: number;
  user?: { name?: string };
  pictures?: { sizes?: { width: number; link: string }[] };
}

/** Vimeo search for the Research Agent: needs only VIMEO_ACCESS_TOKEN (importing still needs INGEST_VIMEO_ENABLED). */
export function vimeoSearch(env: NodeJS.ProcessEnv = process.env): VimeoAdapter | null {
  if (!env.VIMEO_ACCESS_TOKEN) return null;
  const base = env.VIMEO_API_BASE || "https://api.vimeo.com";
  return new VimeoAdapter(env.VIMEO_ACCESS_TOKEN, base, base !== "https://api.vimeo.com" && env.NODE_ENV !== "production");
}

/** Adapters enabled by configuration, in priority order. */
export function configuredAdapters(env: NodeJS.ProcessEnv = process.env): IngestAdapter[] {
  const list: IngestAdapter[] = [];
  if (env.INGEST_VIMEO_ENABLED === "true" && env.VIMEO_ACCESS_TOKEN) {
    const base = env.VIMEO_API_BASE || "https://api.vimeo.com";
    list.push(new VimeoAdapter(env.VIMEO_ACCESS_TOKEN, base, base !== "https://api.vimeo.com" && env.NODE_ENV !== "production"));
  }
  return list;
}

export function adapterFor(url: URL, env: NodeJS.ProcessEnv = process.env): IngestAdapter | null {
  return configuredAdapters(env).find((a) => a.canHandle(url)) ?? null;
}
